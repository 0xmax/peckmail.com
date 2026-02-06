import { createClient } from "@supabase/supabase-js";
import { generateEmailAddress } from "./emailAddress.js";

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY!;

// Server-side client with service role key (bypasses RLS)
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

// Create a client scoped to a user's JWT (respects RLS)
export function supabaseForUser(jwt: string) {
  return createClient(supabaseUrl, process.env.SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
}

// Query helpers
export async function getProfile(userId: string) {
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .single();
  if (error) throw error;
  return data;
}

export async function getUserProjects(userId: string) {
  const { data, error } = await supabaseAdmin
    .from("project_members")
    .select("project_id, role, projects(id, name, email, description, created_at, deleted_at)")
    .eq("user_id", userId);
  if (error) throw error;
  const projects = (data ?? [])
    .filter((pm: any) => !pm.projects?.deleted_at)
    .map((pm: any) => ({
      ...pm.projects,
      role: pm.role,
    }));

  // Fetch members for all projects in one batch
  const projectIds = projects.map((p: any) => p.id);
  if (projectIds.length === 0) return projects;

  const { data: allMembers } = await supabaseAdmin
    .from("project_members")
    .select("project_id, user_id, role")
    .in("project_id", projectIds);

  const memberUserIds = [...new Set((allMembers ?? []).map((m) => m.user_id))];
  const { data: profiles } = memberUserIds.length
    ? await supabaseAdmin
        .from("profiles")
        .select("id, display_name, avatar_url")
        .in("id", memberUserIds)
    : { data: [] };

  const profileMap = new Map((profiles ?? []).map((p) => [p.id, p]));
  const membersByProject = new Map<string, any[]>();
  for (const m of allMembers ?? []) {
    const arr = membersByProject.get(m.project_id) ?? [];
    const profile = profileMap.get(m.user_id);
    arr.push({
      user_id: m.user_id,
      role: m.role,
      display_name: profile?.display_name ?? null,
      avatar_url: profile?.avatar_url ?? null,
    });
    membersByProject.set(m.project_id, arr);
  }

  return projects.map((p: any) => ({
    ...p,
    members: membersByProject.get(p.id) ?? [],
  }));
}

export async function getUserHandle(userId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("profiles")
    .select("handle")
    .eq("id", userId)
    .single();
  return data?.handle ?? null;
}

export async function getProjectMembership(
  projectId: string,
  userId: string
): Promise<{ role: string } | null> {
  const { data, error } = await supabaseAdmin
    .from("project_members")
    .select("role, projects(deleted_at)")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .single();
  if (error) return null;
  if ((data as any).projects?.deleted_at) return null;
  return { role: data.role };
}

export async function createProject(name: string, ownerId: string) {
  const { data: project, error: projErr } = await supabaseAdmin
    .from("projects")
    .insert({ name })
    .select()
    .single();
  if (projErr) throw projErr;

  const { error: memErr } = await supabaseAdmin
    .from("project_members")
    .insert({ project_id: project.id, user_id: ownerId, role: "owner" });
  if (memErr) throw memErr;

  // Assign a unique email address (fire-and-forget on error)
  assignProjectEmail(project.id).catch((err) =>
    console.error("[db] Failed to assign project email:", err)
  );

  return project;
}

export async function createInvitation(
  projectId: string,
  email: string,
  invitedBy: string,
  role: "owner" | "editor" | "viewer" = "editor"
) {
  const { data, error } = await supabaseAdmin
    .from("invitations")
    .insert({ project_id: projectId, email, invited_by: invitedBy, role })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function acceptInvitation(invitationId: string, userId: string) {
  const { data: inv, error: invErr } = await supabaseAdmin
    .from("invitations")
    .select("*")
    .eq("id", invitationId)
    .single();
  if (invErr) throw invErr;

  const { error: memErr } = await supabaseAdmin
    .from("project_members")
    .insert({
      project_id: inv.project_id,
      user_id: userId,
      role: inv.role || "editor",
    });
  if (memErr) throw memErr;

  await supabaseAdmin
    .from("invitations")
    .update({ status: "accepted" })
    .eq("id", invitationId);

  return inv;
}

export async function renameProject(projectId: string, name: string) {
  const { error } = await supabaseAdmin
    .from("projects")
    .update({ name })
    .eq("id", projectId);
  if (error) throw error;
}

export async function deleteProject(projectId: string) {
  const { error } = await supabaseAdmin
    .from("projects")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", projectId);
  if (error) throw error;
}

export async function getProjectMembers(projectId: string) {
  const { data: members, error } = await supabaseAdmin
    .from("project_members")
    .select("user_id, role")
    .eq("project_id", projectId);
  if (error) throw error;

  // Fetch profiles separately since there's no direct FK
  const userIds = (members ?? []).map((m) => m.user_id);
  const { data: profiles } = userIds.length
    ? await supabaseAdmin
        .from("profiles")
        .select("id, display_name, avatar_url")
        .in("id", userIds)
    : { data: [] };

  const profileMap = new Map((profiles ?? []).map((p) => [p.id, p]));
  return (members ?? []).map((m) => ({
    user_id: m.user_id,
    role: m.role,
    profiles: profileMap.get(m.user_id) ?? null,
  }));
}

export async function createShareLink(
  projectId: string,
  filePath: string,
  userId: string
) {
  const { data, error } = await supabaseAdmin
    .from("share_links")
    .insert({
      project_id: projectId,
      file_path: filePath,
      created_by: userId,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getShareLink(token: string) {
  const { data, error } = await supabaseAdmin
    .from("share_links")
    .select("*")
    .eq("token", token)
    .single();
  if (error) return null;
  return data;
}

// --- Inbound Email Helpers ---

export async function assignProjectEmail(projectId: string): Promise<string> {
  const MAX_ATTEMPTS = 5;
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const email = generateEmailAddress();
    const { error } = await supabaseAdmin
      .from("projects")
      .update({ email })
      .eq("id", projectId);
    if (!error) return email;
    // Unique constraint collision — retry
    if (!error.message?.includes("unique") && !error.code?.includes("23505")) {
      throw error;
    }
  }
  throw new Error("Failed to assign unique email after max attempts");
}

export async function getProjectByEmail(
  email: string
): Promise<{ id: string; name: string } | null> {
  const { data, error } = await supabaseAdmin
    .from("projects")
    .select("id, name")
    .eq("email", email)
    .is("deleted_at", null)
    .single();
  if (error) return null;
  return data;
}

export async function insertIncomingEmail(record: {
  project_id: string;
  resend_email_id: string;
  from_address: string;
  to_address: string;
  subject?: string;
  body_text?: string;
  body_html?: string;
  headers?: Record<string, any>;
  attachments?: any[];
}): Promise<{ id: string } | null> {
  const { data, error } = await supabaseAdmin
    .from("incoming_emails")
    .insert({ ...record, status: "received" })
    .select("id")
    .single();
  if (error) {
    // Duplicate resend_email_id — idempotency
    if (error.code === "23505") return null;
    throw error;
  }
  return data;
}

export async function updateEmailStatus(
  emailId: string,
  status: "received" | "processing" | "processed" | "failed",
  sessionId?: string | null,
  error?: string
): Promise<void> {
  const update: Record<string, any> = { status };
  if (sessionId !== undefined) update.agent_session_id = sessionId;
  if (error !== undefined) update.error = error;
  await supabaseAdmin
    .from("incoming_emails")
    .update(update)
    .eq("id", emailId);
}

export async function getProjectMemberEmails(
  projectId: string
): Promise<string[]> {
  const { data: members, error } = await supabaseAdmin
    .from("project_members")
    .select("user_id")
    .eq("project_id", projectId);
  if (error || !members?.length) return [];

  const emails: string[] = [];
  for (const m of members) {
    try {
      const { data: { user } } = await supabaseAdmin.auth.admin.getUserById(m.user_id);
      if (user?.email) emails.push(user.email.toLowerCase());
    } catch {
      // Skip users we can't look up
    }
  }
  return emails;
}

export async function updateProjectDescription(
  projectId: string,
  description: string
): Promise<void> {
  await supabaseAdmin
    .from("projects")
    .update({ description })
    .eq("id", projectId);
}

export async function getProjectEmail(
  projectId: string
): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from("projects")
    .select("email")
    .eq("id", projectId)
    .single();
  if (error) return null;
  return data?.email ?? null;
}
