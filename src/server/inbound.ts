import { Webhook } from "svix";
import { Resend } from "resend";
import {
  getProjectByEmail,
  getProjectMemberEmails,
  insertIncomingEmail,
  updateEmailStatus,
} from "./db.js";
import { runAgentHeadless } from "./chat.js";
import { broadcast } from "./ws.js";
import { sendEmail } from "./email.js";
import { PROJECTS_DIR } from "./files.js";
import { promises as fs } from "fs";
import { join } from "path";

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

const WEBHOOK_SECRET = process.env.RESEND_WEBHOOK_SECRET;

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
  to_address: string;
  subject: string;
  body_text: string;
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

  // The webhook only has metadata — fetch full email content from Resend API
  let fullEmail: any = data;
  if (resend && resendEmailId && !resendEmailId.startsWith("test-")) {
    try {
      const { data: fetched } = await resend.emails.receiving.get(resendEmailId);
      console.log("[inbound] Resend API response:", JSON.stringify({
        id: fetched?.id,
        from: fetched?.from,
        subject: fetched?.subject,
        hasText: !!fetched?.text,
        textLength: fetched?.text?.length ?? 0,
        hasHtml: !!fetched?.html,
        htmlLength: fetched?.html?.length ?? 0,
      }));
      if (fetched) fullEmail = fetched;
    } catch (err) {
      console.warn("[inbound] Failed to fetch email content from Resend API, using webhook data:", err);
    }
  }

  const toAddresses: string[] = Array.isArray(fullEmail.to) ? fullEmail.to : [fullEmail.to];
  const fromAddress: string = Array.isArray(fullEmail.from)
    ? fullEmail.from[0]
    : fullEmail.from;
  const subject: string = fullEmail.subject ?? "(no subject)";
  const bodyHtml: string = fullEmail.html ?? "";
  // Many forwarded emails only have HTML — extract plain text from it as fallback
  let bodyText: string = fullEmail.text ?? "";
  if (!bodyText && bodyHtml) {
    bodyText = bodyHtml
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
  console.log(`[inbound] Email ${resendEmailId}: text=${bodyText.length} chars, html=${bodyHtml.length} chars`);
  const headers = fullEmail.headers ?? {};
  const attachments = fullEmail.attachments ?? [];
  const cc: string[] = Array.isArray(fullEmail.cc) ? fullEmail.cc : fullEmail.cc ? [fullEmail.cc] : [];
  const replyTo: string = fullEmail.reply_to ?? fullEmail.replyTo ?? "";
  const date: string = fullEmail.date ?? fullEmail.created_at ?? new Date().toISOString();

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

  // Store in database (idempotent — returns null on duplicate)
  const record = await insertIncomingEmail({
    project_id: project.id,
    resend_email_id: resendEmailId,
    from_address: fromAddress,
    to_address: matchedTo,
    subject,
    body_text: bodyText,
    body_html: bodyHtml,
    headers,
    attachments,
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
      subject,
      status: "received",
      error: null,
      created_at: new Date().toISOString(),
    },
  });

  return {
    id: record.id,
    project_id: project.id,
    project_name: project.name,
    from_address: fromAddress,
    to_address: matchedTo,
    subject,
    body_text: bodyText,
    resend_email_id: resendEmailId,
    date,
    cc,
    reply_to: replyTo,
    headers,
  };
}

/**
 * Phase 2: Run the AI agent on a received email record.
 * Sets status to 'processing', then 'processed' or 'failed'.
 */
export async function processInboundEmail(
  record: InboundEmailRecord
): Promise<void> {
  // Mark as processing
  await updateEmailStatus(record.id, "processing");
  broadcast(record.project_id, {
    type: "email:status",
    emailId: record.id,
    status: "processing",
    error: null,
  });

  // Build agent system prompt
  const systemPrompt = await buildSystemPrompt(
    record.project_id,
    record.project_name,
    record.from_address
  );

  // Format user message
  const userMessage = formatEmailAsMessage(record);

  try {
    const { sessionId } = await runAgentHeadless(
      record.project_id,
      systemPrompt,
      userMessage
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
    const errorMsg = err.message || "Unknown error";
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
    if (memberEmails.includes(senderNormalized)) {
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
  fromAddress: string
): Promise<string> {
  const projectDir = join(PROJECTS_DIR, projectId);
  const instructionFiles = [
    "AGENTS.md",
    "agents.md",
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
  if (senderIsMember) {
    replyInstructions = `The sender (${senderNormalized}) is a workspace member. You may reply to them using the send_email tool if appropriate.`;
  } else {
    replyInstructions = `The sender (${senderNormalized}) is not a workspace member. Process this email silently — do not send any replies.`;
  }

  const base = `You are a helpful AI assistant for the Perchpad workspace "${projectName}". You have just received an inbound email sent to this workspace's email address. Process it according to the instructions below.

You have tools to read, create, and edit files in this workspace. Use them as needed to carry out the task.

You also have a send_email tool that can send emails to workspace members.

## Workspace Members
The following email addresses are workspace members: ${memberEmails.join(", ") || "(none)"}

## Reply Policy
${replyInstructions}

## IMPORTANT: Forwarded Emails
If the email contains a forwarded message (indicated by markers like "---------- Forwarded message ----------", "Begin forwarded message", "-------- Original Message --------", or similar), the sender's own text ABOVE the forwarded content is their instruction to you. That text tells you what to DO with the forwarded content — follow it as your primary task. The forwarded message below the marker is just reference material. Do NOT simply save the entire email as-is. Instead, carry out whatever the sender asked for (e.g. summarize it, extract data, add it to a specific file, reply, etc.). If there is no text above the forwarded marker, fall back to the default behavior below.`;

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
