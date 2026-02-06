import { supabaseAdmin } from "./db.js";

// --- Cost calculators ---

/** 1 credit per 3 characters, rounded up */
export function calculateTtsCost(charCount: number): number {
  return Math.ceil(charCount / 3);
}

/** Claude token costs with ~15% margin */
export function calculateChatCost(usage: {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number;
}): number {
  const inputCredits = Math.ceil(usage.input_tokens / 60);
  const outputCredits = Math.ceil(usage.output_tokens / 12);
  const cacheCredits = Math.ceil((usage.cache_read_input_tokens ?? 0) / 600);
  return inputCredits + outputCredits + cacheCredits;
}

/** 6 credits per minute of audio, rounded up */
export function calculateWhisperCost(durationSeconds: number): number {
  return Math.ceil((durationSeconds / 60) * 6);
}

// --- Balance queries ---

export async function getAvailableBalance(
  userId: string
): Promise<{ balance: number; held: number; available: number }> {
  const { data: balRow } = await supabaseAdmin
    .from("credit_balances")
    .select("balance")
    .eq("user_id", userId)
    .single();

  const balance = balRow?.balance ?? 0;

  const { data: holdRows } = await supabaseAdmin
    .from("credit_holds")
    .select("amount")
    .eq("user_id", userId)
    .eq("status", "held");

  const held = (holdRows ?? []).reduce((sum, h) => sum + (h.amount as number), 0);

  return { balance, held, available: balance - held };
}

// --- Credit operations (call Postgres RPCs) ---

export async function deductCredits(opts: {
  userId: string;
  amount: number;
  service: string;
  projectId?: string;
  metadata?: Record<string, any>;
}): Promise<{ success: boolean; balanceAfter: number }> {
  const { data, error } = await supabaseAdmin.rpc("deduct_credits", {
    p_user_id: opts.userId,
    p_amount: opts.amount,
    p_service: opts.service,
    p_project_id: opts.projectId ?? null,
    p_metadata: opts.metadata ?? {},
  });

  if (error) {
    console.error("[credits] deduct_credits error:", error);
    return { success: false, balanceAfter: 0 };
  }

  const row = Array.isArray(data) ? data[0] : data;
  return {
    success: row?.success ?? false,
    balanceAfter: row?.balance_after ?? 0,
  };
}

export async function placeHold(opts: {
  userId: string;
  amount: number;
  service: string;
  projectId?: string;
  metadata?: Record<string, any>;
}): Promise<{ success: boolean; holdId: string | null }> {
  const { data, error } = await supabaseAdmin.rpc("place_hold", {
    p_user_id: opts.userId,
    p_amount: opts.amount,
    p_service: opts.service,
    p_project_id: opts.projectId ?? null,
    p_metadata: opts.metadata ?? {},
  });

  if (error) {
    console.error("[credits] place_hold error:", error);
    return { success: false, holdId: null };
  }

  const row = Array.isArray(data) ? data[0] : data;
  return {
    success: row?.success ?? false,
    holdId: row?.hold_id ?? null,
  };
}

export async function settleHold(
  holdId: string,
  actualAmount: number,
  metadata?: Record<string, any>
): Promise<void> {
  const { error } = await supabaseAdmin.rpc("settle_hold", {
    p_hold_id: holdId,
    p_actual_amount: actualAmount,
    p_metadata: metadata ?? {},
  });

  if (error) {
    console.error("[credits] settle_hold error:", error);
  }
}

export async function releaseHold(holdId: string): Promise<void> {
  const { error } = await supabaseAdmin.rpc("release_hold", {
    p_hold_id: holdId,
  });

  if (error) {
    console.error("[credits] release_hold error:", error);
  }
}

export async function addCredits(opts: {
  userId: string;
  amount: number;
  type: "purchase" | "grant" | "refund";
  idempotencyKey?: string;
  metadata?: Record<string, any>;
}): Promise<{ success: boolean; balanceAfter: number }> {
  const { data, error } = await supabaseAdmin.rpc("add_credits", {
    p_user_id: opts.userId,
    p_amount: opts.amount,
    p_type: opts.type,
    p_idempotency_key: opts.idempotencyKey ?? null,
    p_metadata: opts.metadata ?? {},
  });

  if (error) {
    console.error("[credits] add_credits error:", error);
    return { success: false, balanceAfter: 0 };
  }

  const row = Array.isArray(data) ? data[0] : data;
  return {
    success: row?.success ?? false,
    balanceAfter: row?.balance_after ?? 0,
  };
}

export async function releaseStaleHolds(): Promise<number> {
  const { data, error } = await supabaseAdmin.rpc("release_stale_holds", {
    p_max_age_minutes: 10,
  });

  if (error) {
    console.error("[credits] release_stale_holds error:", error);
    return 0;
  }

  return typeof data === "number" ? data : 0;
}

export async function getTransactions(
  userId: string,
  limit = 50,
  offset = 0
): Promise<any[]> {
  const { data, error } = await supabaseAdmin
    .from("credit_transactions")
    .select("id, amount, balance_after, type, service, project_id, metadata, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    console.error("[credits] getTransactions error:", error);
    return [];
  }

  return data ?? [];
}

/** Look up the owner's user_id for a project */
export async function getProjectOwner(projectId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("project_members")
    .select("user_id")
    .eq("project_id", projectId)
    .eq("role", "owner")
    .limit(1)
    .single();

  return data?.user_id ?? null;
}
