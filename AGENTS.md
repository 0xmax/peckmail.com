# Peckmail

Peckmail is a collaborative writing workspace for markdown and CSV files. It features a built-in AI assistant, real-time sync, text-to-speech, and an MCP server for external tool integrations.

## Style & Design Language

Peckmail's visual identity is **warm, pastel, and calming** — a cozy writing environment that feels like a sunlit notebook.

**Color palette** (defined in `src/client/index.css` `@theme {}` block):
- `--color-bg: #faf6f1` — warm cream background
- `--color-surface: #ffffff` — clean white cards/panels
- `--color-surface-alt: #f5ebe0` — soft linen for secondary surfaces
- `--color-accent: #c4956a` — warm terracotta/copper accent
- `--color-accent-hover: #b07d52` — deeper copper on hover
- `--color-text: #3d3229` — deep espresso for body text
- `--color-text-muted: #9a8b7a` — warm taupe for secondary text
- `--color-border: #e8ddd0` — subtle cream border
- `--color-chat-user: #e5eed8` — soft sage green for user chat bubbles
- `--color-chat-ai: #f5ebe0` — linen for AI chat bubbles
- `--color-success: #81c784` — gentle green
- `--color-danger: #e57373` — soft coral red

**Typography**: Georgia serif for the editor and preview (literary feel), system-ui sans-serif for the UI chrome. Line height 1.75 for comfortable reading.

**Mascot**: Birdie — a friendly little bird that represents Peckmail. The logo lives at `src/client/assets/logo.png` and is displayed in the workspace header alongside the "Peckmail" wordmark (set in Playfair Display serif).

**Design principles**:
- Soft rounded corners, subtle shadows, airy spacing
- Transitions are gentle (150–200ms ease)
- Scrollbars are thin (6px) and blend into the background
- The editor cursor and selections use the warm accent color
- Everything should feel quiet, focused, and beautiful — like a writing retreat

## Architecture

| Layer | Tech |
|-------|------|
| Server | Node.js + Hono + @hono/node-server + @hono/node-ws |
| Client | React 19 SPA bundled with esbuild |
| Styling | Tailwind CSS v4 (`@import "tailwindcss"` + `@theme {}` — no tailwind.config) |
| Editor | CodeMirror 6 with markdown + custom pastel theme |
| Auth/DB | Supabase (Auth + Postgres with RLS) |
| AI | Anthropic SDK (Claude for chat and workspace automations) |
| Email | Resend (invitation emails + inbound email processing via webhook) |
| TTS | ElevenLabs / OpenAI (text-to-speech with sentence highlighting) |
| MCP | Model Context Protocol server for external tool integrations |
| Deploy | Fly.io (Docker, persistent volume at `/data`) |

## Project Structure

```
peckmail/
├── src/
│   ├── server/
│   │   ├── index.ts        # Hono app, all API routes, WS upgrade, SPA fallback
│   │   ├── auth.ts         # Supabase auth middleware + API key auth
│   │   ├── chat.ts         # AI assistant with 21 tools, streaming via WS
│   │   ├── mcp.ts          # MCP server (13 tools) for external integrations
│   │   ├── files.ts        # File router (REST endpoints)
│   │   ├── fileOps.ts      # Shared file operations (used by chat.ts + mcp.ts)
│   │   ├── ws.ts           # WebSocket manager, fs.watch, broadcasting
│   │   ├── db.ts           # Supabase database helpers
│   │   ├── email.ts        # Resend email invitations
│   │   ├── emailAddress.ts # Bird-themed email address generator
│   │   ├── inbound.ts      # Inbound email processing (webhook + agent runner)
│   │   └── tts.ts          # TTS API router
│   └── client/
│       ├── main.tsx        # Entry point
│       ├── App.tsx         # Root component, URL-based routing
│       ├── index.css       # Tailwind v4 theme + custom styles
│       ├── components/     # 20 React components
│       ├── context/        # AuthContext (Supabase auth state)
│       ├── store/          # Global state (reducer pattern)
│       └── lib/            # API client + Supabase client
├── supabase/
│   └── migrations/         # SQL migrations (tables, RLS, FKs)
├── projects/               # User project files on disk
├── esbuild.config.ts       # Client bundler config
├── tsconfig.json           # Server TypeScript config
├── tsconfig.client.json    # Client TypeScript config
├── Dockerfile              # Multi-stage build (builder → node:20-alpine)
├── fly.toml                # Fly.io config (iad region, persistent volume)
└── Makefile                # dev, build, deploy, logs, status, ssh
```

