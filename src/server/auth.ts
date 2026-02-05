import type { Context, Next } from "hono";
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
