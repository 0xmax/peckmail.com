# Claude Integration (MCP)

Peckmail has a Model Context Protocol (MCP) server that lets you connect your workspace to Claude Desktop, Claude Code, or any MCP-compatible AI client.

## What is MCP?

MCP is a protocol that lets AI assistants use external tools. When you connect Peckmail as an MCP server, Claude can directly read and write files in your workspace, manage projects, and collaborate with your team from your desktop AI client.

## Setting it up

1. Go to **Settings** and copy your API key (starts with `pp_`)
2. In Claude Desktop, go to Settings > MCP Servers and add a new server:
   - **URL**: `https://peckmail.com/mcp`
   - **Authentication**: Use your API key as a Bearer token

## Available tools

Once connected, Claude has access to these tools:

- `list_projects` — See all your workspaces
- `read_file` / `write_file` — Read and edit files
- `list_files` — Browse the file tree
- `create_project` / `rename_project` / `delete_project` — Manage workspaces
- `invite_to_project` — Invite collaborators by email
- `send_email` — Email workspace members

## Use cases

- Ask Claude to update your task lists from your desktop
- Have Claude draft documents directly into your workspace
- Use Claude Code to manage your writing projects alongside code
- Automate workflows that read from and write to Peckmail
