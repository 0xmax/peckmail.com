import { Hono } from "hono";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { randomUUID } from "crypto";
import { z } from "zod";
import { promises as fs } from "fs";
import { dirname } from "path";
import { authMiddleware, getUser } from "./auth.js";
import { getUserProjects, getProjectMembership, createProject, renameProject, deleteProject, createInvitation, supabaseAdmin } from "./db.js";
import { sendInvitationEmail } from "./email.js";
import { safePath, projectDir, listTree } from "./files.js";
import { getHistory, getUncommittedStatus, initRepo, stopGitManager } from "./git.js";

interface McpSession {
  transport: WebStandardStreamableHTTPServerTransport;
  server: McpServer;
  userId: string;
}

const sessions = new Map<string, McpSession>();

async function checkAccess(userId: string, projectId: string) {
  return !!(await getProjectMembership(projectId, userId));
}

function createMcpServer(userId: string): McpServer {
  const server = new McpServer(
    {
      name: "Perchpad",
      version: "0.1.0",
      description: "Perchpad is a collaborative writing and note-taking platform. Use these tools to read, write, and manage files across your Perchpad projects.",
    },
    {
      instructions: `You are connected to Perchpad — a collaborative writing and note-taking platform at https://perchpad.co.

## What is Perchpad?
Perchpad is a web-based writing environment where users organize their work into **projects**. Each project is a collection of files (primarily markdown documents) with built-in version control.

## Key concepts:
- **Projects**: Top-level containers for files. Users can own or be invited to projects. Use list_projects to see available projects.
- **Files**: Mostly markdown (.md) documents organized in directories. The editor supports rich markdown with a pastel theme.
- **Auto-versioning**: Perchpad automatically commits changes via git every 60 seconds. Use get_revisions to browse the edit history.
- **Collaboration**: Projects can be shared with other users who get editor access.
- **AI chat**: Perchpad has a built-in AI assistant (separate from this MCP connection) that can read and edit files within projects.

## How to use these tools:
1. Start with list_projects to see what projects the user has
2. Use create_project to make a new project, or rename_project / delete_project to manage existing ones
3. Use list_files to browse a project's file tree
4. Use read_file / write_file to view and edit documents
5. Use get_revisions and get_status to understand the edit history

## Tips:
- File paths are relative to the project root (e.g. "notes/ideas.md", not "/notes/ideas.md")
- Project IDs are UUIDs — get them from list_projects
- When writing files, provide the complete file content (not a diff)
- New directories are created automatically when writing to a nested path`,
    }
  );

  server.tool("list_projects", "List all Perchpad projects you have access to. Returns project IDs, names, and your role (owner/editor).", {}, async () => {
    try {
      const projects = await getUserProjects(userId);
      return { content: [{ type: "text", text: JSON.stringify(projects, null, 2) }] };
    } catch (e: any) {
      return { content: [{ type: "text", text: e.message }], isError: true };
    }
  });

  server.tool(
    "create_project",
    "Create a new Perchpad project. Returns the new project's ID and name. The project starts empty with version control initialized.",
    { name: z.string().describe("Name for the new project") },
    async ({ name }) => {
      try {
        const project = await createProject(name.trim(), userId);
        await initRepo(project.id);
        return { content: [{ type: "text", text: JSON.stringify(project, null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: e.message }], isError: true };
      }
    }
  );

  server.tool(
    "rename_project",
    "Rename an existing Perchpad project. Only owners can rename projects.",
    {
      projectId: z.string().describe("The project ID (UUID from list_projects)"),
      name: z.string().describe("New name for the project"),
    },
    async ({ projectId, name }) => {
      try {
        const membership = await getProjectMembership(projectId, userId);
        if (!membership) return { content: [{ type: "text", text: "Access denied" }], isError: true };
        if (membership.role !== "owner") return { content: [{ type: "text", text: "Only owners can rename projects" }], isError: true };
        await renameProject(projectId, name.trim());
        return { content: [{ type: "text", text: `Renamed project to "${name.trim()}"` }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: e.message }], isError: true };
      }
    }
  );

  server.tool(
    "delete_project",
    "Delete a Perchpad project (soft delete — files are preserved but the project is hidden). Only owners can delete projects.",
    { projectId: z.string().describe("The project ID (UUID from list_projects)") },
    async ({ projectId }) => {
      try {
        const membership = await getProjectMembership(projectId, userId);
        if (!membership) return { content: [{ type: "text", text: "Access denied" }], isError: true };
        if (membership.role !== "owner") return { content: [{ type: "text", text: "Only owners can delete projects" }], isError: true };
        stopGitManager(projectId);
        await deleteProject(projectId);
        return { content: [{ type: "text", text: `Deleted project ${projectId}` }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: e.message }], isError: true };
      }
    }
  );

  server.tool(
    "list_files",
    "List all files and directories in a Perchpad project as a tree. Files are typically markdown (.md) documents.",
    { projectId: z.string().describe("The project ID (UUID from list_projects)") },
    async ({ projectId }) => {
      try {
        if (!(await checkAccess(userId, projectId)))
          return { content: [{ type: "text", text: "Access denied" }], isError: true };
        const dir = projectDir(projectId);
        const tree = await listTree(dir, dir);
        return { content: [{ type: "text", text: JSON.stringify(tree, null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: e.message }], isError: true };
      }
    }
  );

  server.tool(
    "read_file",
    "Read the contents of a file in a Perchpad project. Returns the full file content as text.",
    {
      projectId: z.string().describe("The project ID (UUID from list_projects)"),
      path: z.string().describe("File path relative to project root (e.g. 'notes/ideas.md')"),
    },
    async ({ projectId, path }) => {
      try {
        if (!(await checkAccess(userId, projectId)))
          return { content: [{ type: "text", text: "Access denied" }], isError: true };
        const resolved = safePath(projectId, path);
        const content = await fs.readFile(resolved, "utf-8");
        return { content: [{ type: "text", text: content }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: e.message }], isError: true };
      }
    }
  );

  server.tool(
    "write_file",
    "Write content to a file in a Perchpad project. Creates the file if it doesn't exist, or overwrites it. Parent directories are created automatically. Changes are auto-committed via git.",
    {
      projectId: z.string().describe("The project ID (UUID from list_projects)"),
      path: z.string().describe("File path relative to project root (e.g. 'notes/ideas.md')"),
      content: z.string().describe("The full file content to write"),
    },
    async ({ projectId, path, content }) => {
      try {
        if (!(await checkAccess(userId, projectId)))
          return { content: [{ type: "text", text: "Access denied" }], isError: true };
        const resolved = safePath(projectId, path);
        await fs.mkdir(dirname(resolved), { recursive: true });
        await fs.writeFile(resolved, content, "utf-8");
        return { content: [{ type: "text", text: `Wrote ${path}` }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: e.message }], isError: true };
      }
    }
  );

  server.tool(
    "create_directory",
    "Create a directory in a Perchpad project. Parent directories are created automatically.",
    {
      projectId: z.string().describe("The project ID (UUID from list_projects)"),
      path: z.string().describe("Directory path relative to project root (e.g. 'notes/drafts')"),
    },
    async ({ projectId, path }) => {
      try {
        if (!(await checkAccess(userId, projectId)))
          return { content: [{ type: "text", text: "Access denied" }], isError: true };
        const resolved = safePath(projectId, path);
        await fs.mkdir(resolved, { recursive: true });
        return { content: [{ type: "text", text: `Created directory ${path}` }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: e.message }], isError: true };
      }
    }
  );

  server.tool(
    "delete_file",
    "Delete a file or directory from a Perchpad project. Directories are deleted recursively.",
    {
      projectId: z.string().describe("The project ID (UUID from list_projects)"),
      path: z.string().describe("File or directory path relative to project root"),
    },
    async ({ projectId, path }) => {
      try {
        if (!(await checkAccess(userId, projectId)))
          return { content: [{ type: "text", text: "Access denied" }], isError: true };
        const resolved = safePath(projectId, path);
        const stat = await fs.stat(resolved);
        if (stat.isDirectory()) {
          await fs.rm(resolved, { recursive: true });
        } else {
          await fs.unlink(resolved);
        }
        return { content: [{ type: "text", text: `Deleted ${path}` }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: e.message }], isError: true };
      }
    }
  );

  server.tool(
    "rename_file",
    "Rename or move a file or directory within a Perchpad project.",
    {
      projectId: z.string().describe("The project ID (UUID from list_projects)"),
      from: z.string().describe("Current file path"),
      to: z.string().describe("New file path"),
    },
    async ({ projectId, from, to }) => {
      try {
        if (!(await checkAccess(userId, projectId)))
          return { content: [{ type: "text", text: "Access denied" }], isError: true };
        const fromResolved = safePath(projectId, from);
        const toResolved = safePath(projectId, to);
        await fs.mkdir(dirname(toResolved), { recursive: true });
        await fs.rename(fromResolved, toResolved);
        return { content: [{ type: "text", text: `Renamed ${from} → ${to}` }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: e.message }], isError: true };
      }
    }
  );

  server.tool(
    "get_revisions",
    "Get the git revision history for a Perchpad project. Perchpad auto-commits changes every 60 seconds, so revisions represent a timeline of edits.",
    {
      projectId: z.string().describe("The project ID (UUID from list_projects)"),
      limit: z.number().optional().describe("Max revisions to return (default 20)"),
      offset: z.number().optional().describe("Offset for pagination (default 0)"),
    },
    async ({ projectId, limit, offset }) => {
      try {
        if (!(await checkAccess(userId, projectId)))
          return { content: [{ type: "text", text: "Access denied" }], isError: true };
        const history = await getHistory(projectId, {
          limit: limit ?? 20,
          offset: offset ?? 0,
        });
        return { content: [{ type: "text", text: JSON.stringify(history, null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: e.message }], isError: true };
      }
    }
  );

  server.tool(
    "get_status",
    "Get the current uncommitted changes in a Perchpad project. Shows files that have been modified since the last auto-commit.",
    { projectId: z.string().describe("The project ID (UUID from list_projects)") },
    async ({ projectId }) => {
      try {
        if (!(await checkAccess(userId, projectId)))
          return { content: [{ type: "text", text: "Access denied" }], isError: true };
        const status = await getUncommittedStatus(projectId);
        return { content: [{ type: "text", text: JSON.stringify(status, null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: e.message }], isError: true };
      }
    }
  );

  server.tool(
    "invite_to_project",
    "Invite a user by email to collaborate on a Perchpad project. Only project owners can invite. Sends an invitation email to the recipient.",
    {
      projectId: z.string().describe("The project ID (UUID from list_projects)"),
      email: z.string().describe("Email address of the user to invite"),
      role: z.enum(["owner", "editor", "viewer"]).optional().describe("Role to assign: 'owner' (admin/full control), 'editor' (read+write), or 'viewer' (read-only). Defaults to 'editor'."),
    },
    async ({ projectId, email, role }) => {
      try {
        const membership = await getProjectMembership(projectId, userId);
        if (!membership) return { content: [{ type: "text", text: "Access denied" }], isError: true };
        if (membership.role !== "owner") return { content: [{ type: "text", text: "Only owners can invite" }], isError: true };

        const normalizedEmail = email.trim().toLowerCase();

        // Check for duplicate pending invitation
        const { data: existing } = await supabaseAdmin
          .from("invitations")
          .select("id")
          .eq("project_id", projectId)
          .eq("email", normalizedEmail)
          .eq("status", "pending")
          .maybeSingle();
        if (existing) return { content: [{ type: "text", text: "Invitation already pending for this email" }], isError: true };

        const invitation = await createInvitation(projectId, normalizedEmail, userId, role ?? "editor");

        // Look up project name + inviter display name for the email
        const { data: project } = await supabaseAdmin
          .from("projects")
          .select("name")
          .eq("id", projectId)
          .single();
        const { data: { user: authUser } } = await supabaseAdmin.auth.admin.getUserById(userId);
        const inviterName =
          authUser?.user_metadata?.display_name ||
          authUser?.user_metadata?.full_name ||
          authUser?.email ||
          "Someone";

        // Fire-and-forget email
        sendInvitationEmail({
          to: normalizedEmail,
          invitationId: invitation.id,
          projectName: project?.name ?? "Untitled",
          inviterName,
        });

        return { content: [{ type: "text", text: `Invited ${normalizedEmail} to project. Invitation email sent.` }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: e.message }], isError: true };
      }
    }
  );

  return server;
}

export const mcpRouter = new Hono();

// All MCP methods on a single endpoint
mcpRouter.all("/", authMiddleware, async (c) => {
  const user = getUser(c);
  const sessionId = c.req.header("mcp-session-id");

  // Existing session
  if (sessionId && sessions.has(sessionId)) {
    const session = sessions.get(sessionId)!;
    if (session.userId !== user.id) {
      return c.json({ error: "Forbidden" }, 403);
    }
    return session.transport.handleRequest(c.req.raw);
  }

  // New session (initialize)
  if (!sessionId) {
    const server = createMcpServer(user.id);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      enableJsonResponse: true,
      onsessioninitialized: (sid) => {
        sessions.set(sid, { transport, server, userId: user.id });
      },
      onsessionclosed: (sid) => {
        sessions.delete(sid);
      },
    });
    transport.onclose = () => {
      if (transport.sessionId) sessions.delete(transport.sessionId);
    };
    await server.connect(transport);
    return transport.handleRequest(c.req.raw);
  }

  // Invalid session ID
  return c.json(
    { jsonrpc: "2.0", error: { code: -32000, message: "Invalid session" } },
    { status: 400 }
  );
});
