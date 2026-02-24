import { Webhook } from "svix";
import { Resend } from "resend";
import Anthropic from "@anthropic-ai/sdk";
import {
  getProjectByEmail,
  getProjectMemberEmails,
  insertIncomingEmail,
  listProjectEmailTags,
  setIncomingEmailTags,
  upsertProjectEmailDomain,
  updateIncomingEmailContent,
  updateEmailStatus,
  type ProjectIncomingEmail,
} from "./db.js";
import { runAgentHeadless } from "./chat.js";
import { broadcast } from "./ws.js";
import { sendEmail } from "./email.js";
import { PROJECTS_DIR } from "./files.js";
import { promises as fs } from "fs";
import { join } from "path";
import { getProjectOwner } from "./credits.js";

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;
const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

const WEBHOOK_SECRET = process.env.RESEND_WEBHOOK_SECRET;
const INBOUND_AUTO_REPLY_ENABLED = process.env.INBOUND_AUTO_REPLY_ENABLED === "true";
const EMAIL_TAGGING_MODEL = process.env.EMAIL_TAGGING_MODEL || "claude-sonnet-4-5-20250929";
const EMAIL_SUMMARY_MODEL = process.env.EMAIL_SUMMARY_MODEL || "claude-3-6-sonnet-latest";
const MAX_TAGGING_INPUT_CHARS = 12000;
const MAX_SUMMARY_INPUT_CHARS = 16000;

export function verifyWebhookSignature(
  rawBody: string,
  headers: Record<string, string>
): any {
  if (!WEBHOOK_SECRET) {
    throw new Error("RESEND_WEBHOOK_SECRET not configured");
  }
  const wh = new Webhook(WEBHOOK_SECRET);
  return wh.verify(rawBody, {
    "svix-id": headers["svix-id"],
    "svix-timestamp": headers["svix-timestamp"],
    "svix-signature": headers["svix-signature"],
  });
}

export interface InboundEmailRecord {
  id: string;
  project_id: string;
  project_name: string;
  from_address: string;
  from_domain: string | null;
  to_address: string;
  subject: string;
  body_text: string;
  body_html: string;
  raw_email: string;
  summary: string | null;
  resend_email_id: string;
  date: string;
  cc: string[];
  reply_to: string;
  headers: Record<string, any>;
}

/**
 * Phase 1: Parse payload, find project, insert into DB with status 'received',
 * and broadcast to connected clients. Returns the record, or null if the email
 * should be skipped (no matching project or duplicate).
 */
export async function receiveInboundEmail(
  payload: any
): Promise<InboundEmailRecord | null> {
  const data = payload.data ?? payload;
  const resendEmailId: string =
    data.email_id ?? data.id ?? `unknown-${Date.now()}`;

  // The webhook payload only has metadata (no body). Extract what we can.
  const toAddresses: string[] = Array.isArray(data.to) ? data.to : [data.to];
  const fromAddress: string = Array.isArray(data.from) ? data.from[0] : data.from;
  const subject: string = data.subject ?? "(no subject)";
  const cc: string[] = Array.isArray(data.cc) ? data.cc : data.cc ? [data.cc] : [];
  const replyTo: string = data.reply_to ?? data.replyTo ?? "";
  const date: string = data.date ?? data.created_at ?? new Date().toISOString();
  const fromDomain = extractDomainFromAddress(fromAddress);

  // Find matching project for any of the to addresses
  let project: { id: string; name: string } | null = null;
  let matchedTo = "";
  for (const addr of toAddresses) {
    const cleaned = addr.replace(/<|>/g, "").trim().toLowerCase();
    project = await getProjectByEmail(cleaned);
    if (project) {
      matchedTo = cleaned;
      break;
    }
  }

  if (!project) {
    console.warn("[inbound] No project found for:", toAddresses);
    return null;
  }

  if (fromDomain) {
    upsertProjectEmailDomain(project.id, fromDomain).catch((err) =>
      console.error("[inbound] Failed to upsert sender domain:", err)
    );
  }

  // Store in database with no body yet (idempotent — returns null on duplicate)
  const record = await insertIncomingEmail({
    project_id: project.id,
    resend_email_id: resendEmailId,
    from_address: fromAddress,
    from_domain: fromDomain ?? undefined,
    to_address: matchedTo,
    subject,
    body_text: "",
    body_html: "",
    raw_email: "",
    headers: data.headers ?? {},
    attachments: data.attachments ?? [],
  });

  if (!record) {
    console.log("[inbound] Duplicate email, skipping:", resendEmailId);
    return null;
  }

  // Broadcast new email to connected clients
  broadcast(project.id, {
    type: "email:received",
    email: {
      id: record.id,
      from_address: fromAddress,
      from_domain: fromDomain,
      subject,
      status: "received",
      error: null,
      created_at: new Date().toISOString(),
      summary: null,
      tags: [],
    },
  });

  return {
    id: record.id,
    project_id: project.id,
    project_name: project.name,
    from_address: fromAddress,
    from_domain: fromDomain,
    to_address: matchedTo,
    subject,
    body_text: "",
    body_html: "",
    raw_email: "",
    summary: null,
    resend_email_id: resendEmailId,
    date,
    cc,
    reply_to: replyTo,
    headers: data.headers ?? {},
  };
}