## File Formats

Peckmail primarily works with two file formats:
- **Markdown (.md)** — rich text documents, notes, outlines, and prose
- **CSV (.csv)** — structured tabular data (lists, trackers, logs, datasets)

The preview mode renders markdown with line-level highlighting and CSV as styled tables with sticky headers.

## Environment Variables

**Required:**
| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Claude API key for AI assistant |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_ANON_KEY` | Supabase anonymous key (injected into client HTML) |
| `SUPABASE_SERVICE_KEY` | Supabase service role key (server-side only) |

**Optional:**
| Variable | Description |
|----------|-------------|
| `PORT` | Server port (default: 3000) |
| `PROJECTS_DIR` | File storage directory (default: `./projects`) |
| `RESEND_API_KEY` | Resend API key for invitation emails |
| `RESEND_WEBHOOK_SECRET` | Svix signing secret from Resend webhook config for inbound email verification |
| `ELEVENLABS_API_KEY` | ElevenLabs TTS API key |
| `OPENAI_API_KEY` | OpenAI TTS API key (fallback) |

## Build & Dev

```bash
npm run dev      # Concurrent: server (tsx) + esbuild (watch) + tailwind (watch)
npm run build    # One-shot: esbuild bundle + tailwind minify
npm start        # Run production: node dist/server/index.js
make deploy      # fly deploy
```

- Tailwind v4 uses `@import "tailwindcss"` and `@theme {}` in `index.css` — there is no `tailwind.config.ts`
- Supabase config is injected into the client HTML via string replacement in the SPA fallback route
- Both `tsconfig.json` (server) and `tsconfig.client.json` (client) use `--noEmit` type-checking

## Database Schema

**Tables** (Supabase Postgres with RLS):

- **profiles** — extends auth.users with display_name, avatar_url
- **projects** — id, name, created_at, deleted_at (soft delete)
- **project_members** — project_id, user_id, role (`owner` | `editor` | `viewer`)
- **project_emails** — project_id, email (unique), type (`peckmail` | `imap`)
- **invitations** — project_id, email, invited_by, role, status (`pending` | `accepted`)
- **share_links** — token, project_id, file_path, created_by
- **api_keys** — id, user_id, key_hash (SHA-256), name, last_used_at
- **incoming_emails** — id, project_id, resend_email_id (idempotency), from/to/subject/body, processed, agent_session_id

All tables have row-level security policies scoped to project membership.

## API Routes

### Auth
All `/api/*` routes require a valid Supabase JWT or API key (`pp_` prefix).

### Projects
- `GET /api/projects` — list user's projects
- `POST /api/projects` — create project
- `GET /api/projects/:id/members` — list members
- `PUT /api/projects/:id/members/:userId` — update member role (owner)
- `DELETE /api/projects/:id/members/:userId` — remove member (owner)
- `GET /api/projects/:id/settings` — get .peckmail.json
- `PUT /api/projects/:id/settings` — update settings

### Files
- `GET /api/files/:projectId/tree` — file tree
- `GET /api/files/:projectId/read` — read file
- `POST /api/files/:projectId/write` — write file
- `POST /api/files/:projectId/rename` — move/rename
- `POST /api/files/:projectId/delete` — delete
- `POST /api/files/:projectId/copy` — copy
- `POST /api/files/:projectId/mkdir` — create directory

### Chat
- `GET /api/chat/:projectId/sessions` — list sessions
- `GET /api/chat/:projectId/sessions/:id` — get session + messages
- `POST /api/chat/:projectId/sessions` — create session
- `DELETE /api/chat/:projectId/sessions/:id` — delete session

### Inbound Email
- `GET /api/projects/:id/email` — get workspace email address (lazy backfill)
- `GET /api/projects/:id/email-addresses` — list all workspace-attached email addresses
- `POST /api/projects/:id/email-addresses` — attach an email address (`peckmail` or `imap`) to workspace
- `POST /api/webhooks/resend` — Resend inbound email webhook (no auth, svix-verified)

### Other
- `POST /api/projects/:id/invite` — invite user by email
- `GET /api/invitations` — list pending invitations
- `POST /api/invitations/:id/accept` — accept invitation
- `POST /api/projects/:id/share` — create share link
- `GET /s/:token` — view shared file (public, no auth)
- `POST /api/keys` / `GET /api/keys` / `DELETE /api/keys/:id` — API key management
- `POST /api/keys/ensure-default` — auto-creates a default API key if user has none (called on login)
- `GET /api/user/preferences` / `PUT /api/user/preferences` — TTS prefs

### WebSocket
- `GET /ws/:projectId?token=...` — real-time sync (file changes, chat streaming, cursor positions)

### MCP
- `ALL /mcp/` — MCP server endpoint (stateful sessions)

## AI Assistant (Internal)

The chat assistant (`src/server/chat.ts`) uses Claude with 21 tools for file operations and text manipulation:

**File tools:** `read_file`, `edit_file`, `create_file`, `list_files`, `move_file`, `copy_file`, `delete_file`, `append`

**Text tools:** `grep`, `find`, `head`, `tail`, `wc`, `sort_lines`, `sed`, `uniq`, `diff`, `slice`, `delete_lines`, `outline`

**UI tools:** `highlight` (highlight lines in the editor for visual feedback)

**Communication tools:** `send_email` (send an email to a workspace member — recipient must be a project member)

Messages are streamed via WebSocket. The assistant has context about the currently open file and cursor position.

## MCP Server (External)

The MCP server (`src/server/mcp.ts`) exposes 13 tools for external integrations:

`list_projects`, `create_project`, `rename_project`, `delete_project`, `list_files`, `read_file`, `write_file`, `create_directory`, `delete_file`, `rename_file`, `copy_file`, `invite_to_project`, `send_email`

Both the internal assistant and MCP server share the same file operations layer (`src/server/fileOps.ts`) which handles path safety and WebSocket broadcasting.

## Client Components

| Component | Purpose |
|-----------|---------|
| `Workspace.tsx` | Main layout: sidebar, editor/preview, chat, members panels |
| `Editor.tsx` | CodeMirror 6 with markdown, pastel theme, auto-save via WS |
| `Preview.tsx` | Markdown preview (line highlighting, TTS cursor) + CSV table view |
| `FileTree.tsx` | Recursive file tree with expand/collapse |
| `ChatPanel.tsx` | AI chat interface with session management |
| `ReadAloud.tsx` | TTS audio bar with playback controls |
| `MembersPanel.tsx` | View/manage project members and roles |
| `InviteModal.tsx` | Invite users by email |
| `InvitePage.tsx` | Accept invitation landing page |
| `ShareButton.tsx` | Generate public share links |
| `ProjectList.tsx` | Project list, create/delete, view invitations |
| `LoginPage.tsx` | Email magic link authentication |
| `AccountSettings.tsx` | Profile, TTS preferences, API key management |
| `EmailPanel.tsx` | Workspace inbound email address with copy button |
| `OAuthConsent.tsx` | OAuth consent flow for MCP |
| `UserAvatar.tsx` | Avatar with fallback initials |
| `ChatMessage.tsx` | Individual chat message rendering |
| `CreateProjectModal.tsx` | New project creation modal |

## Real-Time Sync

WebSocket events broadcast file system changes to all connected clients:

- `file:changed` / `file:updated` — file content changed
- `tree:add` — new file or directory created
- `tree:remove` — file or directory deleted
- `tree:rename` — file moved/renamed
- `mutation:ack` / `mutation:nack` — write confirmation to acting client

The server uses `fs.watch` to detect external changes and broadcasts them. File operations from chat and MCP also broadcast updates.

## Roles & Permissions

| Role | Capabilities |
|------|-------------|
| `owner` | Full control: invite, remove members, change roles, delete project, read/write files |
| `editor` | Read/write files, create share links |
| `viewer` | Read-only access |

## Deployment

- **Host**: Fly.io (app: `peckmail`, region: `iad`)
- **Volume**: Persistent volume `peckmail_data` mounted at `/data`
- **Projects dir**: `/data/projects` (workspace files on persistent volume)
- **Docker**: Multi-stage build — `node:20-alpine` builder compiles TS + bundles client, production image runs `node dist/server/index.js`
- **Health check**: `GET /` every 30s
- **Auto-scaling**: min 1 machine, auto-stop/start enabled
