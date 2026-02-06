import { Webhook } from "svix";
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
  const toAddresses: string[] = Array.isArray(data.to) ? data.to : [data.to];
  const fromAddress: string = Array.isArray(data.from)
    ? data.from[0]
    : data.from;
  const subject: string = data.subject ?? "(no subject)";
  const bodyText: string = data.text ?? "";
  const bodyHtml: string = data.html ?? "";
  const resendEmailId: string =
    data.email_id ?? data.id ?? `unknown-${Date.now()}`;
  const headers = data.headers ?? {};
  const attachments = data.attachments ?? [];

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
  const userMessage = formatEmailAsMessage(
    record.from_address,
    record.subject,
    record.body_text
  );

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

## Forwarded Emails
If the email contains a forwarded message (indicated by markers like "---------- Forwarded message ----------", "Begin forwarded message", or similar), pay special attention to any text the sender wrote ABOVE the forwarded content. That text contains the sender's personal instructions or context for what they want you to do with the forwarded message. Treat it as the primary intent.`;

  if (instructions) {
    return `${base}

## Workspace Instructions

The workspace owner has provided the following instructions for processing inbound emails:

${instructions}

Follow these instructions carefully when processing the email.`;
  }

  return `${base}

## Default Behavior

No custom instructions (AGENTS.md) were found in this workspace. Apply the default behavior:

1. Create a file at \`inbox/YYYY-MM-DD-subject-slug.md\` with the email content formatted as markdown.
2. Use today's date for the filename.
3. Convert the subject to a URL-friendly slug (lowercase, hyphens, no special characters).
4. Format the file with a YAML frontmatter block containing from, subject, and date, followed by the email body.`;
}

function formatEmailAsMessage(
  from: string,
  subject: string,
  body: string
): string {
  return `New inbound email received:

**From:** ${from}
**Subject:** ${subject}

---

${body}`;
}
