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
  listProjectEmails,
  addProjectEmail,
  listProjectIncomingEmailSummaries,
  getProjectIncomingEmailWithTags,
  listProjectEmailTags,
  createProjectEmailTag,
  updateProjectEmailTag,
  softDeleteProjectEmailTag,
  getProjectIncomingEmail,
  listProjectEmailDomains,
  updateProjectEmailDomain,
  setIncomingEmailReadAt,
  softDeleteIncomingEmail,
  getUserHandle,
  listProjectSenders,
  listSenderEmails,
  createProjectSender,
  updateProjectSender,
  softDeleteProjectSender,
  mergeSenders,
  getActiveProjectId,
  setActiveProjectId,
  deleteProject,
  listInsufficientCreditRetryEmails,
  getDashboardStats,
  refreshSenderDailyStats,
  getSenderDailyStats,
  getSenderProfile,
  getSenderStrategy,
  getSenderClassifications,
  supabaseAdmin,
} from "./db.js";
import { verifyWebhookSignature, receiveInboundEmail, fetchEmailContentAndProcess, processInboundEmail, reprocessEmailTags } from "./inbound.js";
import { resolveAllPendingDomains, refreshSenderLogos } from "./senderResolver.js";
import { generateSenderProfile, refreshMissingProfiles, refreshAllProfiles } from "./senderProfiler.js";
import { generateSenderStrategy, classifySenderEmails, refreshAllStrategies } from "./senderStrategyAnalyzer.js";
import { sendInvitationEmail, sendEmail } from "./email.js";
import { ttsRouter } from "./tts.js";
import { mcpRouter } from "./mcp.js";
import { getAvailableBalance, getProjectOwner, getTransactions, releaseStaleHolds } from "./credits.js";
import { createHash, randomBytes } from "crypto";
import { promises as fs } from "fs";
import { join } from "path";

const app = new Hono();
const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });
const ASSET_VERSION =
  process.env.FLY_IMAGE_REF ||
  process.env.RELEASE_VERSION ||
  Date.now().toString();
const GOOGLE_TAG_ID = process.env.GOOGLE_TAG_ID || "G-DCWJV7TVLX";
function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}
const INBOUND_RETRY_MIN_AVAILABLE_CREDITS = 500;
const INBOUND_CREDIT_RETRY_BATCH_SIZE = Math.min(
  Math.max(envInt("INBOUND_CREDIT_RETRY_BATCH_SIZE", 20), 1),
  100
);
const INBOUND_CREDIT_RETRY_INTERVAL_MS = Math.max(
  envInt("INBOUND_CREDIT_RETRY_INTERVAL_MS", 120000),
  30000
);
let inboundCreditRetryRunning = false;

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
    resource: "https://peckmail.com",
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
      subject: `[Peckmail Contact] from ${name.trim()}`,
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

// Active project
api.get("/user/active-project", async (c) => {
  const user = getUser(c);
  const projectId = await getActiveProjectId(user.id);
  return c.json({ projectId });
});

api.put("/user/active-project", async (c) => {
  const user = getUser(c);
  const { projectId } = await c.req.json<{ projectId: string }>();
  if (!projectId) return c.json({ error: "projectId required" }, 400);
  const membership = await getProjectMembership(projectId, user.id);
  if (!membership) return c.json({ error: "Access denied" }, 403);
  await setActiveProjectId(user.id, projectId);
  return c.json({ ok: true });
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

  // Auto-set as active project if user doesn't have one
  const currentActive = await getActiveProjectId(user.id);
  if (!currentActive) {
    await setActiveProjectId(user.id, project.id).catch(() => {});
  }

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
      return c.json({ project, warning: err.message }, 201);
    }
  }

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

