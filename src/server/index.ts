import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
import { serveStatic } from "@hono/node-server/serve-static";
import { authMiddleware, getUser } from "./auth.js";
import { filesRouter, fileSearchRouter, PROJECTS_DIR, seedTemplate } from "./files.js";
import { seedFromTemplate, seedEmpty, seedFromFiles } from "./templates.js";
import { generateWorkspaceFiles } from "./generateWorkspace.js";
import { addClient } from "./ws.js";
import {
  listSessions,
  getSession,
  createSession,
  deleteSession,
} from "./chat.js";
import {
  getUserProjects,
  createProject,
  getProjectMembership,
  createInvitation,
  acceptInvitation,
  getProjectMembers,
  createShareLink,
  getShareLink,
  getProjectEmail,
  assignProjectEmail,
  getUserHandle,
  supabaseAdmin,
} from "./db.js";
import { verifyWebhookSignature, receiveInboundEmail, fetchEmailContentAndProcess, processInboundEmail } from "./inbound.js";
import { sendInvitationEmail, sendEmail } from "./email.js";
import { initRepo, getHistory, getCommitDiff, getUncommittedStatus, manualCommit } from "./git.js";
import { ttsRouter } from "./tts.js";
import { mcpRouter } from "./mcp.js";
import { gitRouter } from "./gitHttp.js";
import { getAvailableBalance, getTransactions, releaseStaleHolds } from "./credits.js";
import { createHash, randomBytes } from "crypto";
import { promises as fs } from "fs";
import { join } from "path";

const app = new Hono();
const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });
const ASSET_VERSION =
  process.env.FLY_IMAGE_REF ||
  process.env.RELEASE_VERSION ||
  Date.now().toString();

function setNoCacheHeaders(c: any) {
  c.header("Cache-Control", "no-cache, no-store, must-revalidate");
  c.header("Pragma", "no-cache");
  c.header("Expires", "0");
}

// --- Static files ---
app.use("/assets/*", serveStatic({ root: "dist/public" }));
app.get("/favicon.ico", serveStatic({ path: "dist/public/favicon.ico" }));
app.get("/apple-touch-icon.png", serveStatic({ path: "dist/public/apple-touch-icon.png" }));
app.get("/icon-192.png", serveStatic({ path: "dist/public/icon-192.png" }));
app.get("/icon-512.png", serveStatic({ path: "dist/public/icon-512.png" }));
app.get("/site.webmanifest", serveStatic({ path: "dist/public/site.webmanifest" }));
app.get(
  "/app.js",
  serveStatic({
    path: "dist/public/app.js",
    onFound: (_path, c) => setNoCacheHeaders(c),
  })
);
app.get(
  "/app.js.map",
  serveStatic({
    path: "dist/public/app.js.map",
    onFound: (_path, c) => setNoCacheHeaders(c),
  })
);
app.get(
  "/style.css",
  serveStatic({
    path: "dist/public/style.css",
    onFound: (_path, c) => setNoCacheHeaders(c),
  })
);

// --- OAuth protected resource metadata (for MCP discovery) ---
const SUPABASE_URL = process.env.SUPABASE_URL || "";
app.get("/.well-known/oauth-protected-resource", (c) => {
  return c.json({
    resource: "https://perchpad.co",
    authorization_servers: [`${SUPABASE_URL}/auth/v1`],
    bearer_methods_supported: ["header"],
  });
});

// --- Share link (public, no auth) ---
app.get("/s/:token", async (c) => {
  const token = c.req.param("token");
  const link = await getShareLink(token);
  if (!link) return c.text("Link not found", 404);

  const filePath = join(PROJECTS_DIR, link.project_id, link.file_path);
  try {
    const content = await fs.readFile(filePath, "utf-8");
    const html = sharePageHtml(link.file_path, content, token);
    return c.html(html);
  } catch {
    return c.text("File not found", 404);
  }
});

// --- Landing page (public, no auth) ---
app.get("/", async (c) => {
  return c.html(landingPageHtml());
});

// --- FAQ redirect (content now on landing page) ---
app.get("/faq", (c) => {
  return c.redirect("/#faq");
});

// --- Public invitation info (no auth) ---
app.get("/api/invitations/:id/info", async (c) => {
  const invId = c.req.param("id");
  const { data: inv, error } = await supabaseAdmin
    .from("invitations")
    .select("id, status, email, project_id, projects(name)")
    .eq("id", invId)
    .single();
  if (error || !inv) return c.json({ error: "Invitation not found" }, 404);
  const email = inv.email;
  const masked =
    email.length > 3
      ? email.slice(0, 2) + "***@" + email.split("@")[1]
      : "***@" + email.split("@")[1];
  return c.json({
    id: inv.id,
    projectName: (inv as any).projects?.name ?? "Unknown project",
    email: masked,
    status: inv.status,
  });
});

// --- Contact form (no auth) ---
app.post("/api/contact", async (c) => {
  const { name, email, message } = await c.req.json<{ name: string; email: string; message: string }>();
  if (!name?.trim() || !email?.trim() || !message?.trim()) {
    return c.json({ error: "All fields are required" }, 400);
  }
  if (message.trim().length > 5000) {
    return c.json({ error: "Message too long" }, 400);
  }
  try {
    await sendEmail({
      to: "max@markets.sh",
      subject: `[Perchpad Contact] from ${name.trim()}`,
      body: `From: ${name.trim()} <${email.trim()}>\n\n${message.trim()}`,
      replyTo: email.trim(),
    });
    return c.json({ ok: true });
  } catch (err: any) {
    console.error("Contact form error:", err);
    return c.json({ error: "Failed to send message" }, 500);
  }
});

// --- Webhook: Resend inbound email (no auth) ---
app.post("/api/webhooks/resend", async (c) => {
  try {
    const rawBody = await c.req.text();
    const headers: Record<string, string> = {
      "svix-id": c.req.header("svix-id") ?? "",
      "svix-timestamp": c.req.header("svix-timestamp") ?? "",
      "svix-signature": c.req.header("svix-signature") ?? "",
    };
    const payload = verifyWebhookSignature(rawBody, headers);
    // Phase 1: persist metadata to DB synchronously, return 200 fast
    const record = await receiveInboundEmail(payload);
    if (record) {
      // Phase 2: fetch full content from Resend API + run AI agent (async)
      fetchEmailContentAndProcess(record).catch((err) =>
        console.error("[webhook] Error processing inbound email:", err)
      );
    }
    return c.json({ ok: true });
  } catch (err: any) {
    console.error("[webhook] Signature verification failed:", err.message);
    return c.json({ error: "Invalid signature" }, 401);
  }
});

// --- API: Auth required ---
const api = new Hono();
api.use("/*", authMiddleware);

// User profile (handle)
api.get("/user/profile", async (c) => {
  const user = getUser(c);
  const handle = await getUserHandle(user.id);
  return c.json({ handle });
});

// User preferences
api.get("/user/preferences", async (c) => {
  const user = getUser(c);
  const { data: { user: authUser } } = await supabaseAdmin.auth.admin.getUserById(user.id);
  if (!authUser) return c.json({ error: "User not found" }, 404);
  return c.json(authUser.user_metadata?.preferences || {});
});

api.put("/user/preferences", async (c) => {
  const user = getUser(c);
  const preferences = await c.req.json();
  const { data: { user: authUser } } = await supabaseAdmin.auth.admin.getUserById(user.id);
  if (!authUser) return c.json({ error: "User not found" }, 404);
  await supabaseAdmin.auth.admin.updateUserById(user.id, {
    user_metadata: { ...authUser.user_metadata, preferences },
  });
  return c.json({ ok: true });
});