/**
 * Fetch email body from Resend API (with retries), then run the AI agent.
 * Called asynchronously after the webhook returns 200.
 */
export async function fetchEmailContentAndProcess(
  record: InboundEmailRecord
): Promise<void> {
  // Fetch full email content from Resend API with retry+backoff
  if (resend && record.resend_email_id && !record.resend_email_id.startsWith("test-")) {
    const delays = [0, 500, 2000];
    for (let attempt = 0; attempt < delays.length; attempt++) {
      if (delays[attempt]) await new Promise((r) => setTimeout(r, delays[attempt]));
      try {
        const { data: fetched, error: apiError } = await resend.emails.receiving.get(record.resend_email_id);
        if (apiError) {
          console.error("[inbound] Resend API error (attempt %d):", attempt + 1, apiError);
          // Don't retry on auth/permission errors
          if (apiError.statusCode === 401 || apiError.statusCode === 403) break;
          continue;
        }
        if (fetched) {
          console.log("[inbound] Resend API response (attempt %d):", attempt + 1, JSON.stringify({
            id: fetched.id,
            from: fetched.from,
            subject: fetched.subject,
            hasText: !!fetched.text,
            textLength: fetched.text?.length ?? 0,
            hasHtml: !!fetched.html,
            htmlLength: fetched.html?.length ?? 0,
            hasRaw: !!fetched.raw?.download_url,
          }));

          if (fetched.text) {
            record.body_text = fetched.text;
          }
          if (fetched.html) {
            record.body_html = fetched.html;
          }

          // Try downloading raw MIME (best effort) so we keep a full source copy.
          if (fetched.raw?.download_url) {
            try {
              const rawResp = await fetch(fetched.raw.download_url);
              if (rawResp.ok) {
                const rawText = await rawResp.text();
                console.log("[inbound] Downloaded raw email: %d chars", rawText.length);
                record.raw_email = rawText;
                const parsed = parseRawEmail(rawText);
                if (!record.body_text && parsed.text) record.body_text = parsed.text;
                if (!record.body_html && parsed.html) record.body_html = parsed.html;
              }
            } catch (rawErr) {
              console.warn("[inbound] Failed to download raw email:", rawErr);
            }
          }

          if (!record.body_text && record.body_html) {
            record.body_text = extractBodyText("", record.body_html);
          }

          const hasBody = Boolean(record.body_text || record.body_html);
          const wantsRaw = Boolean(fetched.raw?.download_url);
          const hasRaw = Boolean(record.raw_email);
          if (hasBody && (!wantsRaw || hasRaw)) {
            break;
          }
        }
      } catch (err) {
        console.warn("[inbound] Failed to fetch email content (attempt %d):", attempt + 1, err);
      }
    }
  }

  console.log(
    `[inbound] Email ${record.resend_email_id}: body_text=${record.body_text.length} chars body_html=${record.body_html.length} chars raw_email=${record.raw_email.length} chars`
  );

  // Now run the AI agent
  await processInboundEmail(record);
}

/**
 * Phase 2: Run the AI agent on a received email record.
 * Sets status to 'processing', then 'processed' or 'failed'.
 */
