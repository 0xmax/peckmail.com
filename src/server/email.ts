import { Resend } from "resend";

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;
const APP_BASE_URL = (process.env.APP_BASE_URL || "https://peckmail.com").replace(/\/+$/, "");
const RESEND_FROM = process.env.RESEND_FROM?.trim();
const RESEND_FROM_EMAIL = process.env.RESEND_FROM_EMAIL?.trim() || "noreply@peckmail.com";
const FROM_ADDRESS = RESEND_FROM || `Peckmail <${RESEND_FROM_EMAIL}>`;

interface InvitationEmailParams {
  to: string;
  invitationId: string;
  projectName: string;
  inviterName: string;
}

export async function sendInvitationEmail({
  to,
  invitationId,
  projectName,
  inviterName,
}: InvitationEmailParams) {
  if (!resend) {
    throw new Error("RESEND_API_KEY not set");
  }

  const inviteUrl = `${APP_BASE_URL}/invite/${invitationId}`;

  const { error } = await resend.emails.send({
    from: FROM_ADDRESS,
    to,
    subject: `${inviterName} invited you to "${projectName}" on Peckmail`,
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:48px 20px;">
    <tr><td align="center">
      <table width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;border:1px solid #e5e5e5;overflow:hidden;">
        <tr><td style="padding:40px 40px 0;">
          <p style="margin:0 0 4px;font-size:13px;color:#737373;font-weight:500;letter-spacing:0.05em;text-transform:uppercase;">Invitation</p>
          <h1 style="margin:0;font-size:22px;color:#171717;font-weight:600;line-height:1.3;">You've been invited to collaborate</h1>
        </td></tr>
        <tr><td style="padding:20px 40px 28px;color:#525252;font-size:15px;line-height:1.6;">
          <strong style="color:#171717;">${escapeHtml(inviterName)}</strong> invited you to
          <strong style="color:#171717;">"${escapeHtml(projectName)}"</strong> on Peckmail.
        </td></tr>
        <tr><td style="padding:0 40px 32px;">
          <a href="${inviteUrl}" style="display:inline-block;padding:12px 28px;background:#171717;color:#fafafa;text-decoration:none;border-radius:8px;font-weight:500;font-size:14px;">
            Accept Invitation
          </a>
        </td></tr>
        <tr><td style="padding:0 40px 32px;color:#a3a3a3;font-size:12px;line-height:1.5;">
          Or copy this link:<br>
          <a href="${inviteUrl}" style="color:#525252;text-decoration:underline;word-break:break-all;">${inviteUrl}</a>
        </td></tr>
        <tr><td style="padding:20px 40px;border-top:1px solid #e5e5e5;">
          <p style="margin:0;color:#a3a3a3;font-size:12px;">Peckmail</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`.trim(),
  });

  if (error) {
    throw new Error(`Resend invitation send failed: ${getResendErrorMessage(error)}`);
  }
}

export async function sendEmail(params: {
  to: string;
  subject: string;
  body: string;
  replyTo?: string;
}): Promise<void> {
  if (!resend) {
    throw new Error("RESEND_API_KEY not set");
  }

  const { to, subject, body, replyTo } = params;

  const { error } = await resend.emails.send({
    from: FROM_ADDRESS,
    to,
    subject,
    ...(replyTo ? { reply_to: replyTo } : {}),
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:48px 20px;">
    <tr><td align="center">
      <table width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;border:1px solid #e5e5e5;overflow:hidden;">
        <tr><td style="padding:40px 40px 32px;color:#171717;font-size:15px;line-height:1.7;white-space:pre-wrap;">${escapeHtml(body)}</td></tr>
        <tr><td style="padding:20px 40px;border-top:1px solid #e5e5e5;">
          <p style="margin:0;color:#a3a3a3;font-size:12px;">Peckmail</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`.trim(),
  });

  if (error) {
    throw new Error(`Resend send failed: ${getResendErrorMessage(error)}`);
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function getResendErrorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (!error || typeof error !== "object") return "unknown error";

  const maybeMessage = (error as { message?: unknown }).message;
  if (typeof maybeMessage === "string" && maybeMessage.trim()) return maybeMessage;

  try {
    return JSON.stringify(error);
  } catch {
    return "unknown error";
  }
}