// API Keys
api.post("/keys", async (c) => {
  const user = getUser(c);
  const { name } = await c.req.json<{ name?: string }>().catch(() => ({ name: undefined }));
  const rawKey = "pp_" + randomBytes(32).toString("hex");
  const keyHash = createHash("sha256").update(rawKey).digest("hex");
  const { data, error } = await supabaseAdmin
    .from("api_keys")
    .insert({ user_id: user.id, key_hash: keyHash, name: name || "Untitled" })
    .select("id, name, created_at")
    .single();
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ key: rawKey, id: data.id, name: data.name, created_at: data.created_at });
});

api.get("/keys", async (c) => {
  const user = getUser(c);
  const { data, error } = await supabaseAdmin
    .from("api_keys")
    .select("id, name, created_at, last_used_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ keys: data });
});

api.delete("/keys/:id", async (c) => {
  const user = getUser(c);
  const keyId = c.req.param("id");
  const { error } = await supabaseAdmin
    .from("api_keys")
    .delete()
    .eq("id", keyId)
    .eq("user_id", user.id);
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ ok: true });
});

// Ensure user has a default API key (auto-creates on first call)
api.post("/keys/ensure-default", async (c) => {
  const user = getUser(c);

  // Check if user already has a stored default key in metadata
  const { data: { user: authUser } } = await supabaseAdmin.auth.admin.getUserById(user.id);
  const existingDefault = authUser?.user_metadata?.default_api_key;
  if (existingDefault) {
    // Verify the key still exists in the database
    const keyHash = createHash("sha256").update(existingDefault).digest("hex");
    const { data: still } = await supabaseAdmin
      .from("api_keys")
      .select("id")
      .eq("key_hash", keyHash)
      .maybeSingle();
    if (still) {
      return c.json({ key: existingDefault, created: false });
    }
  }

  // No valid default key — create one
  const rawKey = "pp_" + randomBytes(32).toString("hex");
  const keyHash = createHash("sha256").update(rawKey).digest("hex");
  const { error } = await supabaseAdmin
    .from("api_keys")
    .insert({ user_id: user.id, key_hash: keyHash, name: "Default" })
    .select("id")
    .single();
  if (error) return c.json({ error: error.message }, 500);

  // Store raw key in user_metadata so we can return it on future calls
  await supabaseAdmin.auth.admin.updateUserById(user.id, {
    user_metadata: { ...authUser?.user_metadata, default_api_key: rawKey },
  });

  return c.json({ key: rawKey, created: true });
});

// Projects
api.get("/projects", async (c) => {
  const user = getUser(c);
  const projects = await getUserProjects(user.id);
  return c.json({ projects });
});

api.post("/projects", async (c) => {
  const user = getUser(c);
  const body = await c.req.json<{
    name: string;
    mode?: "template" | "empty" | "ai";
    templateId?: string;
    prompt?: string;
  }>();
  if (!body.name?.trim()) return c.json({ error: "Name required" }, 400);

  const project = await createProject(body.name.trim(), user.id);

  try {
    if (body.mode === "template" && body.templateId) {
      await seedFromTemplate(project.id, body.templateId);
    } else if (body.mode === "empty") {
      await seedEmpty(project.id);
    } else if (body.mode === "ai" && body.prompt) {
      const files = await generateWorkspaceFiles(body.prompt, user.id);
      await seedFromFiles(project.id, files);
    } else {
      // Legacy fallback — no mode specified
      await seedTemplate(project.id);
    }
  } catch (err: any) {
    console.error("[projects] Seed error:", err.message);
    // If AI generation fails, still return the project but with an error hint
    if (body.mode === "ai") {
      // Seed empty as fallback so the project isn't broken
      await seedEmpty(project.id);
      await initRepo(project.id);
      return c.json({ project, warning: err.message }, 201);
    }
  }

  await initRepo(project.id);
  return c.json({ project });
});

api.patch("/projects/:id", async (c) => {
  const user = getUser(c);
  const projectId = c.req.param("id");
  const membership = await getProjectMembership(projectId, user.id);
  if (!membership || membership.role !== "owner") return c.json({ error: "Only owners can rename" }, 403);
  const body = await c.req.json<{ name?: string }>();
  if (!body.name?.trim()) return c.json({ error: "Name required" }, 400);
  const { error } = await supabaseAdmin
    .from("projects")
    .update({ name: body.name.trim() })
    .eq("id", projectId);
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ ok: true, name: body.name.trim() });
});

api.get("/projects/:id/members", async (c) => {
  const user = getUser(c);
  const projectId = c.req.param("id");
  const membership = await getProjectMembership(projectId, user.id);
  if (!membership) return c.json({ error: "Access denied" }, 403);
  const members = await getProjectMembers(projectId);
  return c.json({ members });
});

// Update member role
api.put("/projects/:id/members/:userId", async (c) => {
  const user = getUser(c);
  const projectId = c.req.param("id");
  const targetUserId = c.req.param("userId");
  const membership = await getProjectMembership(projectId, user.id);
  if (!membership || membership.role !== "owner") {
    return c.json({ error: "Only owners can change roles" }, 403);
  }
  // Prevent changing your own role
  if (targetUserId === user.id) {
    return c.json({ error: "Cannot change your own role" }, 400);
  }
  const { role } = await c.req.json<{ role: string }>();
  const validRoles = ["owner", "editor", "viewer"];
  if (!validRoles.includes(role)) {
    return c.json({ error: "Invalid role" }, 400);
  }
  const { error } = await supabaseAdmin
    .from("project_members")
    .update({ role })
    .eq("project_id", projectId)
    .eq("user_id", targetUserId);
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ ok: true });
});

// Remove member
api.delete("/projects/:id/members/:userId", async (c) => {
  const user = getUser(c);
  const projectId = c.req.param("id");
  const targetUserId = c.req.param("userId");
  const membership = await getProjectMembership(projectId, user.id);
  if (!membership || membership.role !== "owner") {
    return c.json({ error: "Only owners can remove members" }, 403);
  }
  // Prevent removing yourself
  if (targetUserId === user.id) {
    return c.json({ error: "Cannot remove yourself" }, 400);
  }
  const { error } = await supabaseAdmin
    .from("project_members")
    .delete()
    .eq("project_id", projectId)
    .eq("user_id", targetUserId);
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ ok: true });
});

// Leave project (non-owner self-removal)
api.post("/projects/:id/leave", async (c) => {
  const user = getUser(c);
  const projectId = c.req.param("id");
  const membership = await getProjectMembership(projectId, user.id);
  if (!membership) {
    return c.json({ error: "Not a member" }, 404);
  }
  if (membership.role === "owner") {
    return c.json({ error: "Owners cannot leave. Transfer ownership first." }, 400);
  }
  const { error } = await supabaseAdmin
    .from("project_members")
    .delete()
    .eq("project_id", projectId)
    .eq("user_id", user.id);
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ ok: true });
});

// Invitations
api.post("/projects/:id/invite", async (c) => {
  const user = getUser(c);
  const projectId = c.req.param("id");
  const membership = await getProjectMembership(projectId, user.id);
  if (!membership || membership.role !== "owner") {
    return c.json({ error: "Only owners can invite" }, 403);
  }
  const { email: rawEmail, role: rawRole } = await c.req.json<{ email: string; role?: string }>();
  if (!rawEmail?.trim()) return c.json({ error: "Email required" }, 400);
  const email = rawEmail.trim().toLowerCase();
  const validRoles = ["owner", "editor", "viewer"] as const;
  const role = validRoles.includes(rawRole as any) ? (rawRole as "owner" | "editor" | "viewer") : "editor";

  // Check for duplicate pending invitation
  const { data: existing } = await supabaseAdmin
    .from("invitations")
    .select("id")
    .eq("project_id", projectId)
    .eq("email", email)
    .eq("status", "pending")
    .maybeSingle();
  if (existing) return c.json({ error: "Invitation already pending" }, 409);

  const invitation = await createInvitation(projectId, email, user.id, role);

  // Look up project name + inviter display name for the email
  const { data: project } = await supabaseAdmin
    .from("projects")
    .select("name")
    .eq("id", projectId)
    .single();
  const {
    data: { user: authUser },
  } = await supabaseAdmin.auth.admin.getUserById(user.id);
  const inviterName =
    authUser?.user_metadata?.display_name ||
    authUser?.user_metadata?.full_name ||
    authUser?.email ||
    "Someone";

  // Fire-and-forget email
  sendInvitationEmail({
    to: email,
    invitationId: invitation.id,
    projectName: project?.name ?? "Untitled",
    inviterName,
  });

  return c.json({ invitation });
});