export async function processInboundEmail(
  record: InboundEmailRecord
): Promise<void> {
  await updateIncomingEmailContent(record.id, {
    body_text: record.body_text,
    body_html: record.body_html,
    raw_email: record.raw_email,
    summary: null,
  });

  // Mark as processing
  await updateEmailStatus(record.id, "processing");
  broadcast(record.project_id, {
    type: "email:status",
    emailId: record.id,
    status: "processing",
    error: null,
  });

  // Auto-classify tags + generate summary before agent processing (best effort).
  const [tags, summary] = await Promise.all([
    classifyIncomingEmailTags(record).catch((err) => {
      console.error("[inbound] Tag classification failed:", err);
      return [];
    }),
    summarizeIncomingEmail(record).catch((err) => {
      console.error("[inbound] Email summarization failed:", err);
      return null;
    }),
  ]);

  record.summary = summary;
  await updateIncomingEmailContent(record.id, { summary });
  broadcast(record.project_id, {
    type: "email:classified",
    emailId: record.id,
    tags,
    summary,
  });

  // Build agent system prompt
  const systemPrompt = await buildSystemPrompt(
    record.project_id,
    record.project_name,
    record.from_address,
    INBOUND_AUTO_REPLY_ENABLED
  );

  // Format user message
  const userMessage = formatEmailAsMessage(record);

  // Look up project owner for billing
  const ownerId = await getProjectOwner(record.project_id);

  try {
    const { sessionId } = await runAgentHeadless(
      record.project_id,
      systemPrompt,
      userMessage,
      {
        userId: ownerId ?? undefined,
        allowSendEmail: INBOUND_AUTO_REPLY_ENABLED,
      }
    );
    await updateEmailStatus(record.id, "processed", sessionId);
    broadcast(record.project_id, {
      type: "email:status",
      emailId: record.id,
      status: "processed",
      error: null,
    });
    console.log(
      `[inbound] Processed email ${record.resend_email_id} for project ${record.project_id}, session ${sessionId}`
    );
  } catch (err: any) {
    const errorMsg = err.message === "Insufficient credits"
      ? "Insufficient credits to process this email. Please add credits to your account."
      : err.message || "Unknown error";
    console.error("[inbound] Agent error:", err);
    await updateEmailStatus(record.id, "failed", null, errorMsg);
    broadcast(record.project_id, {
      type: "email:status",
      emailId: record.id,
      status: "failed",
      error: errorMsg,
    });

    // Notify sender if they're a workspace member
    const senderNormalized = record.from_address
      .replace(/<|>/g, "")
      .trim()
      .toLowerCase();
    const memberEmails = await getProjectMemberEmails(record.project_id);
    if (INBOUND_AUTO_REPLY_ENABLED && memberEmails.includes(senderNormalized)) {
      sendEmail({
        to: senderNormalized,
        subject: `Re: ${record.subject}`,
        body: `There was an error processing your email "${record.subject}" in workspace "${record.project_name}":\n\n${errorMsg}\n\nPlease check your workspace for details.`,
      }).catch((e) =>
        console.error("[inbound] Failed to send error notification:", e)
      );
    }
  }
}

async function buildSystemPrompt(
  projectId: string,
  projectName: string,
  fromAddress: string,
  allowReplies: boolean
): Promise<string> {
  const projectDir = join(PROJECTS_DIR, projectId);
  const instructionFiles = [
    "AGENTS.md",
    "agents.md",
    ".peckmail/agents.md",
    ".perchpad/agents.md",
  ];

  let instructions: string | null = null;
  for (const file of instructionFiles) {
    try {
      instructions = await fs.readFile(join(projectDir, file), "utf-8");
      break;
    } catch {
      // Try next file
    }
  }

  const memberEmails = await getProjectMemberEmails(projectId);
  const senderNormalized = fromAddress.replace(/<|>/g, "").trim().toLowerCase();
  const senderIsMember = memberEmails.includes(senderNormalized);

  let replyInstructions: string;
  if (!allowReplies) {
    replyInstructions = `Automatic email replies are disabled for inbound processing. Process this email silently and do not send any outbound email response.`;
  } else if (senderIsMember) {
    replyInstructions = `The sender (${senderNormalized}) is a workspace member. You may reply to them using the send_email tool if appropriate.`;
  } else {
    replyInstructions = `The sender (${senderNormalized}) is not a workspace member. Process this email silently — do not send any replies.`;
  }

  const emailToolLine = allowReplies
    ? "You also have a send_email tool that can send emails to workspace members."
    : "Email replies are disabled for inbound processing unless INBOUND_AUTO_REPLY_ENABLED=true.";

  const base = `You are a helpful AI assistant for the Peckmail workspace "${projectName}". You have just received an inbound email sent to this workspace's email address. Process it according to the instructions below.

You have tools to read, create, and edit files in this workspace. Use them as needed to carry out the task.

${emailToolLine}

## Workspace Members
The following email addresses are workspace members: ${memberEmails.join(", ") || "(none)"}

## Reply Policy
${replyInstructions}

## IMPORTANT: Forwarded Emails
If the email contains a forwarded message (indicated by markers like "---------- Forwarded message ----------", "Begin forwarded message", "-------- Original Message --------", or similar), the sender's own text ABOVE the forwarded content is their instruction to you. That text tells you what to DO with the forwarded content — follow it as your primary task. The forwarded message below the marker is just reference material. Do NOT simply save the entire email as-is. Instead, carry out whatever the sender asked for (e.g. summarize it, extract data, add it to a specific file). If there is no text above the forwarded marker, fall back to the default behavior below.`;

  if (instructions) {
    return `${base}

## Workspace Instructions

The workspace owner has provided the following instructions for processing inbound emails:

${instructions}

Follow these instructions carefully when processing the email.`;
  }

  return `${base}

## Default Behavior

No custom instructions (AGENTS.md) were found in this workspace. Apply the default behavior ONLY if the sender did not include personal instructions (see "Forwarded Emails" above):

1. Create a file at \`inbox/YYYY-MM-DD-subject-slug.md\` with the email content formatted as markdown.
2. Use today's date for the filename.
3. Convert the subject to a URL-friendly slug (lowercase, hyphens, no special characters).
4. Format the file with a YAML frontmatter block containing from, subject, and date, followed by the email body.

If the sender wrote instructions above a forwarded message, follow those instructions instead of this default.`;
}

