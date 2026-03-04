import { createClient } from "@supabase/supabase-js";
import { generateEmailAddress } from "./emailAddress.js";

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY!;
const PROJECT_EMAIL_TYPES = ["peckmail", "imap"] as const;
const PROJECT_EMAIL_TYPE_SET = new Set<string>(PROJECT_EMAIL_TYPES);
const INCOMING_EMAIL_STATUSES = ["received", "processing", "processed", "failed"] as const;
const INCOMING_EMAIL_STATUS_SET = new Set<string>(INCOMING_EMAIL_STATUSES);
const EMAIL_TAG_COLOR_REGEX = /^#[0-9a-f]{6}$/i;

export type ProjectEmailType = (typeof PROJECT_EMAIL_TYPES)[number];
export type IncomingEmailStatus = (typeof INCOMING_EMAIL_STATUSES)[number];

export interface IncomingEmailSearchResult {
  id: string;
  from_address: string;
  from_domain: string | null;
  to_address: string;
  subject: string | null;
  status: IncomingEmailStatus;
  error: string | null;
  created_at: string;
  snippet: string;
}

export interface ProjectIncomingEmail {
  id: string;
  project_id: string;
  resend_email_id: string;
  from_address: string;
  from_domain: string | null;
  to_address: string;
  subject: string | null;
  status: IncomingEmailStatus;
  error: string | null;
  created_at: string;
  read_at: string | null;
  summary: string | null;
  body_text: string | null;
  body_html: string | null;
  raw_email: string | null;
  headers: Record<string, any> | null;
  attachments: any[] | null;
  agent_session_id: string | null;
}

export interface ProjectEmailTag {
  id: string;
  project_id: string;
  name: string;
  color: string;
  enabled: boolean;
  condition: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export type ResolverStatus = "pending" | "resolving" | "resolved" | "failed" | "skipped";

export interface ProjectEmailDomain {
  id: string;
  project_id: string;
  domain: string;
  enabled: boolean;
  sender_id: string | null;
  resolver_status: ResolverStatus;
  resolver_error: string | null;
  created_at: string;
  updated_at: string;
  last_seen_at: string;
}

export interface ProjectSender {
  id: string;
  project_id: string;
  name: string;
  website: string | null;
  description: string | null;
  logo_url: string | null;
  country: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  domain_count?: number;
  email_count?: number;
}

export interface IncomingEmailTagSummary {
  id: string;
  name: string;
  color: string;
}

export interface ProjectIncomingEmailSummary {
  id: string;
  from_address: string;
  from_domain: string | null;
  subject: string | null;
  status: IncomingEmailStatus;
  error: string | null;
  created_at: string;
  read_at: string | null;
  summary: string | null;
  tags: IncomingEmailTagSummary[];
}

export interface InboundEmailRetryCandidate {
  id: string;
  project_id: string;
  project_name: string;
  resend_email_id: string;
  from_address: string;
  from_domain: string | null;
  to_address: string;
  subject: string;
  body_text: string;
  body_html: string;
  raw_email: string;
  summary: string | null;
  created_at: string;
  headers: Record<string, any>;
}

function normalizeEmailAddress(email: string): string {
  return email.trim().toLowerCase();
}

function normalizeEmailDomain(domain: string): string {
  return domain.trim().toLowerCase();
}

function normalizeEmailTagName(name: string): string {
  return name.trim();
}

function normalizeEmailTagCondition(condition: string): string {
  return condition.trim();
}

function normalizeEmailTagColor(color: string): string {
  const normalized = color.trim().toLowerCase();
  if (!EMAIL_TAG_COLOR_REGEX.test(normalized)) {
    throw new Error("Tag color must be a hex code like #c4956a");
  }
  return normalized;
}

function normalizeSearchTerm(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.toLowerCase() : null;
}

function toIncomingEmailStatus(value: string): IncomingEmailStatus {
  if (INCOMING_EMAIL_STATUS_SET.has(value)) {
    return value as IncomingEmailStatus;
  }
  return "received";
}

function extractSnippet(bodyText: string | null, bodyHtml: string | null): string {
  const source = (bodyText?.trim().length ? bodyText : bodyHtml ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!source) return "";
  return source.length > 220 ? `${source.slice(0, 220)}...` : source;
}

function isUniqueViolation(error: any): boolean {
  return error?.code === "23505"
    || error?.message?.toLowerCase?.().includes("unique")
    || error?.message?.toLowerCase?.().includes("duplicate");
}

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

  // Fetch emails from auth
  const emailMap = new Map<string, string>();
  await Promise.all(
    userIds.map(async (uid) => {
      try {
        const { data: { user } } = await supabaseAdmin.auth.admin.getUserById(uid);
        if (user?.email) emailMap.set(uid, user.email);
      } catch {}
    })
  );

