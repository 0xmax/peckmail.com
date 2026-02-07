import { Hono } from "hono";
import { promises as fs } from "fs";
import { join, resolve, relative, extname, dirname } from "path";
import { getUser, type AuthUser } from "./auth.js";
import { getProjectMembership, getUserProjects } from "./db.js";

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

// Copy template-project/ into a new project directory
const TEMPLATE_DIR = resolve(
  process.env.TEMPLATE_DIR || join(dirname(new URL(import.meta.url).pathname), "..", "..", "template-project")
);

async function copyDirRecursive(src: string, dest: string) {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDirRecursive(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

export async function seedTemplate(projectId: string): Promise<void> {
  console.log("[files] seedTemplate: TEMPLATE_DIR =", TEMPLATE_DIR);
  try {
    await fs.access(TEMPLATE_DIR);
  } catch {
    console.warn("[files] Template directory not found:", TEMPLATE_DIR);
    return;
  }
  const dest = join(PROJECTS_DIR, projectId);
  console.log("[files] seedTemplate: copying to", dest);
  await copyDirRecursive(TEMPLATE_DIR, dest);
  const files = await fs.readdir(dest);
  console.log("[files] seedTemplate: result files =", files);
}

// --- Full-text search across all user projects ---

const TEXT_EXTENSIONS = new Set([
  ".md", ".csv", ".txt", ".json", ".yaml", ".yml", ".toml",
  ".html", ".css", ".js", ".ts", ".tsx", ".jsx", ".xml", ".svg",
]);

function collectFilePaths(
  tree: Array<{ path: string; type: string; children?: any[] }>
): string[] {
  const paths: string[] = [];
  for (const entry of tree) {
    if (entry.type === "file") {
      const ext = extname(entry.path).toLowerCase();
      if (TEXT_EXTENSIONS.has(ext)) paths.push(entry.path);
    } else if (entry.children) {
      paths.push(...collectFilePaths(entry.children));
    }
  }
  return paths;
}

interface FileMatch {
  projectId: string;
  path: string;
  line: number;
  context: string;
}

const MAX_MATCHES_PER_PROJECT = 5;
const MAX_TOTAL_MATCHES = 50;
const MAX_FILE_SIZE = 512 * 1024; // skip files > 512KB

export async function searchFiles(
  userId: string,
  query: string
): Promise<FileMatch[]> {
  const projects = await getUserProjects(userId);
  const q = query.toLowerCase();
  const allMatches: FileMatch[] = [];

  for (const project of projects) {
    if (allMatches.length >= MAX_TOTAL_MATCHES) break;
    const dir = projectDir(project.id);
    let tree: any[];
    try {
      tree = await listTree(dir, dir);
    } catch {
      continue; // project dir might not exist
    }

    const filePaths = collectFilePaths(tree);
    let projectMatches = 0;

    for (const filePath of filePaths) {
      if (projectMatches >= MAX_MATCHES_PER_PROJECT) break;
      if (allMatches.length >= MAX_TOTAL_MATCHES) break;

      const fullPath = join(dir, filePath);
      try {
        const stat = await fs.stat(fullPath);
        if (stat.size > MAX_FILE_SIZE) continue;
        const content = await fs.readFile(fullPath, "utf-8");
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          if (projectMatches >= MAX_MATCHES_PER_PROJECT) break;
          if (allMatches.length >= MAX_TOTAL_MATCHES) break;
          if (lines[i].toLowerCase().includes(q)) {
            allMatches.push({
              projectId: project.id,
              path: filePath,
              line: i + 1,
              context: lines[i].slice(0, 200),
            });
            projectMatches++;
          }
        }
      } catch {
        continue;
      }
    }
  }

  return allMatches;
}

export const fileSearchRouter = new Hono();

fileSearchRouter.get("/search", async (c) => {
  const user = getUser(c);
  const query = c.req.query("q")?.trim();
  if (!query || query.length < 2) {
    return c.json({ matches: [] });
  }
  try {
    const matches = await searchFiles(user.id, query);
    return c.json({ matches });
  } catch (err: any) {
    console.error("[search] Error:", err.message);
    return c.json({ error: "Search failed" }, 500);
  }
});

// Helper for external use (chat tools, etc.)
export { safePath, projectDir, listTree, PROJECTS_DIR };