function formatEmailAsMessage(record: InboundEmailRecord): string {
  let meta = `**From:** ${record.from_address}
**To:** ${record.to_address}`;
  if (record.cc.length > 0) {
    meta += `\n**CC:** ${record.cc.join(", ")}`;
  }
  if (record.reply_to) {
    meta += `\n**Reply-To:** ${record.reply_to}`;
  }
  meta += `\n**Date:** ${record.date}`;
  meta += `\n**Subject:** ${record.subject}`;

  return `New inbound email received:

${meta}

---

${record.body_text}`;
}

async function summarizeIncomingEmail(
  record: InboundEmailRecord
): Promise<string | null> {
  const emailInput = buildEmailModelInput(record, MAX_SUMMARY_INPUT_CHARS);
  if (!emailInput) return null;
  if (!anthropic) {
    console.warn("[inbound] Skipping summary: ANTHROPIC_API_KEY not configured");
    return null;
  }

  const response = await anthropic.messages.create({
    model: EMAIL_SUMMARY_MODEL,
    max_tokens: 300,
    temperature: 0,
    system:
      "You summarize inbound emails for a workspace inbox. Return plain text only. Keep the summary concise (2-4 sentences) and mention the key request, context, and any concrete action items.",
    messages: [
      {
        role: "user",
        content: `Summarize this inbound email:\n\n${emailInput}`,
      },
    ],
  });

  const summary = extractTextFromAnthropicContent(response.content).trim();
  return summary || null;
}

async function classifyIncomingEmailTags(
  record: InboundEmailRecord
): Promise<Array<{ id: string; name: string; color: string }>> {
  const enabledTags = await listProjectEmailTags(record.project_id, { enabledOnly: true });
  if (enabledTags.length === 0) {
    return setIncomingEmailTags(record.project_id, record.id, []);
  }

  const emailInput = buildEmailModelInput(record, MAX_TAGGING_INPUT_CHARS);
  if (!emailInput || !anthropic) {
    if (!anthropic) {
      console.warn("[inbound] Skipping tag classification: ANTHROPIC_API_KEY not configured");
    }
    return setIncomingEmailTags(record.project_id, record.id, []);
  }

  const tagPayload = enabledTags.map((tag) => ({
    id: tag.id,
    name: tag.name,
    condition: tag.condition,
  }));

  const response = await anthropic.messages.create({
    model: EMAIL_TAGGING_MODEL,
    max_tokens: 400,
    temperature: 0,
    system:
      "You classify emails against project-defined tag conditions. Respond with strict JSON only: {\"matching_tag_ids\":[\"...\"]}. Include only tag IDs that clearly apply.",
    messages: [
      {
        role: "user",
        content:
          `Available tags (JSON):\n${JSON.stringify(tagPayload, null, 2)}\n\n` +
          `Inbound email:\n${emailInput}\n\n` +
          `Return only JSON.`,
      },
    ],
  });

  const raw = extractTextFromAnthropicContent(response.content);
  const parsed = parseJsonObject(raw);
  const candidateIds = Array.isArray(parsed?.matching_tag_ids)
    ? parsed.matching_tag_ids.filter((id: unknown): id is string => typeof id === "string")
    : [];
  const allowedIds = new Set(tagPayload.map((tag) => tag.id));
  const selectedIds = candidateIds.filter((id) => allowedIds.has(id));
  return setIncomingEmailTags(record.project_id, record.id, selectedIds);
}

function buildEmailModelInput(record: InboundEmailRecord, maxChars: number): string {
  const body = (record.body_text || extractBodyText("", record.body_html || "") || "").trim();
  const raw = [
    `From: ${record.from_address}`,
    `To: ${record.to_address}`,
    `Subject: ${record.subject}`,
    "",
    body || "(no body)",
  ].join("\n");
  if (raw.length <= maxChars) return raw;
  return `${raw.slice(0, maxChars)}\n\n...[truncated]`;
}