  const profileMap = new Map((profiles ?? []).map((p) => [p.id, p]));
  return (members ?? []).map((m) => ({
    user_id: m.user_id,
    role: m.role,
    email: emailMap.get(m.user_id) ?? null,
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
  const existing = await getProjectEmailByType(projectId, "peckmail");
  if (existing) {
    await syncLegacyProjectEmail(projectId, existing);
    return existing;
  }

  const legacy = await getLegacyProjectEmail(projectId);
  if (legacy) {
    const normalized = normalizeEmailAddress(legacy);
    const { error } = await supabaseAdmin
      .from("project_emails")
      .insert({ project_id: projectId, email: normalized, type: "peckmail" });
    if (!error) {
      await syncLegacyProjectEmail(projectId, normalized);
      return normalized;
    }
    if (!isUniqueViolation(error)) throw error;

    // If the legacy email is already linked to this project, we can reuse it.
    const { data: existing, error: existingErr } = await supabaseAdmin
      .from("project_emails")
      .select("project_id")
      .eq("email", normalized)
      .maybeSingle();
    if (existingErr) throw existingErr;
    if (existing?.project_id === projectId) {
      await syncLegacyProjectEmail(projectId, normalized);
      return normalized;
    }
    // Else: collision with another project (case-insensitive). Fall through and generate a fresh one.
  }

  const MAX_ATTEMPTS = 5;
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const email = normalizeEmailAddress(generateEmailAddress());
    const { error } = await supabaseAdmin
      .from("project_emails")
      .insert({ project_id: projectId, email, type: "peckmail" });
    if (!error) {
      await syncLegacyProjectEmail(projectId, email);
      return email;
    }
    // Unique constraint collision — retry
    if (!isUniqueViolation(error)) {
      throw error;
    }
  }
  throw new Error("Failed to assign unique email after max attempts");
}

export async function getProjectByEmail(
  email: string
): Promise<{ id: string; name: string } | null> {
  const normalized = normalizeEmailAddress(email);
  const { data: linkedEmail, error: linkedErr } = await supabaseAdmin
    .from("project_emails")
    .select("project_id")
    .eq("email", normalized)
    .maybeSingle();
  if (linkedErr) throw linkedErr;

  if (linkedEmail?.project_id) {
    const { data: project, error: projErr } = await supabaseAdmin
      .from("projects")
      .select("id, name")
      .eq("id", linkedEmail.project_id)
      .is("deleted_at", null)
      .maybeSingle();
    if (projErr) throw projErr;
    if (project) return project;
  }

  // Legacy fallback (for rows not migrated yet).
  const { data, error } = await supabaseAdmin
    .from("projects")
    .select("id, name")
    .eq("email", normalized)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function listProjectEmails(projectId: string): Promise<Array<{
  id: string;
  email: string;
  type: ProjectEmailType;
  created_at: string;
}>> {
  const { data, error } = await supabaseAdmin
    .from("project_emails")
    .select("id, email, type, created_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as Array<{
    id: string;
    email: string;
    type: ProjectEmailType;
    created_at: string;
  }>;
}

export async function addProjectEmail(params: {
  projectId: string;
  email: string;
  type: ProjectEmailType;
}): Promise<{
  id: string;
  email: string;
  type: ProjectEmailType;
  created_at: string;
}> {
  const { projectId, email, type } = params;
  if (!PROJECT_EMAIL_TYPE_SET.has(type)) {
    throw new Error(`Invalid project email type: ${type}`);
  }

  const normalized = normalizeEmailAddress(email);
  const { data, error } = await supabaseAdmin
    .from("project_emails")
    .insert({
      project_id: projectId,
      email: normalized,
      type,
    })
    .select("id, email, type, created_at")
    .single();

  if (error) {
    if (isUniqueViolation(error)) {
      throw new Error("Email address is already attached to a workspace");
    }
    throw error;
  }

  if (type === "peckmail") {
    await syncLegacyProjectEmail(projectId, normalized);
  }

  return data as {
    id: string;
    email: string;
    type: ProjectEmailType;
    created_at: string;
  };
}

export async function insertIncomingEmail(record: {
  project_id: string;
  resend_email_id: string;
  from_address: string;
  from_domain?: string;
  to_address: string;
  subject?: string;
  body_text?: string;
  body_html?: string;
  raw_email?: string;
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

export async function updateIncomingEmailContent(
  emailId: string,
  updates: {
    body_text?: string;
    body_html?: string;
    raw_email?: string;
    summary?: string | null;
  }
): Promise<void> {
  const update: Record<string, any> = {};
  if (updates.body_text !== undefined) update.body_text = updates.body_text;
  if (updates.body_html !== undefined) update.body_html = updates.body_html;
  if (updates.raw_email !== undefined) update.raw_email = updates.raw_email;
  if (updates.summary !== undefined) update.summary = updates.summary;
  if (!Object.keys(update).length) return;

  await supabaseAdmin
    .from("incoming_emails")
    .update(update)
    .eq("id", emailId);
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

export async function setIncomingEmailReadAt(
  projectId: string,
  emailId: string,
  readAt: string | null
): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("incoming_emails")
    .update({ read_at: readAt })
    .eq("project_id", projectId)
    .eq("id", emailId)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  return Boolean(data?.id);
}

export async function softDeleteIncomingEmail(
  projectId: string,
  emailId: string
): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("incoming_emails")
    .update({ deleted_at: new Date().toISOString() })
    .eq("project_id", projectId)
    .eq("id", emailId)
    .is("deleted_at", null)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  return Boolean(data?.id);
}

export async function searchProjectIncomingEmails(params: {
  projectId: string;
  query?: string;
  from?: string;
  to?: string;
  subject?: string;
  status?: IncomingEmailStatus;
  limit?: number;
}): Promise<IncomingEmailSearchResult[]> {
  const limit = Math.min(Math.max(Math.floor(params.limit ?? 10), 1), 50);
  const fetchLimit = Math.min(Math.max(limit * 4, 40), 200);
  const from = normalizeSearchTerm(params.from);
  const to = normalizeSearchTerm(params.to);
  const subject = normalizeSearchTerm(params.subject);
  const query = normalizeSearchTerm(params.query);

  let queryBuilder = supabaseAdmin
    .from("incoming_emails")
    .select(
      "id, from_address, from_domain, to_address, subject, status, error, created_at, body_text, body_html"
    )
    .eq("project_id", params.projectId)
    .order("created_at", { ascending: false })
    .limit(fetchLimit);

  if (from) {
    queryBuilder = queryBuilder.ilike("from_address", `%${from}%`);
  }
  if (to) {
    queryBuilder = queryBuilder.ilike("to_address", `%${to}%`);
  }
  if (subject) {
    queryBuilder = queryBuilder.ilike("subject", `%${subject}%`);
  }
  if (params.status) {
    queryBuilder = queryBuilder.eq("status", params.status);
  }

  const { data, error } = await queryBuilder;
  if (error) throw error;

  type IncomingEmailSearchRow = {
    id: string;
    from_address: string;
    from_domain: string | null;
    to_address: string;
    subject: string | null;
    status: string;
    error: string | null;
    created_at: string;
    body_text: string | null;
    body_html: string | null;
  };

  const rows = (data ?? []) as IncomingEmailSearchRow[];
  const filtered = rows.filter((row) => {
    if (!query) return true;
    const haystack = [
      row.from_address,
      row.from_domain ?? "",
      row.to_address,
      row.subject ?? "",
      row.body_text ?? "",
      row.body_html ?? "",
    ]
      .join("\n")
      .toLowerCase();
    return haystack.includes(query);
  });

  return filtered.slice(0, limit).map((row) => ({
    id: row.id,
    from_address: row.from_address,
    from_domain: row.from_domain,
    to_address: row.to_address,
    subject: row.subject,
    status: toIncomingEmailStatus(row.status),
    error: row.error,
    created_at: row.created_at,
    snippet: extractSnippet(row.body_text, row.body_html),
  }));
}

export async function getProjectIncomingEmail(
  projectId: string,
  emailId: string
): Promise<ProjectIncomingEmail | null> {
  const { data, error } = await supabaseAdmin
    .from("incoming_emails")
    .select(
      "id, project_id, resend_email_id, from_address, from_domain, to_address, subject, status, error, created_at, read_at, summary, body_text, body_html, raw_email, headers, attachments, agent_session_id"
    )
    .eq("project_id", projectId)
    .eq("id", emailId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const row = data as Omit<ProjectIncomingEmail, "status"> & { status: string };
  return {
    ...row,
    status: toIncomingEmailStatus(row.status),
  };
}

async function listIncomingEmailTagMap(
  emailIds: string[]
): Promise<Map<string, IncomingEmailTagSummary[]>> {
  const map = new Map<string, IncomingEmailTagSummary[]>();
  if (!emailIds.length) return map;

  const { data: assignmentRows, error: assignmentErr } = await supabaseAdmin
    .from("incoming_email_tags")
    .select("email_id, tag_id")
    .in("email_id", emailIds)
    .is("deleted_at", null);
  if (assignmentErr) throw assignmentErr;

  type AssignmentRow = { email_id: string; tag_id: string };
  const assignments = (assignmentRows ?? []) as AssignmentRow[];
  const tagIds = [...new Set(assignments.map((a) => a.tag_id))];
  if (!tagIds.length) return map;

  const { data: tagRows, error: tagErr } = await supabaseAdmin
    .from("email_tags")
    .select("id, name, color")
    .in("id", tagIds)
    .is("deleted_at", null);
  if (tagErr) throw tagErr;

  type TagRow = { id: string; name: string; color: string };
  const tagMap = new Map(
    ((tagRows ?? []) as TagRow[]).map((row) => [
      row.id,
      { id: row.id, name: row.name, color: row.color } satisfies IncomingEmailTagSummary,
    ])
  );

  for (const assignment of assignments) {
    const tag = tagMap.get(assignment.tag_id);
    if (!tag) continue;
    const arr = map.get(assignment.email_id) ?? [];
    arr.push(tag);
    map.set(assignment.email_id, arr);
  }

  for (const tags of map.values()) {
    tags.sort((a, b) => a.name.localeCompare(b.name));
  }
  return map;
}

export interface PaginatedEmailResult {
  emails: ProjectIncomingEmailSummary[];
  hasMore: boolean;
}

export async function listProjectIncomingEmailSummaries(
  projectId: string,
  limit = 50,
  beforeId?: string
): Promise<PaginatedEmailResult> {
  const clamped = Math.min(Math.max(Math.floor(limit), 1), 100);

  let query = supabaseAdmin
    .from("incoming_emails")
    .select("id, from_address, from_domain, subject, status, error, created_at, read_at, summary")
    .eq("project_id", projectId)
    .is("deleted_at", null);

  if (beforeId) {
    // Look up the cursor row's created_at
    const { data: cursorRow } = await supabaseAdmin
      .from("incoming_emails")
      .select("created_at")
      .eq("id", beforeId)
      .single();
    if (cursorRow) {
      const ts = cursorRow.created_at;
      query = query.or(`created_at.lt.${ts},and(created_at.eq.${ts},id.lt.${beforeId})`);
    }
  }

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(clamped + 1);
  if (error) throw error;

  type Row = {
    id: string;
    from_address: string;
    from_domain: string | null;
    subject: string | null;
    status: string;
    error: string | null;
    created_at: string;
    read_at: string | null;
    summary: string | null;
  };
  const allRows = (data ?? []) as Row[];
  const hasMore = allRows.length > clamped;
  const rows = hasMore ? allRows.slice(0, clamped) : allRows;
  const tagMap = await listIncomingEmailTagMap(rows.map((r) => r.id));

  return {
    emails: rows.map((row) => ({
      id: row.id,
      from_address: row.from_address,
      from_domain: row.from_domain,
      subject: row.subject,
      status: toIncomingEmailStatus(row.status),
      error: row.error,
      created_at: row.created_at,
      read_at: row.read_at,
      summary: row.summary,
      tags: tagMap.get(row.id) ?? [],
    })),
    hasMore,
  };
}

export async function listSenderEmails(
  projectId: string,
  senderId: string,
  limit = 50,
  beforeId?: string
): Promise<PaginatedEmailResult> {
  // Get domains linked to this sender
  const { data: domainRows } = await supabaseAdmin
    .from("email_domains")
    .select("domain")
    .eq("sender_id", senderId);
  const domainNames = (domainRows ?? []).map((d) => d.domain);
  if (!domainNames.length) return { emails: [], hasMore: false };

  const clamped = Math.min(Math.max(Math.floor(limit), 1), 100);

  let query = supabaseAdmin
    .from("incoming_emails")
    .select("id, from_address, from_domain, subject, status, error, created_at, read_at, summary")
    .eq("project_id", projectId)
    .in("from_domain", domainNames)
    .is("deleted_at", null);

  if (beforeId) {
    const { data: cursorRow } = await supabaseAdmin
      .from("incoming_emails")
      .select("created_at")
      .eq("id", beforeId)
      .single();
    if (cursorRow) {
      const ts = cursorRow.created_at;
      query = query.or(`created_at.lt.${ts},and(created_at.eq.${ts},id.lt.${beforeId})`);
    }
  }

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(clamped + 1);
  if (error) throw error;

  type Row = {
    id: string;
    from_address: string;
    from_domain: string | null;
    subject: string | null;
    status: string;
    error: string | null;
    created_at: string;
    read_at: string | null;
    summary: string | null;
  };
  const allRows = (data ?? []) as Row[];
  const hasMore = allRows.length > clamped;
  const rows = hasMore ? allRows.slice(0, clamped) : allRows;
  const tagMap = await listIncomingEmailTagMap(rows.map((r) => r.id));

  return {
    emails: rows.map((row) => ({
      id: row.id,
      from_address: row.from_address,
      from_domain: row.from_domain,
      subject: row.subject,
      status: toIncomingEmailStatus(row.status),
      error: row.error,
      created_at: row.created_at,
      read_at: row.read_at,
      summary: row.summary,
      tags: tagMap.get(row.id) ?? [],
    })),
    hasMore,
  };
}

export async function getIncomingEmailTags(
  emailId: string
): Promise<IncomingEmailTagSummary[]> {
  const map = await listIncomingEmailTagMap([emailId]);
  return map.get(emailId) ?? [];
}

export async function getProjectIncomingEmailWithTags(
  projectId: string,
  emailId: string
): Promise<(ProjectIncomingEmail & { tags: IncomingEmailTagSummary[] }) | null> {
  const email = await getProjectIncomingEmail(projectId, emailId);
  if (!email) return null;
  const tags = await getIncomingEmailTags(email.id);
  return { ...email, tags };
}

export async function listInsufficientCreditRetryEmails(
  limit = 20
): Promise<InboundEmailRetryCandidate[]> {
  const clamped = Math.min(Math.max(Math.floor(limit), 1), 100);
  const { data, error } = await supabaseAdmin
    .from("incoming_emails")
    .select(
      "id, project_id, resend_email_id, from_address, from_domain, to_address, subject, body_text, body_html, raw_email, summary, created_at, headers, projects(name)"
    )
    .eq("status", "failed")
    .ilike("error", "Insufficient credits%")
    .is("deleted_at", null)
    .order("created_at", { ascending: true })
    .limit(clamped);
  if (error) throw error;

  type Row = {
    id: string;
    project_id: string;
    resend_email_id: string;
    from_address: string;
    from_domain: string | null;
    to_address: string;
    subject: string | null;
    body_text: string | null;
    body_html: string | null;
    raw_email: string | null;
    summary: string | null;
    created_at: string;
    headers: Record<string, any> | null;
    projects?: { name?: string | null } | null;
  };

  const rows = (data ?? []) as Row[];
  return rows.map((row) => ({
    id: row.id,
    project_id: row.project_id,
    project_name: row.projects?.name?.trim() || "Workspace",
    resend_email_id: row.resend_email_id,
    from_address: row.from_address,
    from_domain: row.from_domain,
    to_address: row.to_address,
    subject: row.subject ?? "(no subject)",
    body_text: row.body_text ?? "",
    body_html: row.body_html ?? "",
    raw_email: row.raw_email ?? "",
    summary: row.summary ?? null,
    created_at: row.created_at,
    headers: row.headers ?? {},
  }));
}

export async function listProjectEmailDomains(
  projectId: string
): Promise<ProjectEmailDomain[]> {
  const { data, error } = await supabaseAdmin
    .from("email_domains")
    .select("id, project_id, domain, enabled, sender_id, resolver_status, resolver_error, created_at, updated_at, last_seen_at")
    .eq("project_id", projectId)
    .order("domain", { ascending: true });
  if (error) throw error;
  return (data ?? []) as ProjectEmailDomain[];
}

export async function upsertProjectEmailDomain(
  projectId: string,
  domain: string
): Promise<ProjectEmailDomain> {
  const normalized = normalizeEmailDomain(domain);
  if (!normalized || !normalized.includes(".")) {
    throw new Error("Invalid domain");
  }

  const nowIso = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from("email_domains")
    .upsert(
      {
        project_id: projectId,
        domain: normalized,
        last_seen_at: nowIso,
        updated_at: nowIso,
      },
      { onConflict: "project_id,domain" }
    )
    .select("id, project_id, domain, enabled, sender_id, resolver_status, resolver_error, created_at, updated_at, last_seen_at")
    .single();
  if (error) throw error;
  return data as ProjectEmailDomain;
}

export async function updateProjectEmailDomain(params: {
  projectId: string;
  domainId: string;
  enabled?: boolean;
  sender_id?: string | null;
}): Promise<ProjectEmailDomain | null> {
  const update: Record<string, any> = {};
  if (params.enabled !== undefined) {
    update.enabled = Boolean(params.enabled);
  }
  if (params.sender_id !== undefined) {
    update.sender_id = params.sender_id;
  }
  if (!Object.keys(update).length) return null;

  const { data, error } = await supabaseAdmin
    .from("email_domains")
    .update(update)
    .eq("project_id", params.projectId)
    .eq("id", params.domainId)
    .select("id, project_id, domain, enabled, sender_id, resolver_status, resolver_error, created_at, updated_at, last_seen_at")
    .maybeSingle();
  if (error) throw error;
  return (data as ProjectEmailDomain | null) ?? null;
}

export async function listProjectEmailTags(
  projectId: string,
  opts?: { enabledOnly?: boolean; includeDeleted?: boolean }
): Promise<ProjectEmailTag[]> {
  let query = supabaseAdmin
    .from("email_tags")
    .select(
      "id, project_id, name, color, enabled, condition, created_at, updated_at, deleted_at"
    )
    .eq("project_id", projectId)
    .order("created_at", { ascending: true });

  if (!opts?.includeDeleted) {
    query = query.is("deleted_at", null);
  }
  if (opts?.enabledOnly) {
    query = query.eq("enabled", true);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as ProjectEmailTag[];
}

export async function createProjectEmailTag(params: {
  projectId: string;
  name: string;
  color: string;
  enabled?: boolean;
  condition: string;
}): Promise<ProjectEmailTag> {
  const name = normalizeEmailTagName(params.name);
  const condition = normalizeEmailTagCondition(params.condition);
  if (!name) throw new Error("Tag name is required");
  if (!condition) throw new Error("Tag condition is required");

  const color = normalizeEmailTagColor(params.color);
  const { data, error } = await supabaseAdmin
    .from("email_tags")
    .insert({
      project_id: params.projectId,
      name,
      color,
      enabled: params.enabled ?? true,
      condition,
    })
    .select(
      "id, project_id, name, color, enabled, condition, created_at, updated_at, deleted_at"
    )
    .single();

  if (error) {
    if (isUniqueViolation(error)) {
      throw new Error("A tag with this name already exists");
    }
    throw error;
  }
  return data as ProjectEmailTag;
}

export async function updateProjectEmailTag(params: {
  projectId: string;
  tagId: string;
  name?: string;
  color?: string;
  enabled?: boolean;
  condition?: string;
}): Promise<ProjectEmailTag | null> {
  const update: Record<string, any> = {};
  if (params.name !== undefined) {
    const value = normalizeEmailTagName(params.name);
    if (!value) throw new Error("Tag name is required");
    update.name = value;
  }
  if (params.color !== undefined) {
    update.color = normalizeEmailTagColor(params.color);
  }
  if (params.enabled !== undefined) {
    update.enabled = Boolean(params.enabled);
  }
  if (params.condition !== undefined) {
    const value = normalizeEmailTagCondition(params.condition);
    if (!value) throw new Error("Tag condition is required");
    update.condition = value;
  }
  if (!Object.keys(update).length) {
    return null;
  }

  const { data, error } = await supabaseAdmin
    .from("email_tags")
    .update(update)
    .eq("project_id", params.projectId)
    .eq("id", params.tagId)
    .is("deleted_at", null)
    .select(
      "id, project_id, name, color, enabled, condition, created_at, updated_at, deleted_at"
    )
    .maybeSingle();
  if (error) {
    if (isUniqueViolation(error)) {
      throw new Error("A tag with this name already exists");
    }
    throw error;
  }
  return (data as ProjectEmailTag | null) ?? null;
}

export async function softDeleteProjectEmailTag(
  projectId: string,
  tagId: string
): Promise<boolean> {
  const nowIso = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from("email_tags")
    .update({ deleted_at: nowIso, enabled: false })
    .eq("project_id", projectId)
    .eq("id", tagId)
    .is("deleted_at", null)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!data) return false;

  await supabaseAdmin
    .from("incoming_email_tags")
    .update({ deleted_at: nowIso })
    .eq("tag_id", tagId)
    .is("deleted_at", null);

  return true;
}

export async function setIncomingEmailTags(
  projectId: string,
  emailId: string,
  tagIds: string[]
): Promise<IncomingEmailTagSummary[]> {
  const uniqueRequested = [...new Set(tagIds)];
  const nowIso = new Date().toISOString();

  let activeTagIds: string[] = [];
  if (uniqueRequested.length > 0) {
    const { data: validTags, error: validErr } = await supabaseAdmin
      .from("email_tags")
      .select("id")
      .eq("project_id", projectId)
      .is("deleted_at", null)
      .in("id", uniqueRequested);
    if (validErr) throw validErr;
    activeTagIds = (validTags ?? []).map((row: any) => row.id);
  }

  const { data: currentRows, error: currentErr } = await supabaseAdmin
    .from("incoming_email_tags")
    .select("tag_id")
    .eq("email_id", emailId)
    .is("deleted_at", null);
  if (currentErr) throw currentErr;

  const currentIds = new Set((currentRows ?? []).map((row: any) => row.tag_id));
  for (const currentId of currentIds) {
    if (activeTagIds.includes(currentId)) continue;
    await supabaseAdmin
      .from("incoming_email_tags")
      .update({ deleted_at: nowIso })
      .eq("email_id", emailId)
      .eq("tag_id", currentId)
      .is("deleted_at", null);
  }

  if (activeTagIds.length > 0) {
    const upsertRows = activeTagIds.map((tagId) => ({
      email_id: emailId,
      tag_id: tagId,
      deleted_at: null as string | null,
      updated_at: nowIso,
    }));
    const { error: upsertErr } = await supabaseAdmin
      .from("incoming_email_tags")
      .upsert(upsertRows, { onConflict: "email_id,tag_id" });
    if (upsertErr) throw upsertErr;
  }

  return getIncomingEmailTags(emailId);
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
  const linked = await getProjectEmailByType(projectId, "peckmail");
  if (linked) {
    await syncLegacyProjectEmail(projectId, linked);
    return linked;
  }

  // Legacy fallback (for rows not migrated yet).
  return getLegacyProjectEmail(projectId);
}

async function getLegacyProjectEmail(projectId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from("projects")
    .select("email")
    .eq("id", projectId)
    .single();
  if (error) return null;
  return data?.email ? normalizeEmailAddress(data.email) : null;
}

async function getProjectEmailByType(
  projectId: string,
  type: ProjectEmailType
): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from("project_emails")
    .select("email")
    .eq("project_id", projectId)
    .eq("type", type)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data?.email ?? null;
}

async function syncLegacyProjectEmail(projectId: string, email: string): Promise<void> {
  await supabaseAdmin
    .from("projects")
    .update({ email: normalizeEmailAddress(email) })
    .eq("id", projectId);
}

// --- Active Project Helpers ---

export async function getActiveProjectId(userId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("active_project_id")
    .eq("id", userId)
    .single();
  if (error) return null;

  const projectId = data?.active_project_id ?? null;
  if (!projectId) return null;

  // Guard against stale active project pointers (e.g., membership removed).
  const membership = await getProjectMembership(projectId, userId);
  if (membership) return projectId;

  await supabaseAdmin
    .from("profiles")
    .update({ active_project_id: null })
    .eq("id", userId);

  return null;
}

export async function setActiveProjectId(userId: string, projectId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from("profiles")
    .update({ active_project_id: projectId })
    .eq("id", userId);
  if (error) throw error;
}

// --- Email Sender Helpers ---

const SENDER_SELECT = "id, project_id, name, website, description, logo_url, country, created_at, updated_at, deleted_at";

export async function listProjectSenders(
  projectId: string
): Promise<ProjectSender[]> {
  const { data, error } = await supabaseAdmin
    .from("email_senders")
    .select(SENDER_SELECT)
    .eq("project_id", projectId)
    .is("deleted_at", null)
    .order("name", { ascending: true });
  if (error) throw error;

  const senders = (data ?? []) as ProjectSender[];
  if (!senders.length) return senders;

  const senderIds = senders.map((s) => s.id);

  // Domain counts per sender
  const { data: domainRows } = await supabaseAdmin
    .from("email_domains")
    .select("sender_id")
    .in("sender_id", senderIds);
  const domainCounts = new Map<string, number>();
  for (const row of domainRows ?? []) {
    domainCounts.set(row.sender_id, (domainCounts.get(row.sender_id) || 0) + 1);
  }

  // Email counts per sender (through domains)
  const { data: domains } = await supabaseAdmin
    .from("email_domains")
    .select("sender_id, domain")
    .in("sender_id", senderIds);
  const domainsBySender = new Map<string, string[]>();
  for (const d of domains ?? []) {
    const arr = domainsBySender.get(d.sender_id) ?? [];
    arr.push(d.domain);
    domainsBySender.set(d.sender_id, arr);
  }

  const allDomains = [...new Set((domains ?? []).map((d) => d.domain))];
  let emailCounts = new Map<string, number>();
  if (allDomains.length > 0) {
    const { data: emailRows } = await supabaseAdmin
      .from("incoming_emails")
      .select("from_domain")
      .eq("project_id", projectId)
      .in("from_domain", allDomains)
      .is("deleted_at", null);
    for (const row of emailRows ?? []) {
      emailCounts.set(row.from_domain, (emailCounts.get(row.from_domain) || 0) + 1);
    }
  }

  return senders.map((s) => {
    const senderDomains = domainsBySender.get(s.id) ?? [];
    const emailCount = senderDomains.reduce((sum, d) => sum + (emailCounts.get(d) || 0), 0);
    return {
      ...s,
      domain_count: domainCounts.get(s.id) || 0,
      email_count: emailCount,
    };
  });
}

export async function refreshSenderDailyStats(projectId?: string) {
  const { error } = await supabaseAdmin.rpc("refresh_sender_daily_stats", {
    p_project_id: projectId ?? null,
  });
  if (error) throw error;
}

export interface SenderDailyStatsRow {
  sender_id: string;
  date: string;
  email_count: number;
}

export async function getSenderDailyStats(
  projectId: string
): Promise<SenderDailyStatsRow[]> {
  // Get sender IDs for this project
  const { data: senders, error: sErr } = await supabaseAdmin
    .from("email_senders")
    .select("id")
    .eq("project_id", projectId)
    .is("deleted_at", null);
  if (sErr) throw sErr;
  const senderIds = (senders ?? []).map((s) => s.id);
  if (!senderIds.length) return [];

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 60);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const { data, error } = await supabaseAdmin
    .from("sender_daily_stats")
    .select("sender_id, date, email_count")
    .gte("date", cutoffStr)
    .in("sender_id", senderIds);

  if (error) throw error;
  return (data ?? []) as SenderDailyStatsRow[];
}

export interface SenderProfileRow {
  id: string;
  sender_id: string;
  project_id: string;
  profile: Record<string, string>;
  source_urls: string[];
  model: string;
  generated_at: string;
  created_at: string;
  updated_at: string;
}

export async function getSenderProfile(
  projectId: string,
  senderId: string
): Promise<SenderProfileRow | null> {
  const { data, error } = await supabaseAdmin
    .from("sender_profiles")
    .select("*")
    .eq("project_id", projectId)
    .eq("sender_id", senderId)
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as SenderProfileRow | null) ?? null;
}

export async function createProjectSender(params: {
  projectId: string;
  name: string;
  website?: string;
  description?: string;
  logo_url?: string;
  country?: string;
}): Promise<ProjectSender> {
  const name = params.name.trim();
  if (!name) throw new Error("Sender name is required");

  const { data, error } = await supabaseAdmin
    .from("email_senders")
    .insert({
      project_id: params.projectId,
      name,
      website: params.website?.trim() || null,
      description: params.description?.trim() || null,
      logo_url: params.logo_url?.trim() || null,
      country: params.country?.trim().toUpperCase() || null,
    })
    .select(SENDER_SELECT)
    .single();

  if (error) {
    if (isUniqueViolation(error)) {
      throw new Error("A sender with this name already exists");
    }
    throw error;
  }
  return data as ProjectSender;
}

export async function updateProjectSender(params: {
  projectId: string;
  senderId: string;
  name?: string;
  website?: string | null;
  description?: string | null;
  logo_url?: string | null;
  country?: string | null;
}): Promise<ProjectSender | null> {
  const update: Record<string, any> = {};
  if (params.name !== undefined) {
    const value = params.name.trim();
    if (!value) throw new Error("Sender name is required");
    update.name = value;
  }
  if (params.website !== undefined) update.website = params.website?.trim() || null;
  if (params.description !== undefined) update.description = params.description?.trim() || null;
  if (params.logo_url !== undefined) update.logo_url = params.logo_url?.trim() || null;
  if (params.country !== undefined) update.country = params.country?.trim().toUpperCase() || null;
  if (!Object.keys(update).length) return null;

  const { data, error } = await supabaseAdmin
    .from("email_senders")
    .update(update)
    .eq("project_id", params.projectId)
    .eq("id", params.senderId)
    .is("deleted_at", null)
    .select(SENDER_SELECT)
    .maybeSingle();
  if (error) {
    if (isUniqueViolation(error)) {
      throw new Error("A sender with this name already exists");
    }
    throw error;
  }
  return (data as ProjectSender | null) ?? null;
}

export async function softDeleteProjectSender(
  projectId: string,
  senderId: string
): Promise<boolean> {
  const nowIso = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from("email_senders")
    .update({ deleted_at: nowIso })
    .eq("project_id", projectId)
    .eq("id", senderId)
    .is("deleted_at", null)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!data) return false;

  // Unlink domains from deleted sender, reset to pending
  await supabaseAdmin
    .from("email_domains")
    .update({ sender_id: null, resolver_status: "pending" })
    .eq("sender_id", senderId);

  return true;
}

export async function findSenderByName(
  projectId: string,
  name: string
): Promise<ProjectSender | null> {
  const { data, error } = await supabaseAdmin
    .from("email_senders")
    .select(SENDER_SELECT)
    .eq("project_id", projectId)
    .ilike("name", name.trim())
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  return (data as ProjectSender | null) ?? null;
}

export async function linkDomainToSender(
  domainId: string,
  senderId: string
): Promise<void> {
  const { error } = await supabaseAdmin
    .from("email_domains")
    .update({ sender_id: senderId, resolver_status: "resolved", resolver_error: null })
    .eq("id", domainId);
  if (error) throw error;
}

export async function mergeSenders(
  projectId: string,
  keepId: string,
  mergeId: string
): Promise<boolean> {
  // Reassign all domains from mergeId to keepId
  await supabaseAdmin
    .from("email_domains")
    .update({ sender_id: keepId })
    .eq("sender_id", mergeId);

  // Soft-delete the merged sender
  return softDeleteProjectSender(projectId, mergeId);
}

export async function claimDomainForResolving(
  domainId: string
): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("email_domains")
    .update({ resolver_status: "resolving" })
    .eq("id", domainId)
    .eq("resolver_status", "pending")
    .select("id")
    .maybeSingle();
  if (error) throw error;
  return Boolean(data?.id);
}

