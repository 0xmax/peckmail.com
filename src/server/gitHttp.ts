import { Hono } from "hono";
import { spawn } from "child_process";
import { createHash } from "crypto";
import { join } from "path";
import { supabaseAdmin, getProjectMembership } from "./db.js";
import { PROJECTS_DIR } from "./files.js";
import { initRepo } from "./git.js";
import { broadcast } from "./ws.js";
import type { Readable } from "stream";

export const gitRouter = new Hono();

// --- Helpers ---

function pktLine(data: string): string {
  const len = (data.length + 4).toString(16).padStart(4, "0");
  return len + data;
}

interface GitUser {
  id: string;
  email: string;
}

async function authenticateGitRequest(
  c: any
): Promise<GitUser | null> {
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Basic ")) return null;

  const decoded = Buffer.from(authHeader.slice(6), "base64").toString("utf-8");
  const colonIdx = decoded.indexOf(":");
  if (colonIdx === -1) return null;

  // Password is the API key; username is ignored
  const password = decoded.slice(colonIdx + 1);
  if (!password.startsWith("pp_")) return null;

  const keyHash = createHash("sha256").update(password).digest("hex");
  const { data: apiKey, error: keyErr } = await supabaseAdmin
    .from("api_keys")
    .select("id, user_id")
    .eq("key_hash", keyHash)
    .single();
  if (keyErr || !apiKey) return null;

  const {
    data: { user },
    error: userErr,
  } = await supabaseAdmin.auth.admin.getUserById(apiKey.user_id);
  if (userErr || !user) return null;

  // Fire-and-forget: update last_used_at
  supabaseAdmin
    .from("api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", apiKey.id)
    .then(() => {});

  return { id: user.id, email: user.email ?? "" };
}

function spawnGitProcess(
  cmd: string,
  args: string[],
  repoDir: string,
  stdin?: ReadableStream<Uint8Array> | null
): { stdout: Readable; exitPromise: Promise<number> } {
  const proc = spawn(cmd, args, { cwd: repoDir });

  if (stdin) {
    const reader = stdin.getReader();
    const write = async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          proc.stdin.end();
          break;
        }
        proc.stdin.write(value);
      }
    };
    write().catch(() => proc.stdin.end());
  } else {
    proc.stdin.end();
  }

  const exitPromise = new Promise<number>((resolve) => {
    proc.on("close", (code) => resolve(code ?? 1));
    proc.on("error", () => resolve(1));
  });

  return { stdout: proc.stdout, exitPromise };
}

function nodeReadableToWebStream(readable: Readable): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      readable.on("data", (chunk: Buffer) => {
        controller.enqueue(new Uint8Array(chunk));
      });
      readable.on("end", () => {
        controller.close();
      });
      readable.on("error", (err) => {
        controller.error(err);
      });
    },
    cancel() {
      readable.destroy();
    },
  });
}

const VALID_SERVICES = ["git-upload-pack", "git-receive-pack"] as const;
type GitService = (typeof VALID_SERVICES)[number];

// Roles that can read (clone/fetch)
function canRead(role: string): boolean {
  return ["owner", "editor", "viewer"].includes(role);
}

// Roles that can write (push)
function canWrite(role: string): boolean {
  return ["owner", "editor"].includes(role);
}

// Slug routes: /:projectId/:slug/... → forward to /:projectId/... handlers
// The slug is cosmetic (gives git clone a nice folder name) and ignored by the server.
gitRouter.get("/:projectId/:slug/info/refs", async (c) => gitInfoRefs(c));
gitRouter.post("/:projectId/:slug/git-upload-pack", async (c) => gitUploadPack(c));
gitRouter.post("/:projectId/:slug/git-receive-pack", async (c) => gitReceivePack(c));

// --- GET /:projectId/info/refs?service=... ---
gitRouter.get("/:projectId/info/refs", async (c) => gitInfoRefs(c));