function extractTextFromAnthropicContent(content: Array<{ type: string; text?: string }>): string {
  return content
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join("\n");
}

function parseJsonObject(value: string): any {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    // fall through
  }

  const fenceMatch = trimmed.match(/```json\s*([\s\S]*?)\s*```/i) || trimmed.match(/```\s*([\s\S]*?)\s*```/i);
  if (fenceMatch?.[1]) {
    try {
      return JSON.parse(fenceMatch[1]);
    } catch {
      // fall through
    }
  }

  const objectMatch = trimmed.match(/\{[\s\S]*\}/);
  if (objectMatch?.[0]) {
    try {
      return JSON.parse(objectMatch[0]);
    } catch {
      return null;
    }
  }

  return null;
}

function extractDomainFromAddress(fromAddress: string): string | null {
  if (!fromAddress) return null;
  const normalized = fromAddress
    .replace(/.*<([^>]+)>.*/, "$1")
    .trim()
    .toLowerCase();
  const atIndex = normalized.lastIndexOf("@");
  if (atIndex < 0 || atIndex === normalized.length - 1) return null;
  const domain = normalized.slice(atIndex + 1).replace(/[>\s]/g, "");
  if (!domain || !domain.includes(".")) return null;
  return domain;
}

function extractBodyText(text: string, html: string): string {
  if (text) return text;
  if (!html) return "";
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/tr>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Minimal MIME parser to extract text and html parts from a raw email.
 * We avoid pulling in a full library; this handles the common cases.
 */
function parseRawEmail(raw: string): { text: string; html: string } {
  let text = "";
  let html = "";

  // Find the content-type header to get the boundary
  const ctMatch = raw.match(/^content-type:\s*multipart\/\w+;\s*boundary="?([^\s"]+)"?/im);
  if (!ctMatch) {
    // Not multipart — check if it's plain text
    const singleCt = raw.match(/^content-type:\s*text\/(plain|html)/im);
    const headerEnd = raw.indexOf("\r\n\r\n");
    const body = headerEnd >= 0 ? raw.slice(headerEnd + 4) : raw;
    if (singleCt?.[1] === "html") {
      html = decodeBody(body, raw);
    } else {
      text = decodeBody(body, raw);
    }
    return { text, html };
  }

  const boundary = ctMatch[1];
  const parts = raw.split(new RegExp(`--${escapeRegExp(boundary)}`));

  for (const part of parts) {
    const partCtMatch = part.match(/^content-type:\s*text\/(plain|html)(?:;[^\r\n]*)?\r?\n/im);
    if (!partCtMatch) continue;
    const partHeaderEnd = part.indexOf("\r\n\r\n") ?? part.indexOf("\n\n");
    if (partHeaderEnd < 0) continue;
    const partBody = part.slice(partHeaderEnd + 4).replace(/--\s*$/, "").trim();
    const decoded = decodeBody(partBody, part);
    if (partCtMatch[1] === "plain" && !text) text = decoded;
    if (partCtMatch[1] === "html" && !html) html = decoded;
  }

  return { text, html };
}

function decodeBody(body: string, headers: string): string {
  const cte = headers.match(/^content-transfer-encoding:\s*(\S+)/im);
  if (cte?.[1]?.toLowerCase() === "base64") {
    return Buffer.from(body.replace(/\s/g, ""), "base64").toString("utf-8");
  }
  if (cte?.[1]?.toLowerCase() === "quoted-printable") {
    return body
      .replace(/=\r?\n/g, "")
      .replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  }
  return body;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Re-run tag classification on an existing email.
 * Converts a ProjectIncomingEmail to the shape classifyIncomingEmailTags expects.
 */
export async function reprocessEmailTags(
  email: ProjectIncomingEmail
): Promise<Array<{ id: string; name: string; color: string }>> {
  const record: InboundEmailRecord = {
    id: email.id,
    project_id: email.project_id,
    project_name: "",
    from_address: email.from_address,
    from_domain: email.from_domain,
    to_address: email.to_address ?? "",
    subject: email.subject ?? "",
    body_text: email.body_text ?? "",
    body_html: email.body_html ?? "",
    raw_email: email.raw_email ?? "",
    summary: email.summary,
    resend_email_id: email.resend_email_id,
    date: email.created_at,
    cc: [],
    reply_to: "",
    headers: email.headers ?? {},
  };
  return classifyIncomingEmailTags(record);
}
