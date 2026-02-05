import { Hono } from "hono";
import { promises as fs } from "fs";
import { join, resolve, relative, extname, dirname } from "path";
import { getUser, type AuthUser } from "./auth.js";
import { getProjectMembership } from "./db.js";

const PROJECTS_DIR = resolve(process.env.PROJECTS_DIR || "./projects");

// Prevent path traversal by resolving and checking the path stays within project dir
function safePath(projectId: string, filePath: string): string {
  const projectDir = join(PROJECTS_DIR, projectId);
  const resolved = resolve(projectDir, filePath);
  if (!resolved.startsWith(projectDir + "/") && resolved !== projectDir) {
    throw new Error("Path traversal detected");
  }
  return resolved;
}

function projectDir(projectId: string): string {
  return join(PROJECTS_DIR, projectId);
}

// Recursively list files, excluding hidden dirs like .git and .perchpad
async function listTree(
  dir: string,
  base: string
): Promise<Array<{ name: string; path: string; type: "file" | "directory"; children?: any[] }>> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const result: any[] = [];

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith(".")) continue;

    const entryPath = join(dir, entry.name);
    const relativePath = relative(base, entryPath);

    if (entry.isDirectory()) {
      const children = await listTree(entryPath, base);
      result.push({
        name: entry.name,
        path: relativePath,
        type: "directory" as const,
        children,
      });
    } else {
      result.push({
        name: entry.name,
        path: relativePath,
        type: "file" as const,
      });
    }
  }

  return result;
}

// Check project access
async function checkAccess(
  user: AuthUser,
  projectId: string,
  requiredRole?: string[]
): Promise<boolean> {
  const membership = await getProjectMembership(projectId, user.id);
  if (!membership) return false;
  if (requiredRole && !requiredRole.includes(membership.role)) return false;
  return true;
}

export const filesRouter = new Hono();

// GET /api/files/:projectId/tree
filesRouter.get("/:projectId/tree", async (c) => {
  const user = getUser(c);
  const projectId = c.req.param("projectId");

  if (!(await checkAccess(user, projectId))) {
    return c.json({ error: "Access denied" }, 403);
  }

  try {
    const dir = projectDir(projectId);
    const tree = await listTree(dir, dir);
    return c.json({ tree });
  } catch (err: any) {
    return c.json({ error: "Failed to list files" }, 500);
  }
});

// GET /api/files/:projectId/read?path=...
filesRouter.get("/:projectId/read", async (c) => {
  const user = getUser(c);
  const projectId = c.req.param("projectId");
  const filePath = c.req.query("path");

  if (!filePath) return c.json({ error: "Path required" }, 400);
  if (!(await checkAccess(user, projectId))) {
    return c.json({ error: "Access denied" }, 403);
  }

  try {
    const resolved = safePath(projectId, filePath);
    const content = await fs.readFile(resolved, "utf-8");
    return c.json({ content, path: filePath });
  } catch (err: any) {
    if (err.message === "Path traversal detected") {
      return c.json({ error: "Invalid path" }, 400);
    }
    return c.json({ error: "File not found" }, 404);
  }
});

// POST /api/files/:projectId/write
filesRouter.post("/:projectId/write", async (c) => {
  const user = getUser(c);
  const projectId = c.req.param("projectId");

  if (!(await checkAccess(user, projectId, ["owner", "editor"]))) {
    return c.json({ error: "Access denied" }, 403);
  }

  const body = await c.req.json<{ path: string; content: string }>();
  if (!body.path || body.content === undefined) {
    return c.json({ error: "Path and content required" }, 400);
  }

  try {
    const resolved = safePath(projectId, body.path);
    await fs.mkdir(dirname(resolved), { recursive: true });
    await fs.writeFile(resolved, body.content, "utf-8");
    return c.json({ ok: true, path: body.path });
  } catch (err: any) {
    if (err.message === "Path traversal detected") {
      return c.json({ error: "Invalid path" }, 400);
    }
    return c.json({ error: "Failed to write file" }, 500);
  }
});

// POST /api/files/:projectId/mkdir
filesRouter.post("/:projectId/mkdir", async (c) => {
  const user = getUser(c);
  const projectId = c.req.param("projectId");

  if (!(await checkAccess(user, projectId, ["owner", "editor"]))) {
    return c.json({ error: "Access denied" }, 403);
  }

  const body = await c.req.json<{ path: string }>();
  if (!body.path) return c.json({ error: "Path required" }, 400);

  try {
    const resolved = safePath(projectId, body.path);
    await fs.mkdir(resolved, { recursive: true });
    return c.json({ ok: true, path: body.path });
  } catch (err: any) {
    if (err.message === "Path traversal detected") {
      return c.json({ error: "Invalid path" }, 400);
    }
    return c.json({ error: "Failed to create directory" }, 500);
  }
});

// DELETE /api/files/:projectId?path=...
filesRouter.delete("/:projectId", async (c) => {
  const user = getUser(c);
  const projectId = c.req.param("projectId");
  const filePath = c.req.query("path");

  if (!filePath) return c.json({ error: "Path required" }, 400);
  if (!(await checkAccess(user, projectId, ["owner", "editor"]))) {
    return c.json({ error: "Access denied" }, 403);
  }

  try {
    const resolved = safePath(projectId, filePath);
    const stat = await fs.stat(resolved);
    if (stat.isDirectory()) {
      await fs.rm(resolved, { recursive: true });
    } else {
      await fs.unlink(resolved);
    }
    return c.json({ ok: true });
  } catch (err: any) {
    if (err.message === "Path traversal detected") {
      return c.json({ error: "Invalid path" }, 400);
    }
    return c.json({ error: "Failed to delete" }, 500);
  }
});

// POST /api/files/:projectId/rename
filesRouter.post("/:projectId/rename", async (c) => {
  const user = getUser(c);
  const projectId = c.req.param("projectId");

  if (!(await checkAccess(user, projectId, ["owner", "editor"]))) {
    return c.json({ error: "Access denied" }, 403);
  }

  const body = await c.req.json<{ from: string; to: string }>();
  if (!body.from || !body.to) {
    return c.json({ error: "From and to paths required" }, 400);
  }

  try {
    const fromResolved = safePath(projectId, body.from);
    const toResolved = safePath(projectId, body.to);
    await fs.mkdir(dirname(toResolved), { recursive: true });
    await fs.rename(fromResolved, toResolved);
    return c.json({ ok: true, from: body.from, to: body.to });
  } catch (err: any) {
    if (err.message === "Path traversal detected") {
      return c.json({ error: "Invalid path" }, 400);
    }
    return c.json({ error: "Failed to rename" }, 500);
  }
});

// Helper for external use (chat tools, etc.)
export { safePath, projectDir, listTree, PROJECTS_DIR };