api.delete("/projects/:id", async (c) => {
  const user = getUser(c);
  const projectId = c.req.param("id");
  const membership = await getProjectMembership(projectId, user.id);
  if (!membership || membership.role !== "owner") return c.json({ error: "Only owners can delete" }, 403);

  try {
    await deleteProject(projectId);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
  return c.json({ ok: true });
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
    .select("id, project_id, email, role, status, invited_by, created_at")
    .eq("project_id", projectId)
    .eq("email", email)
    .eq("status", "pending")
    .maybeSingle();

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

  if (existing) {
    try {
      await sendInvitationEmail({
        to: email,
        invitationId: existing.id,
        projectName: project?.name ?? "Untitled",
        inviterName,
      });
      return c.json({ invitation: existing, resent: true });
    } catch (err: any) {
      console.error("[invite] Failed to resend existing invitation email:", err);
      return c.json(
        { error: `Failed to resend invitation email: ${err?.message || "unknown error"}` },
        502
      );
    }
  }

  const invitation = await createInvitation(projectId, email, user.id, role);

  try {
    await sendInvitationEmail({
      to: email,
      invitationId: invitation.id,
      projectName: project?.name ?? "Untitled",
      inviterName,
    });
  } catch (err: any) {
    console.error("[invite] Failed to send invitation email:", err);
    const { error: rollbackError } = await supabaseAdmin
      .from("invitations")
      .delete()
      .eq("id", invitation.id);
    if (rollbackError) {
      console.error("[invite] Failed to rollback invitation after email error:", rollbackError);
    }
    return c.json(
      { error: `Failed to send invitation email: ${err?.message || "unknown error"}` },
      502
    );
  }

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

// Project settings (.peckmail.json, with .perchpad.json legacy fallback)
api.get("/projects/:id/settings", async (c) => {
  const user = getUser(c);
  const projectId = c.req.param("id");
  const membership = await getProjectMembership(projectId, user.id);
  if (!membership) return c.json({ error: "Access denied" }, 403);
  const settingsPath = join(PROJECTS_DIR, projectId, ".peckmail.json");
  const legacySettingsPath = join(PROJECTS_DIR, projectId, ".perchpad.json");
  try {
    const raw = await fs.readFile(settingsPath, "utf-8");
    return c.json(JSON.parse(raw));
  } catch {
    try {
      const raw = await fs.readFile(legacySettingsPath, "utf-8");
      return c.json(JSON.parse(raw));
    } catch {
      return c.json({});
    }
  }
});

api.put("/projects/:id/settings", async (c) => {
  const user = getUser(c);
  const projectId = c.req.param("id");
  const membership = await getProjectMembership(projectId, user.id);
  if (!membership) return c.json({ error: "Access denied" }, 403);
  const settings = await c.req.json();
  const settingsPath = join(PROJECTS_DIR, projectId, ".peckmail.json");
  await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), "utf-8");
  return c.json({ ok: true });
});

// Incoming emails list
api.get("/projects/:id/emails", async (c) => {
  const user = getUser(c);
  const projectId = c.req.param("id");
  const membership = await getProjectMembership(projectId, user.id);
  if (!membership) return c.json({ error: "Access denied" }, 403);
  try {
    const limit = Math.min(Math.max(parseInt(c.req.query("limit") || "50") || 50, 1), 100);
    const before = c.req.query("before") || undefined;
    const result = await listProjectIncomingEmailSummaries(projectId, limit, before);
    return c.json(result);
  } catch (err: any) {
    return c.json({ error: err?.message || "Failed to load emails" }, 500);
  }
});

// Get a single email with body
api.get("/projects/:id/emails/:emailId", async (c) => {
  const user = getUser(c);
  const projectId = c.req.param("id");
  const emailId = c.req.param("emailId");
  const membership = await getProjectMembership(projectId, user.id);
  if (!membership) return c.json({ error: "Access denied" }, 403);
  try {
    const email = await getProjectIncomingEmailWithTags(projectId, emailId);
    if (!email) return c.json({ error: "Email not found" }, 404);
    return c.json({ email });
  } catch (err: any) {
    return c.json({ error: err?.message || "Failed to load email" }, 500);
  }
});

// Mark email read/unread
api.post("/projects/:id/emails/:emailId/read", async (c) => {
  const user = getUser(c);
  const projectId = c.req.param("id");
  const emailId = c.req.param("emailId");
  const membership = await getProjectMembership(projectId, user.id);
  if (!membership) return c.json({ error: "Access denied" }, 403);

  const { read } = await c.req.json<{ read?: boolean }>().catch(() => ({ read: true }));
  try {
    const readAt = read === false ? null : new Date().toISOString();
    const ok = await setIncomingEmailReadAt(projectId, emailId, readAt);
    if (!ok) return c.json({ error: "Email not found" }, 404);
    return c.json({ ok: true, read_at: readAt });
  } catch (err: any) {
    return c.json({ error: err?.message || "Failed to update read state" }, 500);
  }
});

// Soft-delete an email
api.delete("/projects/:id/emails/:emailId", async (c) => {
  const user = getUser(c);
  const projectId = c.req.param("id");
  const emailId = c.req.param("emailId");
  const membership = await getProjectMembership(projectId, user.id);
  if (!membership) return c.json({ error: "Access denied" }, 403);

  try {
    const ok = await softDeleteIncomingEmail(projectId, emailId);
    if (!ok) return c.json({ error: "Email not found" }, 404);
    return c.json({ ok: true });
  } catch (err: any) {
    return c.json({ error: err?.message || "Failed to delete email" }, 500);
  }
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
      text: "This is a test email sent from the Peckmail UI to verify inbound email processing is working.",
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

// Dashboard aggregates
api.get("/projects/:id/dashboard", async (c) => {
  const user = getUser(c);
  const projectId = c.req.param("id");
  const membership = await getProjectMembership(projectId, user.id);
  if (!membership) return c.json({ error: "Access denied" }, 403);

  try {
    const days = Math.min(Math.max(parseInt(c.req.query("days") || "30") || 30, 1), 365);
    const countries = c.req.queries("country");
    const stats = await getDashboardStats(projectId, days, countries);
    return c.json(stats);
  } catch (err: any) {
    return c.json({ error: err?.message || "Failed to load dashboard" }, 500);
  }
});

// Email tags
api.get("/projects/:id/tags", async (c) => {
  const user = getUser(c);
  const projectId = c.req.param("id");
  const membership = await getProjectMembership(projectId, user.id);
  if (!membership) return c.json({ error: "Access denied" }, 403);

  try {
    const tags = await listProjectEmailTags(projectId);
    return c.json({ tags });
  } catch (err: any) {
    return c.json({ error: err?.message || "Failed to load tags" }, 500);
  }
});

api.post("/projects/:id/tags", async (c) => {
  const user = getUser(c);
  const projectId = c.req.param("id");
  const membership = await getProjectMembership(projectId, user.id);
  if (!membership || !["owner", "editor"].includes(membership.role)) {
    return c.json({ error: "Only owners or editors can create tags" }, 403);
  }

  const body = await c.req.json<{
    name?: unknown;
    color?: unknown;
    enabled?: unknown;
    condition?: unknown;
  }>();
  const name = typeof body.name === "string" ? body.name : "";
  const color = typeof body.color === "string" ? body.color : "#94a3b8";
  const condition = typeof body.condition === "string" ? body.condition : "";
  const enabled = body.enabled !== undefined ? Boolean(body.enabled) : true;
  if (!name.trim()) return c.json({ error: "name is required" }, 400);
  if (!condition.trim()) return c.json({ error: "condition is required" }, 400);

  try {
    const tag = await createProjectEmailTag({
      projectId,
      name,
      color,
      enabled,
      condition,
    });
    return c.json({ tag });
  } catch (err: any) {
    return c.json({ error: err?.message || "Failed to create tag" }, 400);
  }
});

api.patch("/projects/:id/tags/:tagId", async (c) => {
  const user = getUser(c);
  const projectId = c.req.param("id");
  const tagId = c.req.param("tagId");
  const membership = await getProjectMembership(projectId, user.id);
  if (!membership || !["owner", "editor"].includes(membership.role)) {
    return c.json({ error: "Only owners or editors can update tags" }, 403);
  }

  const body = await c.req.json<{
    name?: unknown;
    color?: unknown;
    enabled?: unknown;
    condition?: unknown;
  }>();

  try {
    const tag = await updateProjectEmailTag({
      projectId,
      tagId,
      name: typeof body.name === "string" ? body.name : undefined,
      color: typeof body.color === "string" ? body.color : undefined,
      enabled: body.enabled !== undefined ? Boolean(body.enabled) : undefined,
      condition: typeof body.condition === "string" ? body.condition : undefined,
    });
    if (!tag) return c.json({ error: "Tag not found" }, 404);
    return c.json({ tag });
  } catch (err: any) {
    return c.json({ error: err?.message || "Failed to update tag" }, 400);
  }
});

api.delete("/projects/:id/tags/:tagId", async (c) => {
  const user = getUser(c);
  const projectId = c.req.param("id");
  const tagId = c.req.param("tagId");
  const membership = await getProjectMembership(projectId, user.id);
  if (!membership || !["owner", "editor"].includes(membership.role)) {
    return c.json({ error: "Only owners or editors can delete tags" }, 403);
  }

  try {
    const ok = await softDeleteProjectEmailTag(projectId, tagId);
    if (!ok) return c.json({ error: "Tag not found" }, 404);
    return c.json({ ok: true });
  } catch (err: any) {
    return c.json({ error: err?.message || "Failed to delete tag" }, 500);
  }
});

// Reprocess tags for a single email
api.post("/projects/:id/emails/:emailId/reprocess-tags", async (c) => {
  const user = getUser(c);
  const projectId = c.req.param("id");
  const emailId = c.req.param("emailId");
  const membership = await getProjectMembership(projectId, user.id);
  if (!membership || !["owner", "editor"].includes(membership.role)) {
    return c.json({ error: "Only owners or editors can reprocess tags" }, 403);
  }
  try {
    const email = await getProjectIncomingEmail(projectId, emailId);
    if (!email) return c.json({ error: "Email not found" }, 404);
    const tags = await reprocessEmailTags(email);
    return c.json({ tags });
  } catch (err: any) {
    return c.json({ error: err?.message || "Failed to reprocess tags" }, 500);
  }
});

// Reprocess tags for all emails in a project
api.post("/projects/:id/reprocess-tags", async (c) => {
  const user = getUser(c);
  const projectId = c.req.param("id");
  const membership = await getProjectMembership(projectId, user.id);
  if (!membership || !["owner", "editor"].includes(membership.role)) {
    return c.json({ error: "Only owners or editors can reprocess tags" }, 403);
  }
  try {
    const { emails } = await listProjectIncomingEmailSummaries(projectId, 100);
    let processed = 0;
    for (const summary of emails) {
      const email = await getProjectIncomingEmail(projectId, summary.id);
      if (!email) continue;
      await reprocessEmailTags(email);
      processed++;
    }
    return c.json({ ok: true, processed });
  } catch (err: any) {
    return c.json({ error: err?.message || "Failed to reprocess tags" }, 500);
  }
});

// Email sender domains
api.get("/projects/:id/domains", async (c) => {
  const user = getUser(c);
  const projectId = c.req.param("id");
  const membership = await getProjectMembership(projectId, user.id);
  if (!membership) return c.json({ error: "Access denied" }, 403);

  try {
    const domains = await listProjectEmailDomains(projectId);
    return c.json({ domains });
  } catch (err: any) {
    return c.json({ error: err?.message || "Failed to load domains" }, 500);
  }
});

api.patch("/projects/:id/domains/:domainId", async (c) => {
  const user = getUser(c);
  const projectId = c.req.param("id");
  const domainId = c.req.param("domainId");
  const membership = await getProjectMembership(projectId, user.id);
  if (!membership || !["owner", "editor"].includes(membership.role)) {
    return c.json({ error: "Only owners or editors can update domains" }, 403);
  }

  const body = await c.req.json<{ enabled?: unknown; sender_id?: unknown }>();

  try {
    const domain = await updateProjectEmailDomain({
      projectId,
      domainId,
      enabled: body.enabled !== undefined ? Boolean(body.enabled) : undefined,
      sender_id: body.sender_id !== undefined ? (body.sender_id as string | null) : undefined,
    });
    if (!domain) return c.json({ error: "Domain not found" }, 404);
    return c.json({ domain });
  } catch (err: any) {
    return c.json({ error: err?.message || "Failed to update domain" }, 500);
  }
});

// Email senders (brand entities)
api.get("/projects/:id/senders", async (c) => {
  const user = getUser(c);
  const projectId = c.req.param("id");
  const membership = await getProjectMembership(projectId, user.id);
  if (!membership) return c.json({ error: "Access denied" }, 403);

  try {
    const senders = await listProjectSenders(projectId);
    return c.json({ senders });
  } catch (err: any) {
    return c.json({ error: err?.message || "Failed to load senders" }, 500);
  }
});

api.get("/projects/:id/senders/stats", async (c) => {
  const user = getUser(c);
  const projectId = c.req.param("id");
  const membership = await getProjectMembership(projectId, user.id);
  if (!membership) return c.json({ error: "Access denied" }, 403);

  try {
    const rows = await getSenderDailyStats(projectId);

    // Build per-sender stats
    const bySender = new Map<string, Map<string, number>>();
    for (const row of rows) {
      let dateMap = bySender.get(row.sender_id);
      if (!dateMap) {
        dateMap = new Map();
        bySender.set(row.sender_id, dateMap);
      }
      dateMap.set(row.date, row.email_count);
    }

    const today = new Date();
    const stats: Record<string, any> = {};

    for (const [senderId, dateMap] of bySender) {
      // 60 daily values (oldest first), client slices per period
      const sparkline: number[] = [];
      for (let i = 59; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        const key = d.toISOString().slice(0, 10);
        sparkline.push(dateMap.get(key) || 0);
      }
      stats[senderId] = { sparkline };
    }

    return c.json({ stats });
  } catch (err: any) {
    return c.json({ error: err?.message || "Failed to load sender stats" }, 500);
  }
});

api.get("/projects/:id/senders/:senderId/emails", async (c) => {
  const user = getUser(c);
  const projectId = c.req.param("id");
  const senderId = c.req.param("senderId");
  const membership = await getProjectMembership(projectId, user.id);
  if (!membership) return c.json({ error: "Access denied" }, 403);

  try {
    const limit = Math.min(Math.max(parseInt(c.req.query("limit") || "50") || 50, 1), 100);
    const before = c.req.query("before") || undefined;
    const result = await listSenderEmails(projectId, senderId, limit, before);
    return c.json(result);
  } catch (err: any) {
    return c.json({ error: err?.message || "Failed to load sender emails" }, 500);
  }
});

api.post("/projects/:id/senders", async (c) => {
  const user = getUser(c);
  const projectId = c.req.param("id");
  const membership = await getProjectMembership(projectId, user.id);
  if (!membership || !["owner", "editor"].includes(membership.role)) {
    return c.json({ error: "Only owners or editors can create senders" }, 403);
  }

  const body = await c.req.json<{ name?: string; website?: string; description?: string; logo_url?: string; country?: string }>();
  if (!body.name?.trim()) return c.json({ error: "name is required" }, 400);

  try {
    const sender = await createProjectSender({
      projectId,
      name: body.name,
      website: body.website,
      description: body.description,
      logo_url: body.logo_url,
      country: body.country,
    });
    return c.json({ sender }, 201);
  } catch (err: any) {
    return c.json({ error: err?.message || "Failed to create sender" }, 500);
  }
});

api.patch("/projects/:id/senders/:senderId", async (c) => {
  const user = getUser(c);
  const projectId = c.req.param("id");
  const senderId = c.req.param("senderId");
  const membership = await getProjectMembership(projectId, user.id);
  if (!membership || !["owner", "editor"].includes(membership.role)) {
    return c.json({ error: "Only owners or editors can update senders" }, 403);
  }

  const body = await c.req.json<{ name?: string; website?: string | null; description?: string | null; logo_url?: string | null; country?: string | null }>();
  try {
    const sender = await updateProjectSender({
      projectId,
      senderId,
      name: body.name,
      website: body.website,
      description: body.description,
      logo_url: body.logo_url,
      country: body.country,
    });
    if (!sender) return c.json({ error: "Sender not found" }, 404);
    return c.json({ sender });
  } catch (err: any) {
    return c.json({ error: err?.message || "Failed to update sender" }, 500);
  }
});

api.delete("/projects/:id/senders/:senderId", async (c) => {
  const user = getUser(c);
  const projectId = c.req.param("id");
  const senderId = c.req.param("senderId");
  const membership = await getProjectMembership(projectId, user.id);
  if (!membership || !["owner", "editor"].includes(membership.role)) {
    return c.json({ error: "Only owners or editors can delete senders" }, 403);
  }

  try {
    const deleted = await softDeleteProjectSender(projectId, senderId);
    if (!deleted) return c.json({ error: "Sender not found" }, 404);
    return c.json({ ok: true });
  } catch (err: any) {
    return c.json({ error: err?.message || "Failed to delete sender" }, 500);
  }
});

api.post("/projects/:id/senders/resolve-all", async (c) => {
  const user = getUser(c);
  const projectId = c.req.param("id");
  const membership = await getProjectMembership(projectId, user.id);
  if (!membership || !["owner", "editor"].includes(membership.role)) {
    return c.json({ error: "Only owners or editors can trigger bulk resolution" }, 403);
  }

  // Run in background, return immediately
  resolveAllPendingDomains(projectId, 3).catch((err) =>
    console.error("[senderResolver] Bulk resolve failed:", err)
  );

  return c.json({ ok: true, message: "Resolution started" });
});

api.post("/projects/:id/senders/refresh-logos", async (c) => {
  const user = getUser(c);
  const projectId = c.req.param("id");
  const membership = await getProjectMembership(projectId, user.id);
  if (!membership || !["owner", "editor"].includes(membership.role)) {
    return c.json({ error: "Access denied" }, 403);
  }

  // Run in background, return immediately
  refreshSenderLogos(projectId).catch((err) =>
    console.error("[senderResolver] Logo refresh failed:", err)
  );

  return c.json({ ok: true, message: "Logo refresh started" });
});

api.post("/projects/:id/senders/:senderId/merge", async (c) => {
  const user = getUser(c);
  const projectId = c.req.param("id");
  const senderId = c.req.param("senderId");
  const membership = await getProjectMembership(projectId, user.id);
  if (!membership || !["owner", "editor"].includes(membership.role)) {
    return c.json({ error: "Only owners or editors can merge senders" }, 403);
  }

  const body = await c.req.json<{ merge_sender_id?: string }>();
  if (!body.merge_sender_id) return c.json({ error: "merge_sender_id is required" }, 400);
  if (body.merge_sender_id === senderId) return c.json({ error: "Cannot merge sender with itself" }, 400);

  try {
    const merged = await mergeSenders(projectId, senderId, body.merge_sender_id);
    if (!merged) return c.json({ error: "Sender not found" }, 404);
    return c.json({ ok: true });
  } catch (err: any) {
    return c.json({ error: err?.message || "Failed to merge senders" }, 500);
  }
});

// Sender profiles
api.get("/projects/:id/senders/:senderId/profile", async (c) => {
  const user = getUser(c);
  const projectId = c.req.param("id");
  const senderId = c.req.param("senderId");
  const membership = await getProjectMembership(projectId, user.id);
  if (!membership) return c.json({ error: "Access denied" }, 403);

  const profile = await getSenderProfile(projectId, senderId);
  return c.json({ profile });
});

api.post("/projects/:id/senders/:senderId/profile", async (c) => {
  const user = getUser(c);
  const projectId = c.req.param("id");
  const senderId = c.req.param("senderId");
  const membership = await getProjectMembership(projectId, user.id);
  if (!membership || !["owner", "editor"].includes(membership.role)) {
    return c.json({ error: "Access denied" }, 403);
  }

  try {
    const result = await generateSenderProfile(projectId, senderId);
    if (!result) return c.json({ error: "Sender not found" }, 404);
    return c.json({ profile: result.profile, sourceUrls: result.sourceUrls });
  } catch (err: any) {
    return c.json({ error: err?.message || "Failed to generate profile" }, 500);
  }
});

api.post("/projects/:id/senders/refresh-profiles", async (c) => {
  const user = getUser(c);
  const projectId = c.req.param("id");
  const membership = await getProjectMembership(projectId, user.id);
  if (!membership || !["owner", "editor"].includes(membership.role)) {
    return c.json({ error: "Access denied" }, 403);
  }

  const all = c.req.query("all") === "1";
  const fn = all ? refreshAllProfiles : refreshMissingProfiles;

  // Run in background, return immediately
  fn(projectId, 2).catch((err) =>
    console.error("[senderProfiler] Batch refresh failed:", err)
  );

  return c.json({ ok: true, message: all ? "Refreshing all profiles" : "Generating missing profiles" });
});

// Sender strategy analysis
api.get("/projects/:id/senders/:senderId/strategy", async (c) => {
  const user = getUser(c);
  const projectId = c.req.param("id");
  const senderId = c.req.param("senderId");
  const membership = await getProjectMembership(projectId, user.id);
  if (!membership) return c.json({ error: "Access denied" }, 403);

  const strategy = await getSenderStrategy(projectId, senderId);
  return c.json({ strategy });
});

api.post("/projects/:id/senders/:senderId/strategy", async (c) => {
  const user = getUser(c);
  const projectId = c.req.param("id");
  const senderId = c.req.param("senderId");
  const membership = await getProjectMembership(projectId, user.id);
  if (!membership || !["owner", "editor"].includes(membership.role)) {
    return c.json({ error: "Access denied" }, 403);
  }

  try {
    const result = await generateSenderStrategy(projectId, senderId);
    if (!result) return c.json({ error: "No emails to analyze" }, 404);
    return c.json({ strategy: result.strategy, emailCount: result.emailCount });
  } catch (err: any) {
    return c.json({ error: err?.message || "Failed to generate strategy" }, 500);
  }
});

api.get("/projects/:id/senders/:senderId/classifications", async (c) => {
  const user = getUser(c);
  const projectId = c.req.param("id");
  const senderId = c.req.param("senderId");
  const membership = await getProjectMembership(projectId, user.id);
  if (!membership) return c.json({ error: "Access denied" }, 403);

  const classifications = await getSenderClassifications(projectId, senderId);
  return c.json({ classifications });
});

api.post("/projects/:id/senders/refresh-strategies", async (c) => {
  const user = getUser(c);
  const projectId = c.req.param("id");
  const membership = await getProjectMembership(projectId, user.id);
  if (!membership || !["owner", "editor"].includes(membership.role)) {
    return c.json({ error: "Access denied" }, 403);
  }

  // Run in background, return immediately
  refreshAllStrategies(projectId, 2).catch((err) =>
    console.error("[strategyAnalyzer] Batch refresh failed:", err)
  );

  return c.json({ ok: true, message: "Refreshing all strategies" });
});

// Project attached email addresses (multiple)
api.get("/projects/:id/email-addresses", async (c) => {
  const user = getUser(c);
  const projectId = c.req.param("id");
  const membership = await getProjectMembership(projectId, user.id);
  if (!membership) return c.json({ error: "Access denied" }, 403);
  const emails = await listProjectEmails(projectId);
  return c.json({ emails });
});

api.post("/projects/:id/email-addresses", async (c) => {
  const user = getUser(c);
  const projectId = c.req.param("id");
  const membership = await getProjectMembership(projectId, user.id);
  if (!membership || membership.role !== "owner") {
    return c.json({ error: "Only owners can attach project email addresses" }, 403);
  }

  const body = await c.req.json<{ email?: unknown; type?: unknown }>();
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const type =
    typeof body.type === "string" ? body.type.trim().toLowerCase() : "imap";
  if (!email || !email.includes("@")) {
    return c.json({ error: "Valid email is required" }, 400);
  }
  if (!["peckmail", "imap"].includes(type)) {
    return c.json({ error: "Invalid email type" }, 400);
  }

  try {
    const record = await addProjectEmail({
      projectId,
      email,
      type: type as "peckmail" | "imap",
    });
    return c.json({ email: record });
  } catch (err: any) {
    const message = err?.message || "Failed to attach email address";
    if (message.includes("already attached")) {
      return c.json({ error: message }, 409);
    }
    return c.json({ error: message }, 400);
  }
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

// Mount API
app.route("/api", api);
app.route("/api", ttsRouter);
app.route("/mcp", mcpRouter);

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

// --- Legacy redirects ---
app.get("/projects", (c) => c.redirect("/app", 302));
app.get("/p/:id", (c) => c.redirect("/app", 302));

// --- SPA fallback ---
app.get("*", async (c) => {
  let html = await fs.readFile("dist/public/index.html", "utf-8");
  const baseUrl = new URL(c.req.url).origin;
  // Inject config
  html = html
    .replaceAll("%%ASSET_VERSION%%", ASSET_VERSION)
    .replaceAll("%%BASE_URL%%", baseUrl)
    .replaceAll("%%GOOGLE_TAG_ID%%", GOOGLE_TAG_ID)
    .replace("%%SUPABASE_URL%%", process.env.SUPABASE_URL || "")
    .replace("%%SUPABASE_ANON_KEY%%", process.env.SUPABASE_ANON_KEY || "");
  return c.html(html);
});

// --- Start server ---
const port = parseInt(process.env.PORT || "3000");
const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Peckmail running at http://localhost:${info.port}`);
});

injectWebSocket(server);

// Cleanup stale credit holds every 5 minutes
setInterval(() => {
  releaseStaleHolds().then((count) => {
    if (count > 0) console.log(`[credits] Released ${count} stale hold(s)`);
  }).catch((err) => console.error("[credits] Stale hold cleanup error:", err));
}, 5 * 60 * 1000);

async function retryInsufficientCreditEmails() {
  // TODO(max): Replace this polling loop with a DB-backed claim/lock and retry scheduling.
  // - Current in-memory guard is per-process only; multi-instance deploys can double-retry.
  // - Add a partial index for insufficient-credit failed emails and next_retry_at/backoff fields.
  if (inboundCreditRetryRunning) return;
  inboundCreditRetryRunning = true;
  try {
    const candidates = await listInsufficientCreditRetryEmails(INBOUND_CREDIT_RETRY_BATCH_SIZE);
    if (!candidates.length) return;

    const projectCanRetry = new Map<string, boolean>();
    for (const email of candidates) {
      let canRetry = projectCanRetry.get(email.project_id);
      if (canRetry === undefined) {
        const ownerId = await getProjectOwner(email.project_id);
        if (!ownerId) {
          canRetry = false;
        } else {
          const { available } = await getAvailableBalance(ownerId);
          canRetry = available >= INBOUND_RETRY_MIN_AVAILABLE_CREDITS;
        }
        projectCanRetry.set(email.project_id, canRetry);
      }
      if (!canRetry) continue;

      try {
        await processInboundEmail({
          id: email.id,
          project_id: email.project_id,
          project_name: email.project_name,
          from_address: email.from_address,
          from_domain: email.from_domain,
          to_address: email.to_address,
          subject: email.subject,
          body_text: email.body_text,
          body_html: email.body_html,
          raw_email: email.raw_email,
          summary: email.summary,
          resend_email_id: email.resend_email_id,
          date: email.created_at,
          cc: [],
          reply_to: "",
          headers: email.headers,
        });
      } catch (err) {
        console.error(`[inbound] Retry failed for email ${email.id}:`, err);
      }
    }
  } catch (err) {
    console.error("[inbound] Credit retry worker error:", err);
  } finally {
    inboundCreditRetryRunning = false;
  }
}

setInterval(() => {
  retryInsufficientCreditEmails().catch((err) =>
    console.error("[inbound] Credit retry scheduling error:", err)
  );
}, INBOUND_CREDIT_RETRY_INTERVAL_MS);

// Run one pass immediately on startup, then continue on the interval.
retryInsufficientCreditEmails().catch((err) =>
  console.error("[inbound] Initial credit retry run error:", err)
);

// Refresh sender daily stats every 15 minutes
setInterval(() => {
  refreshSenderDailyStats().then(() => {
    console.log("[senders] Daily stats refreshed");
  }).catch((err) => console.error("[senders] Daily stats refresh error:", err));
}, 15 * 60 * 1000);

// Run once on startup
refreshSenderDailyStats().then(() => {
  console.log("[senders] Initial daily stats refresh complete");
}).catch((err) => console.error("[senders] Initial daily stats refresh error:", err));

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
  <title>${fileName} — Peckmail</title>
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
      <p class="brand">Shared via Peckmail</p>
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
  <title>Peckmail — Your newsletter inbox, organized by AI</title>
  <meta name="description" content="Forward your newsletter subscriptions to Peckmail. AI reads, summarizes, and organizes everything so you don't have to.">
  <meta property="og:type" content="website">
  <meta property="og:url" content="https://peckmail.com/">
  <meta property="og:title" content="Peckmail — Your newsletter inbox, organized by AI">
  <meta property="og:description" content="Forward your newsletter subscriptions to Peckmail. AI reads, summarizes, and organizes everything so you don't have to.">
  <meta name="twitter:card" content="summary">
  <meta name="twitter:title" content="Peckmail — Your newsletter inbox, organized by AI">
  <meta name="twitter:description" content="Forward your newsletter subscriptions to Peckmail. AI reads, summarizes, and organizes everything so you don't have to.">
  <link rel="icon" href="/favicon.ico" sizes="32x32">
  <link rel="icon" href="/icon-192.png" type="image/png" sizes="192x192">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png">
  <link rel="manifest" href="/site.webmanifest">
  <meta name="theme-color" content="#faf6f1">
  <link rel="stylesheet" href="/style.css?v=${ASSET_VERSION}">
  <script async src="https://www.googletagmanager.com/gtag/js?id=${GOOGLE_TAG_ID}"></script>
  <script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config','${GOOGLE_TAG_ID}')</script>
</head>
<body style="font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 0; background: #fafafa; color: #111;">

  <nav style="display: flex; align-items: center; justify-content: space-between; max-width: 720px; margin: 0 auto; padding: 1.5rem 1.5rem;">
    <a href="/" style="display: flex; align-items: center; gap: 0.5rem; font-size: 1.15rem; font-weight: 700; color: #111; text-decoration: none;">
      <picture>
        <source srcset="/assets/logo-dark.png" media="(prefers-color-scheme: dark)">
        <img src="/assets/logo.png" alt="" style="height: 1.5rem;">
      </picture>Peckmail
    </a>
    <div id="nav-actions" style="display: flex; align-items: center; gap: 1rem;">
      <a href="/login" style="font-size: 0.875rem; color: #666; text-decoration: none;">Sign in</a>
      <a href="/login" style="font-size: 0.875rem; color: #fff; background: #111; padding: 0.5rem 1.25rem; border-radius: 0.5rem; text-decoration: none; font-weight: 500;">Get started</a>
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
            '<a href="/app" style="font-size: 0.875rem; color: #fff; background: #111; padding: 0.5rem 1.25rem; border-radius: 0.5rem; text-decoration: none; font-weight: 500;">Open App</a>';
        }
      } catch(e) {}
    </script>
  </nav>

  <section style="max-width: 720px; margin: 0 auto; padding: 4rem 1.5rem 3rem; text-align: center;">
    <h1 style="font-size: clamp(2rem, 5vw, 3rem); font-weight: 800; line-height: 1.1; letter-spacing: -0.03em; margin: 0 0 1.25rem;">
      Your newsletter inbox,<br>organized by AI
    </h1>
    <p style="font-size: 1.125rem; color: #555; line-height: 1.6; max-width: 520px; margin: 0 auto 2rem;">
      Forward your subscriptions to Peckmail. We read, summarize, and organize every newsletter so you get the signal without the noise.
    </p>
    <a href="/login" style="display: inline-block; font-size: 0.95rem; color: #fff; background: #111; padding: 0.75rem 2rem; border-radius: 0.5rem; text-decoration: none; font-weight: 600;">
      Start for free
    </a>
  </section>

  <section style="max-width: 720px; margin: 0 auto; padding: 2rem 1.5rem 3rem;">
    <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 1.5rem;">
      <div style="text-align: center; padding: 1.5rem 1rem;">
        <div style="font-size: 1.75rem; margin-bottom: 0.5rem;">&#9993;</div>
        <h3 style="font-size: 0.95rem; font-weight: 600; margin: 0 0 0.35rem;">Forward & forget</h3>
        <p style="font-size: 0.8rem; color: #666; line-height: 1.5; margin: 0;">Each workspace gets a unique email. Forward newsletters there and they show up instantly.</p>
      </div>
      <div style="text-align: center; padding: 1.5rem 1rem;">
        <div style="font-size: 1.75rem; margin-bottom: 0.5rem;">&#9889;</div>
        <h3 style="font-size: 0.95rem; font-weight: 600; margin: 0 0 0.35rem;">AI summaries</h3>
        <p style="font-size: 0.8rem; color: #666; line-height: 1.5; margin: 0;">Every email is read and summarized automatically. Ask follow-up questions in the built-in chat.</p>
      </div>
      <div style="text-align: center; padding: 1.5rem 1rem;">
        <div style="font-size: 1.75rem; margin-bottom: 0.5rem;">&#128279;</div>
        <h3 style="font-size: 0.95rem; font-weight: 600; margin: 0 0 0.35rem;">MCP + API</h3>
        <p style="font-size: 0.8rem; color: #666; line-height: 1.5; margin: 0;">Connect from Claude Desktop or Claude Code. Export your data as CSV or JSON anytime.</p>
      </div>
    </div>
  </section>

  <section style="max-width: 720px; margin: 0 auto; padding: 1rem 1.5rem 3rem;">
    <h2 style="font-size: 1.25rem; font-weight: 700; text-align: center; margin: 0 0 1.5rem;">How it works</h2>
    <div style="display: flex; flex-direction: column; gap: 1rem;">
      <div style="display: flex; gap: 1rem; align-items: flex-start; background: #fff; border: 1px solid #e5e5e5; border-radius: 0.75rem; padding: 1.25rem;">
        <span style="font-size: 0.8rem; font-weight: 700; color: #999; flex-shrink: 0; width: 1.5rem; text-align: center;">1</span>
        <div>
          <h3 style="font-size: 0.9rem; font-weight: 600; margin: 0 0 0.25rem;">Create a workspace</h3>
          <p style="font-size: 0.8rem; color: #666; line-height: 1.5; margin: 0;">Sign up and get a dedicated email address for your newsletter subscriptions.</p>
        </div>
      </div>
      <div style="display: flex; gap: 1rem; align-items: flex-start; background: #fff; border: 1px solid #e5e5e5; border-radius: 0.75rem; padding: 1.25rem;">
        <span style="font-size: 0.8rem; font-weight: 700; color: #999; flex-shrink: 0; width: 1.5rem; text-align: center;">2</span>
        <div>
          <h3 style="font-size: 0.9rem; font-weight: 600; margin: 0 0 0.25rem;">Forward your newsletters</h3>
          <p style="font-size: 0.8rem; color: #666; line-height: 1.5; margin: 0;">Update your subscription emails or set up auto-forwarding. Every email lands in your inbox.</p>
        </div>
      </div>
      <div style="display: flex; gap: 1rem; align-items: flex-start; background: #fff; border: 1px solid #e5e5e5; border-radius: 0.75rem; padding: 1.25rem;">
        <span style="font-size: 0.8rem; font-weight: 700; color: #999; flex-shrink: 0; width: 1.5rem; text-align: center;">3</span>
        <div>
          <h3 style="font-size: 0.9rem; font-weight: 600; margin: 0 0 0.25rem;">Read the highlights</h3>
          <p style="font-size: 0.8rem; color: #666; line-height: 1.5; margin: 0;">AI processes each email. Check your dashboard for summaries, or chat with the assistant for deeper analysis.</p>
        </div>
      </div>
    </div>
  </section>

  <section id="faq" style="max-width: 720px; margin: 0 auto; padding: 1rem 1.5rem 3rem;">
    <h2 style="font-size: 1.25rem; font-weight: 700; text-align: center; margin: 0 0 1.5rem;">FAQ</h2>
    <div style="display: flex; flex-direction: column; gap: 0.75rem;">
      <div style="background: #fff; border: 1px solid #e5e5e5; border-radius: 0.75rem; padding: 1.25rem;">
        <h3 style="font-size: 0.9rem; font-weight: 600; margin: 0 0 0.35rem;">What is Peckmail?</h3>
        <p style="font-size: 0.8rem; color: #555; line-height: 1.6; margin: 0;">A smart inbox for your newsletter subscriptions. Forward emails to your workspace, and AI reads, summarizes, and organizes them for you.</p>
      </div>
      <div style="background: #fff; border: 1px solid #e5e5e5; border-radius: 0.75rem; padding: 1.25rem;">
        <h3 style="font-size: 0.9rem; font-weight: 600; margin: 0 0 0.35rem;">How does the email integration work?</h3>
        <p style="font-size: 0.8rem; color: #555; line-height: 1.6; margin: 0;">Each workspace gets a unique email address. Forward newsletters there and they're automatically processed by the AI assistant.</p>
      </div>
      <div style="background: #fff; border: 1px solid #e5e5e5; border-radius: 0.75rem; padding: 1.25rem;">
        <h3 style="font-size: 0.9rem; font-weight: 600; margin: 0 0 0.35rem;">Can I connect Claude Desktop or Claude Code?</h3>
        <p style="font-size: 0.8rem; color: #555; line-height: 1.6; margin: 0;">Yes. Peckmail includes an MCP server. Connect from Claude Desktop with OAuth, or use an API key with Claude Code.</p>
      </div>
      <div style="background: #fff; border: 1px solid #e5e5e5; border-radius: 0.75rem; padding: 1.25rem;">
        <h3 style="font-size: 0.9rem; font-weight: 600; margin: 0 0 0.35rem;">Is my data private?</h3>
        <p style="font-size: 0.8rem; color: #555; line-height: 1.6; margin: 0;">Yes. Workspaces are isolated per user and never shared unless you explicitly invite someone.</p>
      </div>
    </div>
  </section>

  <footer style="border-top: 1px solid #e5e5e5; padding: 2rem 1.5rem; text-align: center;">
    <div style="max-width: 720px; margin: 0 auto; display: flex; justify-content: space-between; align-items: center;">
      <span style="font-size: 0.8rem; color: #999;">&copy; 2026 Peckmail</span>
      <div style="display: flex; gap: 1.25rem;">
        <a href="/contact" style="font-size: 0.8rem; color: #666; text-decoration: none;">Contact</a>
        <a href="https://x.com/peckmail" target="_blank" rel="noopener" style="font-size: 0.8rem; color: #666; text-decoration: none;">@peckmail</a>
      </div>
    </div>
  </footer>
${isDev ? `<script>
(function(){var t;function c(){var ws=new WebSocket('ws://'+location.host+'/ws');ws.onopen=function(){if(t){location.reload()}};ws.onclose=function(){t=true;setTimeout(c,500)}}c()})();
</script>` : ''}
</body>
</html>`;
}
