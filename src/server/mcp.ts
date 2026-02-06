import { Hono } from "hono";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { randomUUID } from "crypto";
import { z } from "zod";
import { authMiddleware, getUser } from "./auth.js";
import { getUserProjects, getProjectMembership, getProjectMemberEmails, createProject, renameProject, deleteProject, createInvitation, supabaseAdmin } from "./db.js";
import { sendInvitationEmail, sendEmail } from "./email.js";
import * as fileOps from "./fileOps.js";
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
      instructions: `You are connected to Perchpad — a collaborative writing and data platform at https://perchpad.co.

## What is Perchpad?
Perchpad is a web-based workspace where users organize their work into **projects**. Each project is a collection of files with built-in version control. Perchpad focuses on two primary file formats:
- **Markdown (.md)** — rich text documents, notes, outlines, and prose.
- **CSV (.csv)** — structured tabular data such as lists, trackers, logs, and datasets.

## Key concepts:
- **Projects**: Top-level containers for files. Users can own or be invited to projects. Use list_projects to see available projects.
- **Files**: Markdown and CSV files organized in directories. The editor supports rich markdown with a pastel theme and renders CSV as editable tables.
- **Auto-versioning**: Perchpad automatically commits changes via git every 60 seconds. Use get_revisions to browse the edit history.
- **Collaboration**: Projects can be shared with other users who get editor access.
- **AI chat**: Perchpad has a built-in AI assistant (separate from this MCP connection) that can read and edit files within projects.

## How to use these tools:
1. Start with list_projects to see what projects the user has
2. Use create_project to make a new project, or rename_project / delete_project to manage existing ones
3. Use list_files to browse a project's file tree
4. Use read_file / write_file to view and edit documents and data files
5. Use get_revisions and get_status to understand the edit history

## Working with CSV files:
- CSV files use the first row as a header row with column names
- When writing CSV, preserve consistent column counts and properly quote fields that contain commas or newlines
- Always read the file first to understand the existing structure before making edits
- Common use cases: task trackers, reading lists, habit logs, contact lists, inventories, and any structured data

## Tips:
- File paths are relative to the project root (e.g. "notes/ideas.md", "data/tasks.csv")
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
        const tree = await fileOps.listFiles(projectId);
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
        const content = await fileOps.readFile(projectId, path);
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
        await fileOps.writeFile(projectId, path, content);
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
        await fileOps.createDirectory(projectId, path);
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
        await fileOps.deleteFile(projectId, path);
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
        await fileOps.moveFile(projectId, from, to);
        return { content: [{ type: "text", text: `Renamed ${from} → ${to}` }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: e.message }], isError: true };
      }
    }
  );

  server.tool(
    "copy_file",
    "Copy a file to a new location within a Perchpad project. Parent directories are created automatically.",
    {
      projectId: z.string().describe("The project ID (UUID from list_projects)"),
      from: z.string().describe("Source file path relative to project root"),
      to: z.string().describe("Destination file path relative to project root"),
    },
    async ({ projectId, from, to }) => {
      try {
        if (!(await checkAccess(userId, projectId)))
          return { content: [{ type: "text", text: "Access denied" }], isError: true };
        await fileOps.copyFile(projectId, from, to);
        return { content: [{ type: "text", text: `Copied ${from} → ${to}` }] };
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

  server.tool(
    "send_email",
    "Send an email to a workspace member. Can only send to email addresses of people who are members of the specified project.",
    {
      project_id: z.string().describe("The project ID (UUID from list_projects)"),
      to: z.string().describe("Recipient email address (must be a workspace member)"),
      subject: z.string().describe("Email subject line"),
      body: z.string().describe("Email body in plain text"),
    },
    async ({ project_id, to, subject, body }) => {
      try {
        if (!(await checkAccess(userId, project_id)))
          return { content: [{ type: "text", text: "Access denied" }], isError: true };
        const memberEmails = await getProjectMemberEmails(project_id);
        const recipient = to.trim().toLowerCase();
        if (!memberEmails.includes(recipient)) {
          return { content: [{ type: "text", text: `"${to}" is not a member of this workspace. You can only send emails to workspace members.` }], isError: true };
        }
        await sendEmail({ to: recipient, subject, body });
        return { content: [{ type: "text", text: `Email sent to ${recipient}` }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: e.message }], isError: true };
      }
    }
  );

  server.resource(
    "faq",
    "perchpad://faq",
    {
      description: "Perchpad FAQ and features guide — lists all capabilities including file editing, AI assistant, git integration, email processing, TTS, and collaboration features.",
      mimeType: "text/plain",
    },
    async () => {
      return {
        contents: [
          {
            uri: "perchpad://faq",
            text: FAQ_TEXT,
            mimeType: "text/plain",
          },
        ],
      };
    }
  );

  return server;
}

const FAQ_TEXT = `# Perchpad — Features & FAQ

## What is Perchpad?
Perchpad is a web-based collaborative writing workspace. Organize your work into projects, write in markdown, manage structured data in CSV files, and let the built-in AI assistant help you along the way. Everything is version-controlled and synced in real time.

## File Formats
- **Markdown (.md)** — rich text documents, notes, outlines, and prose. Rendered with live preview and line-level highlighting.
- **CSV (.csv)** — structured tabular data like task trackers, reading lists, and datasets. Rendered as styled, editable tables with sticky headers.

## AI Assistant
Built-in AI assistant powered by Claude with 21 tools for reading, editing, creating, and searching files within your project. Streams responses in real time and is aware of your currently open file and cursor position. Tools include file operations (read, edit, create, move, copy, delete), text utilities (grep, find, sort, diff, sed), editor highlighting, and email to workspace members.

## Auto-Save & Version History
Automatically saves and commits changes every 60 seconds using git. Browse the full revision history, view diffs for any commit, and see exactly what changed over time. Manual commits are also supported.

## Git Integration
Every project is a git repository. Git Smart HTTP endpoints let you clone, push, and pull using standard git commands. Auth uses API keys via HTTP Basic Auth (password is your pp_ API key, username is ignored).

## Real-Time Collaboration
Multiple users can work on the same project simultaneously. File changes, cursor positions, and chat messages sync in real time over WebSockets.

## Email Integration
Each workspace gets a unique email address (e.g. robin-willow-42@in.perchpad.co). Emails sent to this address are processed by an AI agent that reads the content and updates project files. Configure agent behavior via an AGENTS.md file in the project root.

## Text-to-Speech
Read documents aloud using ElevenLabs or OpenAI TTS. The current sentence is highlighted in the editor during playback. Choose your preferred provider and voice in account settings.

## MCP Server
Model Context Protocol server with 14 tools for external AI integrations. Connect from Claude Desktop or any MCP-compatible client to manage projects, read/write files, browse revision history, invite collaborators, and send emails.

## Sharing
Share individual files via public links (no login needed). Invite collaborators by email with role-based access: owners (full control), editors (read+write), viewers (read-only).

## API Keys
Generate API keys (pp_ prefix) for programmatic access. API keys authenticate Git operations, the MCP server, and the REST API. Manage keys from account settings.
`;

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
