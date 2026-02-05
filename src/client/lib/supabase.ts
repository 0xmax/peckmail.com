import { createClient } from "@supabase/supabase-js";

const supabaseUrl = (window as any).__SUPABASE_URL__ || "";
const supabaseAnonKey = (window as any).__SUPABASE_ANON_KEY__ || "";

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
