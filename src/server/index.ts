import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
import { serveStatic } from "@hono/node-server/serve-static";
import { authMiddleware, getUser } from "./auth.js";
import { filesRouter, PROJECTS_DIR } from "./files.js";
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
  supabaseAdmin,
} from "./db.js";
import { verifyWebhookSignature, receiveInboundEmail, processInboundEmail } from "./inbound.js";
import { sendInvitationEmail } from "./email.js";
import { initRepo, getHistory, getCommitDiff, getUncommittedStatus, manualCommit } from "./git.js";
import { ttsRouter } from "./tts.js";
import { mcpRouter } from "./mcp.js";
import { gitRouter } from "./gitHttp.js";
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
    // Phase 1: persist to DB synchronously before returning 200
    const record = await receiveInboundEmail(payload);
    if (record) {
      // Phase 2: run AI agent asynchronously
      processInboundEmail(record).catch((err) =>
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
  const { name } = await c.req.json<{ name: string }>();
  if (!name?.trim()) return c.json({ error: "Name required" }, 400);

  const project = await createProject(name.trim(), user.id);
  // Initialize git repo for the project
  await initRepo(project.id);
  return c.json({ project });
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
    // Phase 2: run AI agent asynchronously
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
  // Inject Supabase config
  html = html
    .replaceAll("%%ASSET_VERSION%%", ASSET_VERSION)
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
  <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700;800&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/style.css?v=${ASSET_VERSION}">
  <script>
    try {
      var sb = JSON.parse(localStorage.getItem('sb-' + location.hostname + '-auth-token') || '{}');
      if (!sb.access_token) {
        var keys = Object.keys(localStorage);
        for (var i = 0; i < keys.length; i++) {
          if (keys[i].indexOf('auth-token') !== -1) {
            sb = JSON.parse(localStorage.getItem(keys[i]) || '{}');
            break;
          }
        }
      }
      if (sb.access_token) { location.replace('/projects'); }
    } catch(e) {}
  </script>
</head>
<body class="bg-bg text-text">

  <nav class="flex items-center justify-between max-w-[1100px] mx-auto px-6 py-4 sm:px-8 sm:py-5">
    <a href="/" class="flex items-center gap-2 font-heading text-[1.35rem] font-bold text-text">
      <img src="/assets/logo.png" alt="" class="h-7 w-auto">Perchpad
    </a>
    <div class="flex items-center gap-5">
      <a href="/login" class="text-[0.95rem] text-text-secondary font-medium hover:text-text transition-colors">Sign In</a>
      <a href="/login" class="inline-block bg-dark text-white px-5 py-2 rounded-lg text-[0.9rem] font-semibold hover:opacity-85 transition-opacity">Get Started</a>
    </div>
  </nav>

  <section class="max-w-[1100px] mx-auto px-6 pt-8 sm:px-8 sm:pt-16">
    <div class="flex flex-col gap-5 mb-8 sm:flex-row sm:items-center sm:gap-12 sm:mb-12">
      <div class="sm:flex-[1.2]">
        <h1 class="font-heading text-4xl sm:text-[3.5rem] font-extrabold leading-[1.1] text-text tracking-tight">A writing workspace that thinks with you</h1>
      </div>
      <div class="sm:flex-1">
        <p class="text-lg text-text-body leading-relaxed">Organize projects, write in markdown, manage data in tables, and collaborate in real time — with a built-in AI assistant that understands your files.</p>
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
        <div class="text-2xl mb-2">&#128038;</div>
        <h3 class="text-[1.1rem] mb-2 text-text">A Smart Little Bird</h3>
        <p class="text-[0.95rem] text-text-secondary leading-relaxed">A friendly assistant that lives in your workspace. It can read your files, help you draft, organize your thoughts, and answer questions — like a companion that quietly knows the whole project.</p>
      </div>
      <div class="bg-white border border-border rounded-2xl p-7 shadow-sm">
        <div class="text-2xl mb-2">&#9998;</div>
        <h3 class="text-[1.1rem] mb-2 text-text">Write Together</h3>
        <p class="text-[0.95rem] text-text-secondary leading-relaxed">Invite your family, your team, or a friend. Everyone sees changes as they happen — no emailing files back and forth, no version confusion. Just open the same project and go.</p>
      </div>
      <div class="bg-white border border-border rounded-2xl p-7 shadow-sm">
        <div class="text-2xl mb-2">&#128220;</div>
        <h3 class="text-[1.1rem] mb-2 text-text">Hear the Chirps</h3>
        <p class="text-[0.95rem] text-text-secondary leading-relaxed">Send an email to your workspace and the bird takes care of it — reading what you sent, updating your documents, filing things where they belong. You stay focused while it works in the background.</p>
      </div>
      <div class="bg-white border border-border rounded-2xl p-7 shadow-sm">
        <div class="text-2xl mb-2">&#128066;</div>
        <h3 class="text-[1.1rem] mb-2 text-text">It Listens to Your Docs</h3>
        <p class="text-[0.95rem] text-text-secondary leading-relaxed">The bird watches your files as you write. It knows what changed, what you're working on, and what you might need next. Ask it anything about your project — it's already paying attention.</p>
      </div>
    </div>
  </section>

  <section class="max-w-[1100px] mx-auto px-6 pb-12 sm:px-8">
    <h2 class="font-heading text-[1.35rem] text-center mb-6 text-text-body font-semibold">And a few more things you might like</h2>
    <div class="grid grid-cols-2 sm:grid-cols-3 gap-4">
      <div class="text-center px-4 py-5">
        <svg class="w-5 h-5 mx-auto mb-2 stroke-text-secondary" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/></svg>
        <h3 class="text-[0.95rem] text-text font-semibold mb-1">Markdown-Based</h3>
        <p class="text-[0.85rem] text-text-secondary leading-relaxed">Write in plain markdown with live preview. No proprietary formats — your files are always yours.</p>
      </div>
      <div class="text-center px-4 py-5">
        <svg class="w-5 h-5 mx-auto mb-2 stroke-text-secondary" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/></svg>
        <h3 class="text-[0.95rem] text-text font-semibold mb-1">Never Lose a Thing</h3>
        <p class="text-[0.85rem] text-text-secondary leading-relaxed">Auto-saves every minute with full version history. Go back to any point, no manual saving needed.</p>
      </div>
      <div class="text-center px-4 py-5">
        <svg class="w-5 h-5 mx-auto mb-2 stroke-text-secondary" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M9 9h6v6H9z"/><path d="M15 2v2"/><path d="M15 20v2"/><path d="M2 15h2"/><path d="M2 9h2"/><path d="M20 15h2"/><path d="M20 9h2"/><path d="M9 2v2"/><path d="M9 20v2"/></svg>
        <h3 class="text-[0.95rem] text-text font-semibold mb-1">Claude Integration</h3>
        <p class="text-[0.85rem] text-text-secondary leading-relaxed">Connect via MCP from Claude Desktop or Cursor. Manage your projects from any compatible AI tool.</p>
      </div>
      <div class="text-center px-4 py-5">
        <svg class="w-5 h-5 mx-auto mb-2 stroke-text-secondary" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
        <h3 class="text-[0.95rem] text-text font-semibold mb-1">Teams</h3>
        <p class="text-[0.85rem] text-text-secondary leading-relaxed">Invite collaborators with roles — owners, editors, or viewers. Everyone gets the right level of access.</p>
      </div>
      <div class="text-center px-4 py-5">
        <svg class="w-5 h-5 mx-auto mb-2 stroke-text-secondary" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>
        <h3 class="text-[0.95rem] text-text font-semibold mb-1">Notifications</h3>
        <p class="text-[0.85rem] text-text-secondary leading-relaxed">Know when something changes. File updates, new collaborators, and incoming emails — all surfaced quietly.</p>
      </div>
      <div class="text-center px-4 py-5">
        <svg class="w-5 h-5 mx-auto mb-2 stroke-text-secondary" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 21V9a9 9 0 0 0 9 9"/></svg>
        <h3 class="text-[0.95rem] text-text font-semibold mb-1">Change Tracking</h3>
        <p class="text-[0.85rem] text-text-secondary leading-relaxed">Browse diffs, see who changed what, and review the full history of any file at any time.</p>
      </div>
    </div>
  </section>

  <section id="faq" class="max-w-[800px] mx-auto px-6 pt-8 pb-12 sm:px-8">
    <h2 class="font-heading text-[1.75rem] text-center mb-8 text-text">Under the Hood</h2>
    <div class="bg-white border border-border rounded-2xl px-8 py-6 mb-4 shadow-sm">
      <h3 class="text-[1.05rem] mb-2 text-accent">What is Perchpad?</h3>
      <p class="text-[0.95rem] text-text leading-relaxed">A collaborative writing workspace where every project is a git repository. You write in markdown, manage data in CSV tables, and get help from a built-in AI assistant powered by Claude. Everything syncs in real time.</p>
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
      <p class="text-[0.95rem] text-text leading-relaxed">Each workspace gets a unique email address. Send content there and the AI processes it into your project — creating files, updating documents, or organizing things based on what you sent. Configure it with an <code class="bg-surface-alt px-1.5 py-0.5 rounded text-[0.9em]">AGENTS.md</code> file.</p>
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

  <footer class="bg-footer-bg text-footer-text pt-16 px-6 pb-10 sm:px-8">
    <div class="max-w-[1100px] mx-auto flex flex-col gap-8 sm:flex-row sm:justify-between sm:items-start sm:gap-16">
      <div>
        <div class="font-heading text-xl font-bold text-white mb-2">Perchpad</div>
        <div class="text-[0.85rem] text-footer-muted max-w-[280px] leading-relaxed">A calm writing workspace with a smart little bird.</div>
      </div>
      <div class="flex gap-8 sm:gap-16">
        <div>
          <h4 class="text-xs uppercase tracking-wider text-footer-muted mb-3 font-semibold">Product</h4>
          <a href="/login" class="block text-[0.9rem] text-footer-text mb-2 hover:text-white transition-colors">Sign In</a>
          <a href="/login" class="block text-[0.9rem] text-footer-text mb-2 hover:text-white transition-colors">Get Started</a>
          <a href="#faq" class="block text-[0.9rem] text-footer-text mb-2 hover:text-white transition-colors">FAQ</a>
        </div>
        <div>
          <h4 class="text-xs uppercase tracking-wider text-footer-muted mb-3 font-semibold">Features</h4>
          <a href="#faq" class="block text-[0.9rem] text-footer-text mb-2 hover:text-white transition-colors">AI Assistant</a>
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
