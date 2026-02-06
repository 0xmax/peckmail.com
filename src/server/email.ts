import { Resend } from "resend";

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

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
    console.warn("RESEND_API_KEY not set, skipping invitation email");
    return;
  }

  const inviteUrl = `https://perchpad.co/invite/${invitationId}`;

  try {
    await resend.emails.send({
      from: "Perchpad <noreply@chirp.perchpad.co>",
      to,
      subject: `${inviterName} invited you to "${projectName}" on Perchpad`,
      html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#faf5ff;font-family:system-ui,-apple-system,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px;">
    <tr><td align="center">
      <table width="480" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;border:1px solid #e8dff0;padding:40px;">
        <tr><td style="text-align:center;padding-bottom:24px;">
          <h1 style="margin:0;font-size:24px;color:#4a4458;font-weight:600;">You're invited!</h1>
        </td></tr>
        <tr><td style="text-align:center;padding-bottom:32px;color:#6b6480;font-size:16px;line-height:1.6;">
          <strong style="color:#4a4458;">${escapeHtml(inviterName)}</strong> invited you to collaborate on
          <strong style="color:#4a4458;">"${escapeHtml(projectName)}"</strong> on Perchpad.
        </td></tr>
        <tr><td style="text-align:center;padding-bottom:32px;">
          <a href="${inviteUrl}" style="display:inline-block;padding:14px 32px;background:#8b5cf6;color:#fff;text-decoration:none;border-radius:12px;font-weight:500;font-size:16px;">
            Accept Invitation
          </a>
        </td></tr>
        <tr><td style="text-align:center;color:#8e849b;font-size:13px;line-height:1.5;">
          Or copy this link: ${inviteUrl}<br><br>
          <span style="color:#a89fb5;">Perchpad — Your friendly writing workspace</span>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`.trim(),
    });
  } catch (err) {
    console.error("Failed to send invitation email:", err);
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

  await resend.emails.send({
    from: "Perchpad <noreply@chirp.perchpad.co>",
    to,
    subject,
    ...(replyTo ? { reply_to: replyTo } : {}),
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#faf5ff;font-family:system-ui,-apple-system,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px;">
    <tr><td align="center">
      <table width="480" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;border:1px solid #e8dff0;padding:40px;">
        <tr><td style="color:#4a4458;font-size:16px;line-height:1.6;white-space:pre-wrap;">${escapeHtml(body)}</td></tr>
        <tr><td style="text-align:center;padding-top:32px;color:#a89fb5;font-size:13px;line-height:1.5;">
          <span>Perchpad — Your friendly writing workspace</span>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`.trim(),
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