api.get("/invitations", async (c) => {
  const user = getUser(c);
  // Get user email from Supabase
  const {
    data: { user: authUser },
  } = await supabaseAdmin.auth.admin.getUserById(user.id);
  if (!authUser?.email) return c.json({ invitations: [] });

  const { data, error } = await supabaseAdmin
    .from("invitations")
    .select("*, projects(name)")
    .eq("email", authUser.email)
    .eq("status", "pending");
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ invitations: data });
});

api.post("/invitations/:id/accept", async (c) => {
  const user = getUser(c);
  const invId = c.req.param("id");

  // Fetch invitation and verify status
  const { data: inv, error: invErr } = await supabaseAdmin
    .from("invitations")
    .select("*")
    .eq("id", invId)
    .single();
  if (invErr || !inv) return c.json({ error: "Invitation not found" }, 404);
  if (inv.status !== "pending")
    return c.json({ error: "Invitation is no longer pending" }, 400);

  // Verify accepting user's email matches invitation email
  const {
    data: { user: authUser },
  } = await supabaseAdmin.auth.admin.getUserById(user.id);
  if (
    !authUser?.email ||
    authUser.email.toLowerCase() !== inv.email.toLowerCase()
  ) {
    return c.json({ error: "This invitation was sent to a different email" }, 403);
  }

  await acceptInvitation(invId, user.id);
  return c.json({ ok: true, project_id: inv.project_id });
});

api.post("/invitations/:id/decline", async (c) => {
  const user = getUser(c);
  const invId = c.req.param("id");

  const { data: inv, error: invErr } = await supabaseAdmin
    .from("invitations")
    .select("*")
    .eq("id", invId)
    .single();
  if (invErr || !inv) return c.json({ error: "Invitation not found" }, 404);
  if (inv.status !== "pending")
    return c.json({ error: "Invitation is no longer pending" }, 400);

  // Verify declining user's email matches invitation email
  const {
    data: { user: authUser },
  } = await supabaseAdmin.auth.admin.getUserById(user.id);
  if (
    !authUser?.email ||
    authUser.email.toLowerCase() !== inv.email.toLowerCase()
  ) {
    return c.json({ error: "This invitation was sent to a different email" }, 403);
  }

  await supabaseAdmin
    .from("invitations")
    .update({ status: "declined" })
    .eq("id", invId);
  return c.json({ ok: true });
});

// Share links
api.post("/projects/:id/share", async (c) => {
  const user = getUser(c);
  const projectId = c.req.param("id");
  const membership = await getProjectMembership(projectId, user.id);
  if (!membership || !["owner", "editor"].includes(membership.role)) {
    return c.json({ error: "Access denied" }, 403);
  }
  const { filePath } = await c.req.json<{ filePath: string }>();
  if (!filePath) return c.json({ error: "File path required" }, 400);
  const link = await createShareLink(projectId, filePath, user.id);
  return c.json({ link });
});

// Files
api.route("/files", fileSearchRouter);
api.route("/files", filesRouter);

// Chat sessions (REST for listing/getting)
api.get("/chat/:projectId/sessions", async (c) => {
  const user = getUser(c);
  const projectId = c.req.param("projectId");
  const membership = await getProjectMembership(projectId, user.id);
  if (!membership) return c.json({ error: "Access denied" }, 403);
  const sessions = await listSessions(projectId);
  return c.json({ sessions });
});

api.get("/chat/:projectId/sessions/:sessionId", async (c) => {
  const user = getUser(c);
  const projectId = c.req.param("projectId");
  const sessionId = c.req.param("sessionId");
  const membership = await getProjectMembership(projectId, user.id);
  if (!membership) return c.json({ error: "Access denied" }, 403);
  const session = await getSession(projectId, sessionId);
  if (!session) return c.json({ error: "Session not found" }, 404);
  return c.json({ session });
});

api.post("/chat/:projectId/sessions", async (c) => {
  const user = getUser(c);
  const projectId = c.req.param("projectId");
  const membership = await getProjectMembership(projectId, user.id);
  if (!membership) return c.json({ error: "Access denied" }, 403);
  const session = await createSession(projectId);
  return c.json({ session });
});

api.delete("/chat/:projectId/sessions/:sessionId", async (c) => {
  const user = getUser(c);
  const projectId = c.req.param("projectId");
  const sessionId = c.req.param("sessionId");
  const membership = await getProjectMembership(projectId, user.id);
  if (!membership) return c.json({ error: "Access denied" }, 403);
  await deleteSession(projectId, sessionId);
  return c.json({ ok: true });
});

// Project settings (.perchpad.json)
api.get("/projects/:id/settings", async (c) => {
  const user = getUser(c);
  const projectId = c.req.param("id");
  const membership = await getProjectMembership(projectId, user.id);
  if (!membership) return c.json({ error: "Access denied" }, 403);
  const settingsPath = join(PROJECTS_DIR, projectId, ".perchpad.json");
  try {
    const raw = await fs.readFile(settingsPath, "utf-8");
    return c.json(JSON.parse(raw));
  } catch {
    return c.json({});
  }
});

api.put("/projects/:id/settings", async (c) => {
  const user = getUser(c);
  const projectId = c.req.param("id");
  const membership = await getProjectMembership(projectId, user.id);
  if (!membership) return c.json({ error: "Access denied" }, 403);
  const settings = await c.req.json();
  const settingsPath = join(PROJECTS_DIR, projectId, ".perchpad.json");
  await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), "utf-8");
  return c.json({ ok: true });
});

