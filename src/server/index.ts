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
import { verifyWebhookSignature, processInboundEmail } from "./inbound.js";
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
    // Process asynchronously — return 200 immediately
    processInboundEmail(payload).catch((err) =>
      console.error("[webhook] Error processing inbound email:", err)
    );
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
    .select("id, from_address, subject, processed, error, created_at")
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

  // Simulate inbound by calling processInboundEmail directly
  processInboundEmail({
    data: {
      from: userEmail,
      to: [projectEmail],
      subject: "Test email",
      text: "This is a test email sent from the Perchpad UI to verify inbound email processing is working.",
      email_id: `test-${Date.now()}`,
    },
  }).catch((err) => console.error("[test-email] Error:", err));

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
