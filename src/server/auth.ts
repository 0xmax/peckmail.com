import type { Context, Next } from "hono";
import { createHash } from "crypto";
import { supabaseAdmin } from "./db.js";

export interface AuthUser {
  id: string;
  email: string;
}

// Hono middleware: extract and verify Supabase JWT
export async function authMiddleware(c: Context, next: Next) {
  // Check Authorization header, then cookie, then query param (for audio streaming)
  let token =
    c.req.header("Authorization")?.replace("Bearer ", "") ||
    getCookie(c, "sb-access-token") ||
    c.req.query("token");

  if (!token) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  try {
    // API key auth (pp_ prefix)
    if (token.startsWith("pp_")) {
      const keyHash = createHash("sha256").update(token).digest("hex");
      const { data: apiKey, error: keyErr } = await supabaseAdmin
        .from("api_keys")
        .select("id, user_id")
        .eq("key_hash", keyHash)
        .single();
      if (keyErr || !apiKey) {
        return c.json({ error: "Invalid API key" }, 401);
      }
      const { data: { user }, error: userErr } = await supabaseAdmin.auth.admin.getUserById(apiKey.user_id);
      if (userErr || !user) {
        return c.json({ error: "API key user not found" }, 401);
      }
      c.set("user", { id: user.id, email: user.email } as AuthUser);
      c.set("token", token);
      // Fire-and-forget: update last_used_at
      supabaseAdmin
        .from("api_keys")
        .update({ last_used_at: new Date().toISOString() })
        .eq("id", apiKey.id)
        .then(() => {});
      await next();
      return;
    }

    // Supabase JWT auth
    const {
      data: { user },
      error,
    } = await supabaseAdmin.auth.getUser(token);
    if (error || !user) {
      return c.json({ error: "Invalid token" }, 401);
    }
    c.set("user", { id: user.id, email: user.email } as AuthUser);
    c.set("token", token);
    await next();
  } catch {
    return c.json({ error: "Authentication failed" }, 401);
  }
}

function getCookie(c: Context, name: string): string | undefined {
  const cookie = c.req.header("Cookie");
  if (!cookie) return undefined;
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : undefined;
}

// Helper to extract user from context (use after authMiddleware)
export function getUser(c: Context): AuthUser {
  return c.get("user") as AuthUser;
}
