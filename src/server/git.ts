import git from "isomorphic-git";
import { promises as fs } from "fs";
import { join } from "path";
import Anthropic from "@anthropic-ai/sdk";
import { PROJECTS_DIR } from "./files.js";

const anthropic = new Anthropic();

// Track active git manager intervals
const gitManagers = new Map<string, ReturnType<typeof setInterval>>();

export async function initRepo(projectId: string) {
  const dir = join(PROJECTS_DIR, projectId);
  await fs.mkdir(dir, { recursive: true });

  // Initialize git repo
  await git.init({ fs, dir });

  // Create initial .gitignore
  await fs.writeFile(join(dir, ".gitignore"), ".perchpad/\n.tts/\n", "utf-8");

  // Create .perchpad/chats directory
  await fs.mkdir(join(dir, ".perchpad", "chats"), { recursive: true });

  // Initial commit
  await git.add({ fs, dir, filepath: ".gitignore" });
  await git.commit({
    fs,
    dir,
    message: "Initialize workspace",
    author: { name: "Perchpad", email: "perchpad@local" },
  });
}

export function startGitManager(projectId: string) {
  if (gitManagers.has(projectId)) return;

  const interval = setInterval(async () => {
    try {
      await autoCommit(projectId);
    } catch (err) {
      console.error(`[git] Auto-commit error for ${projectId}:`, err);
    }
  }, 60_000);

  gitManagers.set(projectId, interval);
}

export function stopGitManager(projectId: string) {
  const interval = gitManagers.get(projectId);
  if (interval) {
    clearInterval(interval);
    gitManagers.delete(projectId);
  }
}

async function autoCommit(projectId: string) {
  const dir = join(PROJECTS_DIR, projectId);

  // Get status matrix
  const matrix = await git.statusMatrix({ fs, dir });

  // Filter for changed files (not in .perchpad/ or .git/)
  const changed = matrix.filter(([filepath, head, workdir, stage]) => {
    if (filepath.startsWith(".perchpad/") || filepath.startsWith(".git/"))
      return false;
    // head !== workdir means file has changed
    return head !== workdir || head !== stage;
  });

  if (changed.length === 0) return;

  // Stage all changed files
  for (const [filepath, head, workdir, _stage] of changed) {
    if (workdir === 0) {
      // File was deleted
      await git.remove({ fs, dir, filepath });
    } else {
      await git.add({ fs, dir, filepath });
    }
  }

  // Build diff description for LLM
  const diffParts: string[] = [];
  for (const [filepath, head, workdir] of changed) {
    if (head === 0 && workdir === 2) {
      diffParts.push(`New file: ${filepath}`);
    } else if (workdir === 0) {
      diffParts.push(`Deleted: ${filepath}`);
    } else {
      // Read current content for context
      try {
        const content = await fs.readFile(join(dir, filepath), "utf-8");
        const preview = content.slice(0, 500);
        diffParts.push(`Modified: ${filepath}\n  Preview: ${preview}`);
      } catch {
        diffParts.push(`Modified: ${filepath}`);
      }
    }
  }

  // Generate commit message with Haiku
  let commitMessage: string;
  try {
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 200,
      messages: [
        {
          role: "user",
          content: `You are generating a friendly, concise description of changes to a writing project. No technical jargon — this is for writers, not developers. Write a single sentence, max 100 characters.

Changes:
${diffParts.join("\n")}

Description:`,
        },
      ],
    });
    const block = response.content[0];
    commitMessage =
      block.type === "text" ? block.text.trim() : "Updated files";
  } catch {
    commitMessage =
      changed.length === 1
        ? `Updated ${changed[0][0]}`
        : `Updated ${changed.length} files`;
  }

  // Commit
  await git.commit({
    fs,
    dir,
    message: commitMessage,
    author: { name: "Perchpad", email: "perchpad@local" },
  });

  console.log(`[git] ${projectId}: ${commitMessage}`);
}

// Get commit history
export async function getHistory(
  projectId: string,
  opts: { limit?: number; offset?: number } = {}
) {
  const dir = join(PROJECTS_DIR, projectId);
  const limit = opts.limit || 20;
  const offset = opts.offset || 0;

  try {
    const commits = await git.log({ fs, dir, depth: limit + offset });
    return commits.slice(offset, offset + limit).map((c) => ({
      hash: c.oid,
      message: c.commit.message,
      date: new Date(c.commit.author.timestamp * 1000).toISOString(),
      author: c.commit.author.name,
    }));
  } catch {
    return [];
  }
}

// Get files changed in a commit
export async function getCommitDiff(projectId: string, commitHash: string) {
  const dir = join(PROJECTS_DIR, projectId);

  try {
    const commit = await git.readCommit({ fs, dir, oid: commitHash });
    const parentOid = commit.commit.parent[0];

    if (!parentOid) {
      // First commit — just list the tree
      const tree = await git.listFiles({ fs, dir, ref: commitHash });
      return tree.map((f) => ({ path: f, status: "added" }));
    }

    // Compare trees
    const currentFiles = await git.listFiles({ fs, dir, ref: commitHash });
    const parentFiles = await git.listFiles({ fs, dir, ref: parentOid });

    const changes: Array<{ path: string; status: string }> = [];
    const parentSet = new Set(parentFiles);
    const currentSet = new Set(currentFiles);

    for (const f of currentFiles) {
      if (!parentSet.has(f)) {
        changes.push({ path: f, status: "added" });
      } else {
        // Check if content changed
        const currentBlob = await git.readBlob({
          fs,
          dir,
          oid: commitHash,
          filepath: f,
        });
        const parentBlob = await git.readBlob({
          fs,
          dir,
          oid: parentOid,
          filepath: f,
        });
        if (
          Buffer.from(currentBlob.blob).toString() !==
          Buffer.from(parentBlob.blob).toString()
        ) {
          changes.push({ path: f, status: "modified" });
        }
      }
    }

    for (const f of parentFiles) {
      if (!currentSet.has(f)) {
        changes.push({ path: f, status: "deleted" });
      }
    }

    return changes;
  } catch {
    return [];
  }
}
