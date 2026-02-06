import { createClient } from "@supabase/supabase-js";

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
    .select("project_id, role, projects(id, name, created_at, deleted_at)")
    .eq("user_id", userId);
  if (error) throw error;
  return (data ?? [])
    .filter((pm: any) => !pm.projects?.deleted_at)
    .map((pm: any) => ({
      ...pm.projects,
      role: pm.role,
    }));
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
  const { data, error } = await supabaseAdmin
    .from("project_members")
    .select("user_id, role, profiles(display_name, avatar_url)")
    .eq("project_id", projectId);
  if (error) throw error;
  return data;
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