// Incoming emails list
api.get("/projects/:id/emails", async (c) => {
  const user = getUser(c);
  const projectId = c.req.param("id");
  const membership = await getProjectMembership(projectId, user.id);
  if (!membership) return c.json({ error: "Access denied" }, 403);
  const { data, error } = await supabaseAdmin
    .from("incoming_emails")
    .select("id, from_address, subject, status, error, created_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ emails: data });
});

// Send test email (simulates inbound flow)
api.post("/projects/:id/emails/test", async (c) => {
  const user = getUser(c);
  const projectId = c.req.param("id");
  const membership = await getProjectMembership(projectId, user.id);
  if (!membership) return c.json({ error: "Access denied" }, 403);

  const { data: { user: authUser } } = await supabaseAdmin.auth.admin.getUserById(user.id);
  const userEmail = authUser?.email;
  if (!userEmail) return c.json({ error: "No email on account" }, 400);

  let projectEmail = await getProjectEmail(projectId);
  if (!projectEmail) projectEmail = await assignProjectEmail(projectId);

  // Phase 1: persist to DB synchronously
  const payload = {
    data: {
      from: userEmail,
      to: [projectEmail],
      subject: "Test email",
      text: "This is a test email sent from the Perchpad UI to verify inbound email processing is working.",
      email_id: `test-${Date.now()}`,
    },
  };
  const record = await receiveInboundEmail(payload);
  if (record) {
    // Test emails have body inline — set it directly, then process
    record.body_text = payload.data.text;
    processInboundEmail(record).catch((err) =>
      console.error("[test-email] Error:", err)
    );
  }

  return c.json({ ok: true });
});

// Project email address
api.get("/projects/:id/email", async (c) => {
  const user = getUser(c);
  const projectId = c.req.param("id");
  const membership = await getProjectMembership(projectId, user.id);
  if (!membership) return c.json({ error: "Access denied" }, 403);

  let email = await getProjectEmail(projectId);
  if (!email) {
    // Lazy backfill for existing projects
    email = await assignProjectEmail(projectId);
  }
  return c.json({ email });
});

// Credits
api.get("/credits/balance", async (c) => {
  const user = getUser(c);
  const result = await getAvailableBalance(user.id);
  return c.json(result);
});

api.get("/credits/transactions", async (c) => {
  const user = getUser(c);
  const limit = parseInt(c.req.query("limit") || "50");
  const offset = parseInt(c.req.query("offset") || "0");
  const transactions = await getTransactions(user.id, limit, offset);
  return c.json({ transactions });
});

// Git history (revisions)
api.get("/projects/:id/revisions", async (c) => {
  const user = getUser(c);
  const projectId = c.req.param("id");
  const membership = await getProjectMembership(projectId, user.id);
  if (!membership) return c.json({ error: "Access denied" }, 403);
  const limit = parseInt(c.req.query("limit") || "20");
  const offset = parseInt(c.req.query("offset") || "0");
  const history = await getHistory(projectId, { limit, offset });
  return c.json({ revisions: history });
});

api.get("/projects/:id/status", async (c) => {
  const user = getUser(c);
  const projectId = c.req.param("id");
  const membership = await getProjectMembership(projectId, user.id);
  if (!membership) return c.json({ error: "Access denied" }, 403);
  const status = await getUncommittedStatus(projectId);
  return c.json(status);
});

api.post("/projects/:id/commit", async (c) => {
  const user = getUser(c);
  const projectId = c.req.param("id");
  const membership = await getProjectMembership(projectId, user.id);
  if (!membership) return c.json({ error: "Access denied" }, 403);
  const { message } = await c.req.json<{ message?: string }>();
  try {
    const result = await manualCommit(projectId, message);
    return c.json(result);
  } catch (err: any) {
    return c.json({ error: err.message }, 400);
  }
});

api.get("/projects/:id/revisions/:hash", async (c) => {
  const user = getUser(c);
  const projectId = c.req.param("id");
  const hash = c.req.param("hash");
  const membership = await getProjectMembership(projectId, user.id);
  if (!membership) return c.json({ error: "Access denied" }, 403);
  const changes = await getCommitDiff(projectId, hash);
  return c.json({ changes });
});

// Mount API
app.route("/api", api);
app.route("/api", ttsRouter);
app.route("/mcp", mcpRouter);
app.route("/git", gitRouter);

// --- WebSocket ---
app.get(
  "/ws/:projectId",
  upgradeWebSocket((c) => {
    const projectId = c.req.param("projectId");
    // We'll validate auth in the open handler
    return {
      async onOpen(_event, wsWrapper) {
        // Extract token from query param
        const url = new URL(c.req.url, "http://localhost");
        const token = url.searchParams.get("token");
        if (!token) {
          wsWrapper.close(4001, "No token provided");
          return;
        }

        // Verify token
        const {
          data: { user },
          error,
        } = await supabaseAdmin.auth.getUser(token);
        if (error || !user) {
          wsWrapper.close(4001, "Invalid token");
          return;
        }

        // Check project membership
        const membership = await getProjectMembership(projectId, user.id);
        if (!membership) {
          wsWrapper.close(4003, "Not a project member");
          return;
        }

        // Add to WS manager — we need the raw underlying ws
        const rawWs = (wsWrapper as any).raw;
        if (rawWs) {
          addClient(projectId, rawWs, user.id);
        }
      },
    };
  })
);

// --- SPA fallback ---
app.get("*", async (c) => {
  let html = await fs.readFile("dist/public/index.html", "utf-8");
  const baseUrl = new URL(c.req.url).origin;
  // Inject config
  html = html
    .replaceAll("%%ASSET_VERSION%%", ASSET_VERSION)
    .replaceAll("%%BASE_URL%%", baseUrl)
    .replace("%%SUPABASE_URL%%", process.env.SUPABASE_URL || "")
    .replace("%%SUPABASE_ANON_KEY%%", process.env.SUPABASE_ANON_KEY || "");
  return c.html(html);
});

// --- Start server ---
const port = parseInt(process.env.PORT || "3000");
const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Perchpad running at http://localhost:${info.port}`);
});

injectWebSocket(server);

// Cleanup stale credit holds every 5 minutes
setInterval(() => {
  releaseStaleHolds().then((count) => {
    if (count > 0) console.log(`[credits] Released ${count} stale hold(s)`);
  }).catch((err) => console.error("[credits] Stale hold cleanup error:", err));
}, 5 * 60 * 1000);

