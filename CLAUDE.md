# Peckmail

A collaborative markdown writing app with AI assistance and text-to-speech.

## Stack

- **Server**: Node.js + Hono + @hono/node-server + @hono/node-ws
- **Client**: React 19 SPA bundled with esbuild, styled with Tailwind CSS v4
- **Editor**: CodeMirror 6 with markdown
- **Auth/DB**: Supabase (Auth + Postgres with RLS)
- **AI**: Anthropic SDK (Sonnet/Haiku models for chat and text workflows)
- **Icons**: Phosphor Icons (`@phosphor-icons/react`) — use `weight="duotone"` for decorative/empty-state icons, default weight for UI controls

## Commands

- `npm run dev` — runs server (tsx watch), esbuild (watch), tailwind (watch) concurrently
- `npm run build` — one-shot production build (esbuild + tailwind minify)
- `npx tsc --noEmit` — type-check server
- `npx tsc --noEmit -p tsconfig.client.json` — type-check client
- `fly deploy` — deploy to Fly.io (production)

## Key Files

- `src/server/index.ts` — Hono app, all API routes, WS upgrade, SPA fallback
- `src/server/ws.ts` — WebSocket manager, fs.watch, broadcasting
- `src/server/chat.ts` — AI chat with tool use (read/edit/create/list files)
- `src/client/App.tsx` — Root component, URL-based routing (login/projects/workspace)
- `src/client/components/Workspace.tsx` — Main workspace layout (header, sidebar, editor, panels)
- `src/client/store/` — Zustand-like store with dispatch actions
- `src/client/context/WsContext.tsx` — WebSocket with auto-reconnect + message routing

## Conventions

- Tailwind v4: uses `@import "tailwindcss"` and `@theme {}` block in CSS (NOT tailwind.config.ts)
- Supabase config is injected into the HTML at serve time via string replacement in the SPA fallback route
- No inline SVG icons — use Phosphor Icons components instead (only exception: Google brand logo in LoginPage)
- Workspace settings button lives at the bottom of the pages sidebar, not in the header
- Both `tsconfig.json` (server) and `tsconfig.client.json` (client) must pass `--noEmit` checks