async function gitInfoRefs(c: any) {
  const service = c.req.query("service") as GitService | undefined;
  if (!service || !VALID_SERVICES.includes(service)) {
    return c.text("Invalid service", 400);
  }

  const user = await authenticateGitRequest(c);
  if (!user) {
    c.header("WWW-Authenticate", 'Basic realm="Perchpad"');
    return c.text("Authentication required", 401);
  }

  const projectId = c.req.param("projectId");
  const membership = await getProjectMembership(projectId, user.id);
  if (!membership) {
    return c.text("Not a project member", 403);
  }

  if (service === "git-upload-pack" && !canRead(membership.role)) {
    return c.text("Access denied", 403);
  }
  if (service === "git-receive-pack" && !canWrite(membership.role)) {
    return c.text("Push access denied", 403);
  }

  const repoDir = join(PROJECTS_DIR, projectId);
  await initRepo(projectId);

  // Strip "git-" prefix for the CLI command
  const cmd = service.replace("git-", "git ");
  const [gitCmd, ...gitArgs] = cmd.split(" ");

  const { stdout, exitPromise } = spawnGitProcess(
    gitCmd,
    [...gitArgs, "--stateless-rpc", "--advertise-refs", repoDir],
    repoDir
  );

  // Collect output
  const chunks: Buffer[] = [];
  for await (const chunk of stdout) {
    chunks.push(Buffer.from(chunk));
  }
  const code = await exitPromise;
  if (code !== 0) {
    return c.text("Git process failed", 500);
  }

  // Build response: pkt-line service header + flush + git output
  const serviceHeader = pktLine(`# service=${service}\n`);
  const body = Buffer.concat([
    Buffer.from(serviceHeader, "utf-8"),
    Buffer.from("0000", "utf-8"),
    ...chunks,
  ]);

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": `application/x-${service}-advertisement`,
      "Cache-Control": "no-cache",
    },
  });
}

// --- POST /:projectId/git-upload-pack ---
gitRouter.post("/:projectId/git-upload-pack", async (c) => gitUploadPack(c));

async function gitUploadPack(c: any) {
  const user = await authenticateGitRequest(c);
  if (!user) {
    c.header("WWW-Authenticate", 'Basic realm="Perchpad"');
    return c.text("Authentication required", 401);
  }

  const projectId = c.req.param("projectId");
  const membership = await getProjectMembership(projectId, user.id);
  if (!membership || !canRead(membership.role)) {
    return c.text("Access denied", 403);
  }

  const repoDir = join(PROJECTS_DIR, projectId);
  await initRepo(projectId);

  const reqBody = c.req.raw.body;
  const { stdout, exitPromise } = spawnGitProcess(
    "git",
    ["upload-pack", "--stateless-rpc", repoDir],
    repoDir,
    reqBody
  );

  const stream = nodeReadableToWebStream(stdout);

  // Don't await exitPromise — let the stream flow
  exitPromise.catch(() => {});

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "application/x-git-upload-pack-result",
      "Cache-Control": "no-cache",
    },
  });
}

// --- POST /:projectId/git-receive-pack ---
gitRouter.post("/:projectId/git-receive-pack", async (c) => gitReceivePack(c));

async function gitReceivePack(c: any) {
  const user = await authenticateGitRequest(c);
  if (!user) {
    c.header("WWW-Authenticate", 'Basic realm="Perchpad"');
    return c.text("Authentication required", 401);
  }

  const projectId = c.req.param("projectId");
  const membership = await getProjectMembership(projectId, user.id);
  if (!membership || !canWrite(membership.role)) {
    return c.text("Push access denied", 403);
  }

  const repoDir = join(PROJECTS_DIR, projectId);
  await initRepo(projectId);

  const reqBody = c.req.raw.body;
  const { stdout, exitPromise } = spawnGitProcess(
    "git",
    ["receive-pack", "--stateless-rpc", repoDir],
    repoDir,
    reqBody
  );

  // Collect output so we can check exit code before responding
  const chunks: Buffer[] = [];
  for await (const chunk of stdout) {
    chunks.push(Buffer.from(chunk));
  }
  const code = await exitPromise;

  if (code === 0) {
    // Broadcast to WebSocket clients so UI refreshes
    broadcast(projectId, { type: "file:changed", path: "" });
  }

  const body = Buffer.concat(chunks);
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/x-git-receive-pack-result",
      "Cache-Control": "no-cache",
    },
  });
}