// Share page HTML
function sharePageHtml(
  filePath: string,
  content: string,
  _token: string
): string {
  const fileName = filePath.split("/").pop() || filePath;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${fileName} — Perchpad</title>
  <link rel="stylesheet" href="/style.css?v=${ASSET_VERSION}">
  <style>
    body { background: #faf5ff; margin: 0; padding: 2rem; font-family: system-ui, -apple-system, sans-serif; }
    .share-container { max-width: 800px; margin: 0 auto; background: #fff; border-radius: 1rem; padding: 2rem; border: 1px solid #e8dff0; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.05); }
    .share-header { color: #4a4458; margin-bottom: 1.5rem; padding-bottom: 1rem; border-bottom: 1px solid #e8dff0; }
    .share-header h1 { font-size: 1.25rem; margin: 0; }
    .share-header .brand { color: #8e849b; font-size: 0.875rem; }
    .share-content { color: #4a4458; line-height: 1.7; white-space: pre-wrap; font-family: system-ui, -apple-system, sans-serif; }
  </style>
</head>
<body>
  <div class="share-container">
    <div class="share-header">
      <p class="brand">Shared via Perchpad</p>
      <h1>${fileName}</h1>
    </div>
    <div class="share-content">${escapeHtml(content)}</div>
  </div>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const isDev = !process.env.FLY_IMAGE_REF;

function landingPageHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Perchpad — A collaborative writing workspace</title>
  <meta name="description" content="A calm writing workspace with a smart little bird. Organize projects, write in markdown, and collaborate in real time.">
  <meta property="og:type" content="website">
  <meta property="og:url" content="https://perchpad.co/">
  <meta property="og:title" content="Perchpad — A writing workspace that thinks with you">
  <meta property="og:description" content="Organize projects, write in markdown, and collaborate in real time — with a thoughtful little bird that reads your files, drafts with you, and keeps everything in order.">
  <meta property="og:image" content="https://perchpad.co/assets/og.jpg">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="628">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="Perchpad — A writing workspace that thinks with you">
  <meta name="twitter:description" content="Organize projects, write in markdown, and collaborate in real time — with a thoughtful little bird that reads your files, drafts with you, and keeps everything in order.">
  <meta name="twitter:image" content="https://perchpad.co/assets/og.jpg">
  <link rel="icon" href="/favicon.ico" sizes="32x32">
  <link rel="icon" href="/icon-192.png" type="image/png" sizes="192x192">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png">
  <link rel="manifest" href="/site.webmanifest">
  <meta name="theme-color" content="#faf6f1">
  <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700;800&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/style.css?v=${ASSET_VERSION}">
  <script async src="https://www.googletagmanager.com/gtag/js?id=G-Z3V6P9TKHC"></script>
  <script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config','G-Z3V6P9TKHC')</script>
</head>
<body class="bg-bg text-text">

  <nav class="flex items-center justify-between max-w-[1100px] mx-auto px-6 py-4 sm:px-8 sm:py-5">
    <a href="/" class="flex items-center gap-2 font-heading text-[1.35rem] font-bold text-text">
      <img src="/assets/logo.png" alt="" class="h-7 w-auto">Perchpad
    </a>
    <div id="nav-actions" class="flex items-center gap-5">
      <a href="/login" class="text-[0.95rem] text-text-secondary font-medium hover:text-text transition-colors">Sign In</a>
      <a href="/login" class="inline-block bg-dark text-white px-5 py-2 rounded-lg text-[0.9rem] font-semibold hover:opacity-85 transition-opacity">Get Started</a>
    </div>
    <script>
      try {
        var sb = JSON.parse(localStorage.getItem('sb-' + location.hostname + '-auth-token') || '{}');
        if (!sb.access_token) {
          var keys = Object.keys(localStorage);
          for (var i = 0; i < keys.length; i++) {
            if (keys[i].indexOf('auth-token') !== -1) { sb = JSON.parse(localStorage.getItem(keys[i]) || '{}'); break; }
          }
        }
        if (sb.access_token && sb.expires_at && sb.expires_at > Math.floor(Date.now() / 1000)) {
          document.getElementById('nav-actions').innerHTML =
            '<a href="/projects" class="inline-block bg-dark text-white px-5 py-2 rounded-lg text-[0.9rem] font-semibold hover:opacity-85 transition-opacity">Go to Projects</a>';
        }
      } catch(e) {}
    </script>
  </nav>

  <section class="max-w-[1100px] mx-auto px-6 pt-8 sm:px-8 sm:pt-16">
    <div class="flex flex-col gap-5 mb-8 sm:flex-row sm:items-center sm:gap-12 sm:mb-12">
      <div class="sm:flex-[1.2]">
        <h1 class="font-heading text-4xl sm:text-[3.5rem] font-extrabold leading-[1.1] text-dark tracking-tight">A writing workspace that thinks with you</h1>
      </div>
      <div class="sm:flex-1">
        <p class="text-lg text-text-body leading-relaxed">Organize projects, write in markdown, and collaborate in real time — with a thoughtful little bird that reads your files, drafts with you, and keeps everything in order.</p>
      </div>
    </div>
    <picture>
      <source media="(max-width: 640px)" srcset="/assets/hero-mobile.jpg">
      <img src="/assets/hero.jpg" alt="A person writing under a tree with a bird perched on a branch" loading="eager" class="w-full rounded-2xl block">
    </picture>
  </section>

  <section class="max-w-[1100px] mx-auto px-6 pt-8 pb-12 sm:px-8">
    <h2 class="font-heading text-[1.75rem] text-center mb-8 text-text">A calm place to get things done</h2>
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-5">
      <div class="bg-white border border-border rounded-2xl p-7 shadow-sm">
        <svg class="w-7 h-7 mb-3 text-accent" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M213.66,82.34l-56-56A8,8,0,0,0,152,24H56A16,16,0,0,0,40,40V216a16,16,0,0,0,16,16H200a16,16,0,0,0,16-16V88A8,8,0,0,0,213.66,82.34ZM152,88V44l44,44Z" opacity="0.2"/><path d="M213.66,82.34l-56-56A8,8,0,0,0,152,24H56A16,16,0,0,0,40,40V216a16,16,0,0,0,16,16H200a16,16,0,0,0,16-16V88A8,8,0,0,0,213.66,82.34ZM160,51.31,188.69,80H160ZM200,216H56V40h88V88a8,8,0,0,0,8,8h48V216Z"/></svg>
        <h3 class="text-[1.1rem] mb-2 text-text">Plain Flat Files</h3>
        <p class="text-[0.95rem] text-text-secondary leading-relaxed">Your project is just files on disk — markdown, CSV, whatever you need. No database, no proprietary format, no lock-in. Download, move, or back up the whole thing anytime.</p>
      </div>
      <div class="bg-white border border-border rounded-2xl p-7 shadow-sm">
        <svg class="w-7 h-7 mb-3 text-accent" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M224,64a24,24,0,1,1-24-24A24,24,0,0,1,224,64Z" opacity="0.2"/><path d="M232,64a32,32,0,1,0-40,31v17a8,8,0,0,1-8,8H96a23.84,23.84,0,0,0-8,1.38V95a32,32,0,1,0-16,0v66a32,32,0,1,0,16,0V144a8,8,0,0,1,8-8h88a24,24,0,0,0,24-24V95A32.06,32.06,0,0,0,232,64ZM64,64A16,16,0,1,1,80,80,16,16,0,0,1,64,64ZM96,192a16,16,0,1,1-16-16A16,16,0,0,1,96,192ZM200,80a16,16,0,1,1,16-16A16,16,0,0,1,200,80Z"/></svg>
        <h3 class="text-[1.1rem] mb-2 text-text">Git Built In</h3>
        <p class="text-[0.95rem] text-text-secondary leading-relaxed">Every workspace is a real git repo. Clone it, push to it, pull from it — standard commands just work. Use the web editor or your terminal, it's the same repo.</p>
      </div>
      <div class="bg-white border border-border rounded-2xl p-7 shadow-sm">
        <svg class="w-7 h-7 mb-3 text-accent" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M200,48H136V16a8,8,0,0,0-16,0V48H56A16,16,0,0,0,40,64V192a16,16,0,0,0,16,16H200a16,16,0,0,0,16-16V64A16,16,0,0,0,200,48Z" opacity="0.2"/><path d="M200,48H136V16a8,8,0,0,0-16,0V48H56A16,16,0,0,0,40,64V192a16,16,0,0,0,16,16H200a16,16,0,0,0,16-16V64A16,16,0,0,0,200,48Zm0,144H56V64H200V192ZM80,96a8,8,0,0,1,8-8h80a8,8,0,0,1,0,16H88A8,8,0,0,1,80,96Zm0,32a8,8,0,0,1,8-8h80a8,8,0,0,1,0,16H88A8,8,0,0,1,80,128Zm0,32a8,8,0,0,1,8-8h48a8,8,0,0,1,0,16H88A8,8,0,0,1,80,160Z"/></svg>
        <h3 class="text-[1.1rem] mb-2 text-text">LLM Ready</h3>
        <p class="text-[0.95rem] text-text-secondary leading-relaxed">No heavy Word or PowerPoint blobs. Plain text that any AI tool can read and edit directly — Claude, Cursor, your own scripts. Built for the way people work now.</p>
      </div>
      <div class="bg-white border border-border rounded-2xl p-7 shadow-sm">
        <svg class="w-7 h-7 mb-3 text-accent" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M232,80,208,96v24a96,96,0,0,1-96,96H24a8,8,0,0,1-6.25-13L104,99.52V76.89c0-28.77,23-52.75,51.74-52.89a52,52,0,0,1,50.59,38.89Z" opacity="0.2"/><path d="M176,68a12,12,0,1,1-12-12A12,12,0,0,1,176,68Zm64,12a8,8,0,0,1-3.56,6.66L216,100.28V120A104.11,104.11,0,0,1,112,224H24a16,16,0,0,1-12.49-26l.1-.12L96,96.63V76.89C96,43.47,122.79,16.16,155.71,16H156a60,60,0,0,1,57.21,41.86l23.23,15.48A8,8,0,0,1,240,80Zm-22.42,0L201.9,69.54a8,8,0,0,1-3.31-4.64A44,44,0,0,0,156,32h-.22C131.64,32.12,112,52.25,112,76.89V99.52a8,8,0,0,1-1.85,5.13L24,208h26.9l70.94-85.12a8,8,0,1,1,12.29,10.24L71.75,208H112a88.1,88.1,0,0,0,88-88V96a8,8,0,0,1,3.56-6.66Z"/></svg>
        <h3 class="text-[1.1rem] mb-2 text-text">A Smart Little Bird</h3>
        <p class="text-[0.95rem] text-text-secondary leading-relaxed">A friendly AI assistant that lives in your workspace. It can read your files, help you draft, organize your thoughts, and answer questions — like a companion that quietly knows the whole project.</p>
      </div>
    </div>
  </section>

  <section class="max-w-[1100px] mx-auto px-6 pb-12 sm:px-8">
    <h2 class="font-heading text-[1.35rem] text-center mb-6 text-text-body font-semibold">And a few more things you might like</h2>
    <div class="grid grid-cols-2 sm:grid-cols-3 gap-4">
      <div class="text-center px-4 py-5">
        <svg class="w-5 h-5 mx-auto mb-2 text-text-secondary" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M208,88H152V32Z" opacity="0.2"/><path d="M213.66,82.34l-56-56A8,8,0,0,0,152,24H56A16,16,0,0,0,40,40V216a16,16,0,0,0,16,16H200a16,16,0,0,0,16-16V88A8,8,0,0,0,213.66,82.34ZM160,51.31,188.69,80H160ZM200,216H56V40h88V88a8,8,0,0,0,8,8h48V216Zm-32-80a8,8,0,0,1-8,8H96a8,8,0,0,1,0-16h64A8,8,0,0,1,168,136Zm0,32a8,8,0,0,1-8,8H96a8,8,0,0,1,0-16h64A8,8,0,0,1,168,168Z"/></svg>
        <h3 class="text-[0.95rem] text-text font-semibold mb-1">Markdown-Based</h3>
        <p class="text-[0.85rem] text-text-secondary leading-relaxed">Write in plain markdown with live preview. No proprietary formats — your files are always yours.</p>
      </div>
      <div class="text-center px-4 py-5">
        <svg class="w-5 h-5 mx-auto mb-2 text-text-secondary" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M216,128a88,88,0,1,1-88-88A88,88,0,0,1,216,128Z" opacity="0.2"/><path d="M136,80v43.47l36.12,21.67a8,8,0,0,1-8.24,13.72l-40-24A8,8,0,0,1,120,128V80a8,8,0,0,1,16,0Zm-8-48A95.44,95.44,0,0,0,60.08,60.15C52.81,67.51,46.35,74.59,40,82V64a8,8,0,0,0-16,0v40a8,8,0,0,0,8,8H72a8,8,0,0,0,0-16H49c7.15-8.42,14.27-16.35,22.39-24.57a80,80,0,1,1,1.66,114.75,8,8,0,1,0-11,11.64A96,96,0,1,0,128,32Z"/></svg>
        <h3 class="text-[0.95rem] text-text font-semibold mb-1">Never Lose a Thing</h3>
        <p class="text-[0.85rem] text-text-secondary leading-relaxed">Auto-saves every minute with full version history. Go back to any point, no manual saving needed.</p>
      </div>
      <div class="text-center px-4 py-5">
        <svg class="w-5 h-5 mx-auto mb-2 text-text-secondary" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M200,48H56a8,8,0,0,0-8,8V200a8,8,0,0,0,8,8H200a8,8,0,0,0,8-8V56A8,8,0,0,0,200,48ZM152,152H104V104h48Z" opacity="0.2"/><path d="M152,96H104a8,8,0,0,0-8,8v48a8,8,0,0,0,8,8h48a8,8,0,0,0,8-8V104A8,8,0,0,0,152,96Zm-8,48H112V112h32Zm88,0H216V112h16a8,8,0,0,0,0-16H216V56a16,16,0,0,0-16-16H160V24a8,8,0,0,0-16,0V40H112V24a8,8,0,0,0-16,0V40H56A16,16,0,0,0,40,56V96H24a8,8,0,0,0,0,16H40v32H24a8,8,0,0,0,0,16H40v40a16,16,0,0,0,16,16H96v16a8,8,0,0,0,16,0V216h32v16a8,8,0,0,0,16,0V216h40a16,16,0,0,0,16-16V160h16a8,8,0,0,0,0-16Zm-32,56H56V56H200v95.87s0,.09,0,.13,0,.09,0,.13V200Z"/></svg>
        <h3 class="text-[0.95rem] text-text font-semibold mb-1">Claude Integration</h3>
        <p class="text-[0.85rem] text-text-secondary leading-relaxed">Connect via MCP from Claude Desktop or Cursor. Manage your projects from any compatible tool.</p>
      </div>
      <div class="text-center px-4 py-5">
        <svg class="w-5 h-5 mx-auto mb-2 text-text-secondary" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M136,108A52,52,0,1,1,84,56,52,52,0,0,1,136,108Z" opacity="0.2"/><path d="M117.25,157.92a60,60,0,1,0-66.5,0A95.83,95.83,0,0,0,3.53,195.63a8,8,0,1,0,13.4,8.74,80,80,0,0,1,134.14,0,8,8,0,0,0,13.4-8.74A95.83,95.83,0,0,0,117.25,157.92ZM40,108a44,44,0,1,1,44,44A44.05,44.05,0,0,1,40,108Zm210.14,98.7a8,8,0,0,1-11.07-2.33A79.83,79.83,0,0,0,172,168a8,8,0,0,1,0-16,44,44,0,1,0-16.34-84.87,8,8,0,1,1-5.94-14.85,60,60,0,0,1,55.53,105.64,95.83,95.83,0,0,1,47.22,37.71A8,8,0,0,1,250.14,206.7Z"/></svg>
        <h3 class="text-[0.95rem] text-text font-semibold mb-1">Teams</h3>
        <p class="text-[0.85rem] text-text-secondary leading-relaxed">Invite collaborators with roles — owners, editors, or viewers. Everyone gets the right level of access.</p>
      </div>
      <div class="text-center px-4 py-5">
        <svg class="w-5 h-5 mx-auto mb-2 text-text-secondary" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M208,192H48a8,8,0,0,1-6.88-12C47.71,168.6,56,139.81,56,104a72,72,0,0,1,144,0c0,35.82,8.3,64.6,14.9,76A8,8,0,0,1,208,192Z" opacity="0.2"/><path d="M221.8,175.94C216.25,166.38,208,139.33,208,104a80,80,0,1,0-160,0c0,35.34-8.26,62.38-13.81,71.94A16,16,0,0,0,48,200H88.81a40,40,0,0,0,78.38,0H208a16,16,0,0,0,13.8-24.06ZM128,216a24,24,0,0,1-22.62-16h45.24A24,24,0,0,1,128,216ZM48,184c7.7-13.24,16-43.92,16-80a64,64,0,1,1,128,0c0,36.05,8.28,66.73,16,80Z"/></svg>
        <h3 class="text-[0.95rem] text-text font-semibold mb-1">Notifications</h3>
        <p class="text-[0.85rem] text-text-secondary leading-relaxed">Know when something changes. File updates, new collaborators, and incoming emails — all surfaced quietly.</p>
      </div>
      <div class="text-center px-4 py-5">
        <svg class="w-5 h-5 mx-auto mb-2 text-text-secondary" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M224,64a24,24,0,1,1-24-24A24,24,0,0,1,224,64Z" opacity="0.2"/><path d="M232,64a32,32,0,1,0-40,31v17a8,8,0,0,1-8,8H96a23.84,23.84,0,0,0-8,1.38V95a32,32,0,1,0-16,0v66a32,32,0,1,0,16,0V144a8,8,0,0,1,8-8h88a24,24,0,0,0,24-24V95A32.06,32.06,0,0,0,232,64ZM64,64A16,16,0,1,1,80,80,16,16,0,0,1,64,64ZM96,192a16,16,0,1,1-16-16A16,16,0,0,1,96,192ZM200,80a16,16,0,1,1,16-16A16,16,0,0,1,200,80Z"/></svg>
        <h3 class="text-[0.95rem] text-text font-semibold mb-1">Change Tracking</h3>
        <p class="text-[0.85rem] text-text-secondary leading-relaxed">Browse diffs, see who changed what, and review the full history of any file at any time.</p>
      </div>
      <div class="text-center px-4 py-5">
        <svg class="w-5 h-5 mx-auto mb-2 text-text-secondary" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M168,144a40,40,0,1,1-40-40A40,40,0,0,1,168,144ZM64,56A32,32,0,1,0,96,88,32,32,0,0,0,64,56Zm128,0a32,32,0,1,0,32,32A32,32,0,0,0,192,56Z" opacity="0.2"/><path d="M244.8,150.4a8,8,0,0,1-11.2-1.6A51.6,51.6,0,0,0,192,128a8,8,0,0,1,0-16,24,24,0,1,0-23.24-30,8,8,0,1,1-15.5-4A40,40,0,1,1,219,117.51a67.94,67.94,0,0,1,27.43,21.68A8,8,0,0,1,244.8,150.4ZM190.92,212a8,8,0,1,1-13.85,8,57,57,0,0,0-98.15,0,8,8,0,1,1-13.84-8,72.06,72.06,0,0,1,33.74-29.92,48,48,0,1,1,58.36,0A72.06,72.06,0,0,1,190.92,212ZM128,176a32,32,0,1,0-32-32A32,32,0,0,0,128,176ZM72,120a8,8,0,0,0-8-8A24,24,0,1,1,87.24,82a8,8,0,1,0,15.5-4A40,40,0,1,0,37,117.51,67.94,67.94,0,0,0,9.6,139.19a8,8,0,1,0,12.8,9.61A51.6,51.6,0,0,1,64,128,8,8,0,0,0,72,120Z"/></svg>
        <h3 class="text-[0.95rem] text-text font-semibold mb-1">Write Together</h3>
        <p class="text-[0.85rem] text-text-secondary leading-relaxed">Invite your team or a friend. Everyone sees changes live — no emailing files back and forth.</p>
      </div>
      <div class="text-center px-4 py-5">
        <svg class="w-5 h-5 mx-auto mb-2 text-text-secondary" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M224,56l-96,88L32,56Z" opacity="0.2"/><path d="M224,48H32a8,8,0,0,0-8,8V192a16,16,0,0,0,16,16H216a16,16,0,0,0,16-16V56A8,8,0,0,0,224,48ZM203.43,64,128,133.15,52.57,64ZM216,192H40V74.19l82.59,75.71a8,8,0,0,0,10.82,0L216,74.19V192Z"/></svg>
        <h3 class="text-[0.95rem] text-text font-semibold mb-1">Email to Workspace</h3>
        <p class="text-[0.85rem] text-text-secondary leading-relaxed">Send an email to your workspace and the bird files it where it belongs.</p>
      </div>
      <div class="text-center px-4 py-5">
        <svg class="w-5 h-5 mx-auto mb-2 text-text-secondary" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M80,88v80H32a8,8,0,0,1-8-8V96a8,8,0,0,1,8-8Z" opacity="0.2"/><path d="M155.51,24.81a8,8,0,0,0-8.42.88L77.25,80H32A16,16,0,0,0,16,96v64a16,16,0,0,0,16,16H77.25l69.84,54.31A8,8,0,0,0,160,224V32A8,8,0,0,0,155.51,24.81ZM32,96H72v64H32ZM144,207.64,88,164.09V91.91l56-43.55Zm54-106.08a40,40,0,0,1,0,52.88,8,8,0,0,1-12-10.58,24,24,0,0,0,0-31.72,8,8,0,0,1,12-10.58ZM248,128a79.9,79.9,0,0,1-20.37,53.34,8,8,0,0,1-11.92-10.67,64,64,0,0,0,0-85.33,8,8,0,1,1,11.92-10.67A79.83,79.83,0,0,1,248,128Z"/></svg>
        <h3 class="text-[0.95rem] text-text font-semibold mb-1">Read Aloud</h3>
        <p class="text-[0.85rem] text-text-secondary leading-relaxed">Hit play and hear your writing in natural speech. Great for catching mistakes or listening on the go.</p>
      </div>
    </div>
  </section>

  <section id="faq" class="max-w-[800px] mx-auto px-6 pt-8 pb-12 sm:px-8">
    <h2 class="font-heading text-[1.75rem] text-center mb-8 text-text">Under the Hood</h2>
    <div class="bg-white border border-border rounded-2xl px-8 py-6 mb-4 shadow-sm">
      <h3 class="text-[1.05rem] mb-2 text-accent">What is Perchpad?</h3>
      <p class="text-[0.95rem] text-text leading-relaxed">A collaborative writing workspace where every project is a git repository. You write in markdown, get help from a friendly little bird that lives in your workspace, and everything syncs in real time.</p>
    </div>
    <div class="bg-white border border-border rounded-2xl px-8 py-6 mb-4 shadow-sm">
      <h3 class="text-[1.05rem] mb-2 text-accent">What file formats are supported?</h3>
      <p class="text-[0.95rem] text-text leading-relaxed">Markdown (<code class="bg-surface-alt px-1.5 py-0.5 rounded text-[0.9em]">.md</code>) with live preview, and CSV (<code class="bg-surface-alt px-1.5 py-0.5 rounded text-[0.9em]">.csv</code>) rendered as editable tables with sticky headers. Markdown supports syntax highlighting for code blocks.</p>
    </div>
    <div class="bg-white border border-border rounded-2xl px-8 py-6 mb-4 shadow-sm">
      <h3 class="text-[1.05rem] mb-2 text-accent">How does version control work?</h3>
      <p class="text-[0.95rem] text-text leading-relaxed">Every project is a real git repository. Changes auto-commit every 60 seconds. You can <code class="bg-surface-alt px-1.5 py-0.5 rounded text-[0.9em]">git clone</code>, <code class="bg-surface-alt px-1.5 py-0.5 rounded text-[0.9em]">git push</code>, and <code class="bg-surface-alt px-1.5 py-0.5 rounded text-[0.9em]">git pull</code> with standard tools — your work is never locked in.</p>
    </div>
    <div class="bg-white border border-border rounded-2xl px-8 py-6 mb-4 shadow-sm">
      <h3 class="text-[1.05rem] mb-2 text-accent">How does the email integration work?</h3>
      <p class="text-[0.95rem] text-text leading-relaxed">Each workspace gets a unique email address. Send content there and it gets folded into your project — creating files, updating documents, or organizing things based on what you sent. Configure it with an <code class="bg-surface-alt px-1.5 py-0.5 rounded text-[0.9em]">AGENTS.md</code> file.</p>
    </div>
    <div class="bg-white border border-border rounded-2xl px-8 py-6 mb-4 shadow-sm">
      <h3 class="text-[1.05rem] mb-2 text-accent">Can I connect Claude Desktop or Cursor?</h3>
      <p class="text-[0.95rem] text-text leading-relaxed">Yes. Perchpad includes a Model Context Protocol (MCP) server, so you can connect from Claude Desktop, Cursor, or any MCP-compatible client to manage your projects directly.</p>
    </div>
    <div class="bg-white border border-border rounded-2xl px-8 py-6 mb-4 shadow-sm">
      <h3 class="text-[1.05rem] mb-2 text-accent">How does sharing work?</h3>
      <p class="text-[0.95rem] text-text leading-relaxed">Invite people by email with role-based access — owners, editors, or viewers. You can also share individual files via public links. All changes sync instantly for everyone.</p>
    </div>
    <div class="bg-white border border-border rounded-2xl px-8 py-6 mb-4 shadow-sm">
      <h3 class="text-[1.05rem] mb-2 text-accent">Can I use it for reading and research?</h3>
      <p class="text-[0.95rem] text-text leading-relaxed">Absolutely. Create playlists of documents — reading lists, paper collections, study notes — and work through them at your own pace. The bird can summarize, annotate, and help you make sense of what you're reading.</p>
    </div>
    <div class="bg-white border border-border rounded-2xl px-8 py-6 mb-4 shadow-sm">
      <h3 class="text-[1.05rem] mb-2 text-accent">Is my data private?</h3>
      <p class="text-[0.95rem] text-text leading-relaxed">Yes. Projects are isolated per user and never shared unless you explicitly invite someone. Your files are stored as git repositories and are fully yours — clone them anytime.</p>
    </div>
  </section>

  <section class="max-w-[800px] mx-auto px-6 pb-16 sm:px-8">
    <h2 class="font-heading text-[1.35rem] text-center mb-6 text-text-body font-semibold">Coming Soon</h2>
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-4">
      <div class="text-center px-3 py-4 opacity-60">
        <svg class="w-5 h-5 mx-auto mb-2 text-text-secondary" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M208,104v8a48,48,0,0,1-48,48H96a48,48,0,0,1-48-48v-8a49.28,49.28,0,0,1,8.51-27.3A51.92,51.92,0,0,1,76,32a52,52,0,0,1,43.83,24h16.34A52,52,0,0,1,180,32a51.92,51.92,0,0,1,19.49,44.7A49.28,49.28,0,0,1,208,104Z" opacity="0.2"/><path d="M208.3,75.68A51.71,51.71,0,0,0,180.36,32a52,52,0,0,0-43.08,24H118.72A52,52,0,0,0,75.64,32a51.71,51.71,0,0,0-27.94,43.68A56.09,56.09,0,0,0,40,104v8a56.06,56.06,0,0,0,48,55.43V192a8,8,0,0,0,16,0V167.43a55.94,55.94,0,0,0,24-10.54,55.94,55.94,0,0,0,24,10.54V192a8,8,0,0,0,16,0V167.43A56.06,56.06,0,0,0,216,112v-8A56.09,56.09,0,0,0,208.3,75.68Z"/></svg>
        <h3 class="text-[0.9rem] text-text font-semibold mb-0.5">GitHub Sync</h3>
        <p class="text-[0.8rem] text-text-secondary leading-relaxed">Auto-sync to private GitHub repos.</p>
      </div>
      <div class="text-center px-3 py-4 opacity-60">
        <svg class="w-5 h-5 mx-auto mb-2 text-text-secondary" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M216,104v8a88,88,0,0,1-88,88H40a8,8,0,0,1-8-8V104A88,88,0,0,1,216,104Z" opacity="0.2"/><path d="M200,176a8,8,0,0,1-8,8H152a8,8,0,0,1,0-16h40A8,8,0,0,1,200,176Zm-8-48H152a8,8,0,0,0,0,16h40a8,8,0,0,0,0-16Zm48-24v88a16,16,0,0,1-16,16H32a16,16,0,0,1-16-16V104A88.1,88.1,0,0,1,104,16h48A88.1,88.1,0,0,1,240,104Z"/></svg>
        <h3 class="text-[0.9rem] text-text font-semibold mb-0.5">Webhooks</h3>
        <p class="text-[0.8rem] text-text-secondary leading-relaxed">Trigger actions when files change.</p>
      </div>
      <div class="text-center px-3 py-4 opacity-60">
        <svg class="w-5 h-5 mx-auto mb-2 text-text-secondary" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M152,152H104V104h48Z" opacity="0.2"/><path d="M200,24H72A16,16,0,0,0,56,40V64H40A16,16,0,0,0,24,80v96a16,16,0,0,0,16,16H56v24a16,16,0,0,0,16,16H200a16,16,0,0,0,16-16V40A16,16,0,0,0,200,24Zm0,192H72V192h64a8,8,0,0,0,0-16H72V80H200ZM160,96H104a8,8,0,0,0-8,8v48a8,8,0,0,0,8,8h56a8,8,0,0,0,8-8V104A8,8,0,0,0,160,96Zm-8,48H112V112h40Z"/></svg>
        <h3 class="text-[0.9rem] text-text font-semibold mb-0.5">Excel Support</h3>
        <p class="text-[0.8rem] text-text-secondary leading-relaxed">Import and edit .xlsx spreadsheets.</p>
      </div>
      <div class="text-center px-3 py-4 opacity-60">
        <svg class="w-5 h-5 mx-auto mb-2 text-text-secondary" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M208,24H48A16,16,0,0,0,32,40V216a16,16,0,0,0,16,16H208a16,16,0,0,0,16-16V40A16,16,0,0,0,208,24Z" opacity="0.2"/><path d="M208,24H48A16,16,0,0,0,32,40V216a16,16,0,0,0,16,16H208a16,16,0,0,0,16-16V40A16,16,0,0,0,208,24Zm0,192H48V40H208V216ZM80,96a8,8,0,0,1,8-8h80a8,8,0,0,1,0,16H88A8,8,0,0,1,80,96Zm0,32a8,8,0,0,1,8-8h80a8,8,0,0,1,0,16H88A8,8,0,0,1,80,128Zm0,32a8,8,0,0,1,8-8h48a8,8,0,0,1,0,16H88A8,8,0,0,1,80,160Z"/></svg>
        <h3 class="text-[0.9rem] text-text font-semibold mb-0.5">PDF Support</h3>
        <p class="text-[0.8rem] text-text-secondary leading-relaxed">View and annotate PDF documents.</p>
      </div>
    </div>
  </section>

  <footer class="bg-footer-bg text-footer-text pt-16 px-6 pb-10 sm:px-8">
    <div class="max-w-[1100px] mx-auto flex flex-col gap-8 sm:flex-row sm:justify-between sm:items-start sm:gap-16">
      <div>
        <div class="font-heading text-xl font-bold text-white mb-2">Perchpad</div>
        <div class="text-[0.85rem] text-footer-muted max-w-[280px] leading-relaxed">A calm writing workspace with a smart little bird.</div>
        <a href="https://x.com/perchpad" target="_blank" rel="noopener" class="inline-flex items-center gap-1.5 text-[0.85rem] text-footer-muted hover:text-white transition-colors mt-3">
          <svg class="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
          Follow @perchpad
        </a>
      </div>
      <div class="flex gap-8 sm:gap-16">
        <div>
          <h4 class="text-xs uppercase tracking-wider text-footer-muted mb-3 font-semibold">Product</h4>
          <a href="/login" class="block text-[0.9rem] text-footer-text mb-2 hover:text-white transition-colors">Sign In</a>
          <a href="/login" class="block text-[0.9rem] text-footer-text mb-2 hover:text-white transition-colors">Get Started</a>
          <a href="#faq" class="block text-[0.9rem] text-footer-text mb-2 hover:text-white transition-colors">FAQ</a>
          <a href="/contact" class="block text-[0.9rem] text-footer-text mb-2 hover:text-white transition-colors">Contact</a>
        </div>
        <div>
          <h4 class="text-xs uppercase tracking-wider text-footer-muted mb-3 font-semibold">Features</h4>
          <a href="#faq" class="block text-[0.9rem] text-footer-text mb-2 hover:text-white transition-colors">Writing Assistant</a>
          <a href="#faq" class="block text-[0.9rem] text-footer-text mb-2 hover:text-white transition-colors">Collaboration</a>
          <a href="#faq" class="block text-[0.9rem] text-footer-text mb-2 hover:text-white transition-colors">Version Control</a>
        </div>
      </div>
    </div>
    <div class="max-w-[1100px] mx-auto mt-10 pt-6 border-t border-dark text-[0.8rem] text-footer-dim">&copy; 2026 Perchpad</div>
  </footer>
${isDev ? `<script>
(function(){var t;function c(){var ws=new WebSocket('ws://'+location.host+'/ws');ws.onopen=function(){if(t){location.reload()}};ws.onclose=function(){t=true;setTimeout(c,500)}}c()})();
</script>` : ''}
</body>
</html>`;
}