export async function setDomainResolverResult(
  domainId: string,
  status: ResolverStatus,
  error?: string
): Promise<void> {
  const update: Record<string, any> = { resolver_status: status };
  if (error !== undefined) update.resolver_error = error;
  else update.resolver_error = null;
  await supabaseAdmin
    .from("email_domains")
    .update(update)
    .eq("id", domainId);
}

export async function listPendingDomains(
  projectId: string,
  statuses: ResolverStatus[] = ["pending", "failed"]
): Promise<ProjectEmailDomain[]> {
  const { data, error } = await supabaseAdmin
    .from("email_domains")
    .select("id, project_id, domain, enabled, sender_id, resolver_status, resolver_error, created_at, updated_at, last_seen_at")
    .eq("project_id", projectId)
    .in("resolver_status", statuses)
    .order("domain", { ascending: true });
  if (error) throw error;
  return (data ?? []) as ProjectEmailDomain[];
}

export async function getLatestEmailForDomain(
  projectId: string,
  domain: string
): Promise<{ from_address: string; subject: string | null; body_text: string | null } | null> {
  const { data, error } = await supabaseAdmin
    .from("incoming_emails")
    .select("from_address, subject, body_text")
    .eq("project_id", projectId)
    .eq("from_domain", domain)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

// --- Dashboard Aggregates ---

export interface DashboardStats {
  kpis: { total: number; unread: number; processed: number; failed: number };
  tag_daily: { date: string; tag_id: string; tag_name: string; tag_color: string; count: number }[];
  top_domains: { domain: string; count: number; latest_date: string }[];
  activity_grid: { date: string; count: number }[];
  recent_emails: {
    id: string;
    from_address: string;
    from_domain: string | null;
    subject: string | null;
    status: string;
    created_at: string;
    read_at: string | null;
    summary: string | null;
    tags: { id: string; name: string; color: string }[];
  }[];
  countries: string[];
}

export async function getDashboardStats(
  projectId: string,
  days: number,
  countries?: string[]
): Promise<DashboardStats> {
  const { data, error } = await supabaseAdmin.rpc("get_dashboard_stats", {
    p_project_id: projectId,
    p_days: days,
    p_countries: countries && countries.length > 0 ? countries : null,
  });
  if (error) throw error;
  return data as DashboardStats;
}

// --- Email Classifications & Sender Strategies ---

export interface EmailClassificationRow {
  id: string;
  email_id: string;
  project_id: string;
  sender_id: string;
  email_type: string;
  offer: string | null;
  discount_pct: number | null;
  urgency: string;
  cta: string | null;
  products_mentioned: string[];
  tone: string;
  personalization_level: string;
  subject_length: number | null;
  subject_has_emoji: boolean;
  subject_has_personalization: boolean;
  subject_urgency_words: string[];
  model: string;
  classified_at: string;
  created_at: string;
}

export interface SenderStrategyRow {
  id: string;
  sender_id: string;
  project_id: string;
  strategy: Record<string, any>;
  email_count: number;
  date_range_start: string | null;
  date_range_end: string | null;
  model: string;
  generated_at: string;
  created_at: string;
  updated_at: string;
}

export interface UnclassifiedEmail {
  id: string;
  subject: string | null;
  body_text: string | null;
  from_address: string;
  created_at: string;
}

export async function listUnclassifiedSenderEmails(
  projectId: string,
  senderId: string,
  limit = 500
): Promise<UnclassifiedEmail[]> {
  const { data, error } = await supabaseAdmin.rpc(
    "list_unclassified_sender_emails",
    { p_project_id: projectId, p_sender_id: senderId, p_limit: limit }
  );
  if (error) throw error;
  return (data ?? []) as UnclassifiedEmail[];
}

export async function getSenderClassifications(
  projectId: string,
  senderId: string
): Promise<EmailClassificationRow[]> {
  const { data, error } = await supabaseAdmin
    .from("email_classifications")
    .select("*")
    .eq("project_id", projectId)
    .eq("sender_id", senderId)
    .order("classified_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as EmailClassificationRow[];
}

export async function upsertEmailClassifications(
  rows: Omit<EmailClassificationRow, "id" | "created_at">[]
): Promise<void> {
  if (!rows.length) return;
  const { error } = await supabaseAdmin
    .from("email_classifications")
    .upsert(rows, { onConflict: "email_id" });
  if (error) throw error;
}

export async function getSenderStrategy(
  projectId: string,
  senderId: string
): Promise<SenderStrategyRow | null> {
  const { data, error } = await supabaseAdmin
    .from("sender_strategies")
    .select("*")
    .eq("project_id", projectId)
    .eq("sender_id", senderId)
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as SenderStrategyRow | null) ?? null;
}

export async function insertSenderStrategy(row: {
  sender_id: string;
  project_id: string;
  strategy: Record<string, any>;
  email_count: number;
  date_range_start: string | null;
  date_range_end: string | null;
  model: string;
}): Promise<SenderStrategyRow> {
  const { data, error } = await supabaseAdmin
    .from("sender_strategies")
    .insert(row)
    .select("*")
    .single();
  if (error) throw error;
  return data as SenderStrategyRow;
}
