import Anthropic from "@anthropic-ai/sdk";
import { openrouterChat, isOpenRouterConfigured, GEMINI_FLASH_MODEL, type ContentPart } from "./openrouter.js";
import {
  supabaseAdmin,
  listProjectSenders,
  listProjectExtractors,
  listUnextractedSenderEmails,
  listProjectEmailsForExtraction,
  getSenderExtractions,
  upsertEmailExtractions,
  getSenderStrategy,
  insertSenderStrategy,
  type EmailExtractorRow,
} from "./db.js";

const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

const EXTRACTION_MODEL = GEMINI_FLASH_MODEL;
const SONNET_MODEL = "claude-sonnet-4-6";
const BATCH_SIZE = 25;
const BODY_MAX_LENGTH = 1500;
const CONCURRENCY = 2;
const MAX_IMAGES_PER_EMAIL = 10;
const MIN_IMAGE_DIMENSION = 50;

// --- Pass 1: Extraction (Haiku) ---

function buildExtractionPrompt(extractors: EmailExtractorRow[]): string {
  const categories = extractors.filter((e) => e.kind === "category");
  const fields = extractors.filter((e) => e.kind === "extractor");

  const schemaLines: string[] = ['"email_id": "the id"'];
  const ruleLines: string[] = [];

  for (const category of categories) {
    const vals = category.enum_values.join("|");
    schemaLines.push(`"${category.name}": "${vals}"`);
    if (category.description) ruleLines.push(`- "${category.name}": ${category.description}`);
  }

  for (const f of fields) {
    let typeHint: string;
    switch (f.value_type) {
      case "text":
        typeHint = "string or null";
        break;
      case "text_array":
        typeHint = '["item1", "item2"]';
        break;
      case "number":
        typeHint = "number or null";
        break;
      case "boolean":
        typeHint = "boolean";
        break;
      case "enum":
        typeHint = f.enum_values.join("|");
        break;
      default:
        typeHint = "any";
    }
    schemaLines.push(`"${f.name}": ${typeHint}`);
    if (f.description) ruleLines.push(`- "${f.name}": ${f.description}`);
  }

  return `You are an email marketing analyzer. Given a batch of emails, extract structured data from each one.

Return ONLY a valid JSON array with one object per email, in the same order as input. Each object:
{
  ${schemaLines.join(",\n  ")}
}

Rules:
${ruleLines.join("\n")}
- Be precise and factual. Only extract what you can determine from the content.`;
}

interface ExtractionResult {
  email_id: string;
  [key: string]: any;
}

function sanitizeImageUrl(raw: string): string | null {
  try {
    const trimmed = raw.trim();
    if (!trimmed || !trimmed.startsWith("http")) return null;
    // Fix spaces and other invalid chars
    const url = new URL(trimmed);
    return url.toString();
  } catch {
    return null;
  }
}

function extractImageUrls(html: string, max: number): string[] {
  if (!html) return [];
  const results: Array<{ url: string; area: number }> = [];
  const imgRegex = /<img\s[^>]*?src\s*=\s*["']([^"']+)["'][^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = imgRegex.exec(html)) !== null) {
    const tag = match[0];
    const rawUrl = match[1];
    if (rawUrl.startsWith("data:")) continue;
    if (/\btrack(ing)?\b|\/open\b|\/pixel\b|spacer|blank\./i.test(rawUrl)) continue;
    const url = sanitizeImageUrl(rawUrl);
    if (!url) continue;
    const wm = tag.match(/width\s*=\s*["']?(\d+)/i);
    const hm = tag.match(/height\s*=\s*["']?(\d+)/i);
    const w = wm ? parseInt(wm[1]) : 300;
    const h = hm ? parseInt(hm[1]) : 300;
    if (w < MIN_IMAGE_DIMENSION || h < MIN_IMAGE_DIMENSION) continue;
    results.push({ url, area: w * h });
  }
  // Return the largest images first
  results.sort((a, b) => b.area - a.area);
  return results.slice(0, max).map((r) => r.url);
}

function buildExtractionParts(
  emails: { id: string; subject: string | null; body_text: string | null; body_html?: string | null }[],
  includeImages: boolean
): ContentPart[] {
  const parts: ContentPart[] = [
    { type: "text", text: `Extract data from these ${emails.length} emails${includeImages ? ". Consider both text and images" : ""}:` },
  ];
  for (let i = 0; i < emails.length; i++) {
    const e = emails[i];
    const body = (e.body_text || "").slice(0, BODY_MAX_LENGTH);
    parts.push({
      type: "text",
      text: `--- Email ${i + 1} ---\nID: ${e.id}\nSubject: ${e.subject || "(no subject)"}\nBody:\n${body}`,
    });
    if (includeImages) {
      const images = extractImageUrls(e.body_html || "", MAX_IMAGES_PER_EMAIL);
      for (const url of images) {
        parts.push({ type: "image_url", image_url: { url } });
      }
    }
  }
  return parts;
}

async function callExtraction(parts: ContentPart[], systemPrompt: string): Promise<string> {
  if (isOpenRouterConfigured()) {
    return openrouterChat({
      model: EXTRACTION_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: parts },
      ],
    });
  } else if (anthropic) {
    const anthropicContent: any[] = parts.map((p) => {
      if (p.type === "text") return p;
      return { type: "image", source: { type: "url", url: p.image_url.url } };
    });
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: "user", content: anthropicContent }],
    });
    return response.content[0].type === "text" ? response.content[0].text : "";
  }
  throw new Error("No API key configured (OpenRouter or Anthropic)");
}

async function extractBatch(
  emails: { id: string; subject: string | null; body_text: string | null; body_html?: string | null }[],
  systemPrompt: string
): Promise<ExtractionResult[]> {
  let text: string;

  try {
    const parts = buildExtractionParts(emails, true);
    text = await callExtraction(parts, systemPrompt);
  } catch (err: any) {
    // If images caused a 400 (broken URL, 404, etc.), retry text-only
    if (err.message?.includes("400")) {
      console.warn("[strategyAnalyzer] Image error, retrying batch text-only:", err.message.slice(0, 120));
      const textOnlyParts = buildExtractionParts(emails, false);
      text = await callExtraction(textOnlyParts, systemPrompt);
    } else {
      throw err;
    }
  }

  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error("Failed to extract JSON array from extraction response");

  try {
    return JSON.parse(jsonMatch[0]) as ExtractionResult[];
  } catch {
    throw new Error("Failed to parse extraction JSON");
  }
}

export async function extractSenderEmails(
  projectId: string,
  senderId: string
): Promise<{ extracted: number; total: number }> {
  const unextracted = await listUnextractedSenderEmails(projectId, senderId, 500);
  if (!unextracted.length) return { extracted: 0, total: 0 };

  // Load project extractors and build prompt
  const allExtractors = await listProjectExtractors(projectId);
  const enabled = allExtractors.filter((e) => e.enabled);
  if (!enabled.length) return { extracted: 0, total: 0 };

  const systemPrompt = buildExtractionPrompt(enabled);
  const categoryExtractors = enabled.filter((e) => e.kind === "category");
  // Use first category (by sort_order) for the top-level `category` column
  const primaryCategoryName = categoryExtractors.length > 0
    ? categoryExtractors.reduce((a, b) => a.sort_order <= b.sort_order ? a : b).name
    : "email_type";

  let extracted = 0;

  const batches: typeof unextracted[] = [];
  for (let i = 0; i < unextracted.length; i += BATCH_SIZE) {
    batches.push(unextracted.slice(i, i + BATCH_SIZE));
  }

  for (let i = 0; i < batches.length; i += CONCURRENCY) {
    const chunk = batches.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      chunk.map(async (batch) => {
        const extractions = await extractBatch(batch, systemPrompt);
        const rows = extractions.map((e) => {
          const { email_id, ...rest } = e;
          // Primary category goes into the dedicated column
          const categoryValue = rest[primaryCategoryName] ?? null;
          return {
            email_id,
            project_id: projectId,
            sender_id: senderId,
            category: categoryValue,
            data: rest,
            model: EXTRACTION_MODEL,
            extracted_at: new Date().toISOString(),
          };
        });
        await upsertEmailExtractions(rows);
        return rows.length;
      })
    );

    for (const result of results) {
      if (result.status === "fulfilled") extracted += result.value;
      else console.error("[strategyAnalyzer] Batch extraction failed:", result.reason);
    }
  }

  console.log(`[strategyAnalyzer] Extracted ${extracted}/${unextracted.length} emails for sender ${senderId}`);
  return { extracted, total: unextracted.length };
}

/**
 * Extract categories + data fields for all emails in a project (re-extraction).
 */
export async function extractAllProjectEmails(
  projectId: string,
  onProgress?: (done: number, total: number) => void
): Promise<{ extracted: number; total: number }> {
  const allEmails = await listProjectEmailsForExtraction(projectId);
  if (!allEmails.length) return { extracted: 0, total: 0 };

  const allExtractors = await listProjectExtractors(projectId);
  const enabled = allExtractors.filter((e) => e.enabled);
  if (!enabled.length) return { extracted: 0, total: 0 };

  const systemPrompt = buildExtractionPrompt(enabled);
  const categoryExtractors = enabled.filter((e) => e.kind === "category");
  const primaryCategoryName = categoryExtractors.length > 0
    ? categoryExtractors.reduce((a, b) => a.sort_order <= b.sort_order ? a : b).name
    : "email_type";

  let extracted = 0;

  const batches: typeof allEmails[] = [];
  for (let i = 0; i < allEmails.length; i += BATCH_SIZE) {
    batches.push(allEmails.slice(i, i + BATCH_SIZE));
  }

  for (let i = 0; i < batches.length; i += CONCURRENCY) {
    const chunk = batches.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      chunk.map(async (batch) => {
        const extractions = await extractBatch(batch, systemPrompt);
        const rows = extractions.map((e) => {
          const { email_id, ...rest } = e;
          const categoryValue = rest[primaryCategoryName] ?? null;
          return {
            email_id,
            project_id: projectId,
            sender_id: null,
            category: categoryValue,
            data: rest,
            model: EXTRACTION_MODEL,
            extracted_at: new Date().toISOString(),
          };
        });
        await upsertEmailExtractions(rows);
        return rows.length;
      })
    );

    for (const result of results) {
      if (result.status === "fulfilled") extracted += result.value;
      else console.error("[strategyAnalyzer] Batch extraction failed:", result.reason);
    }
    onProgress?.(extracted, allEmails.length);
  }

  console.log(`[strategyAnalyzer] Extracted ${extracted}/${allEmails.length} emails for project ${projectId}`);
  return { extracted, total: allEmails.length };
}

// --- Pass 2: Strategy Analysis (Sonnet) ---

const STRATEGY_SYSTEM = `You are an email marketing strategist. Given extracted email data and subject lines from a sender, produce a comprehensive strategy analysis.

Return ONLY valid JSON with these exact keys:
{
  "executive_summary": "2-4 sentence overview of the sender's email marketing strategy, strengths, and approach",
  "email_flows": [
    { "name": "Flow name", "detected": true, "email_count": 3, "description": "Brief description" }
  ],
  "cadence": {
    "avg_per_week": 2.5,
    "consistency_score": 0.8,
    "peak_days": ["Tuesday", "Thursday"],
    "peak_hours": [10, 14],
    "pattern": "Brief description of sending pattern"
  },
  "promotional_calendar": "Description of seasonal/event-driven campaigns observed",
  "discount_strategy": {
    "avg_discount_pct": 15,
    "max_discount_pct": 40,
    "frequency": "How often discounts appear",
    "tactics": "Description of discount tactics used"
  },
  "content_strategy": {
    "primary_tone": "casual",
    "content_mix": { "promotional": 40, "newsletter": 30, "transactional": 20, "other": 10 },
    "personalization_usage": "Description of how personalization is used",
    "key_themes": ["theme1", "theme2"]
  },
  "subject_line_analysis": {
    "avg_length": 45,
    "emoji_pct": 30,
    "urgency_pct": 20,
    "personalization_pct": 10,
    "common_patterns": ["pattern1", "pattern2"],
    "top_urgency_words": ["word1", "word2"]
  },
  "segmentation_signals": "Evidence of audience segmentation in their emails",
  "ab_testing_signals": "Evidence of A/B testing in subject lines or content",
  "funnel_mapping": {
    "awareness": 20,
    "consideration": 30,
    "conversion": 35,
    "retention": 15
  },
  "competitive_insights": "What this sender does well relative to industry norms",
  "recommendations": ["rec1", "rec2", "rec3"]
}

Rules:
- "email_flows": detect common flows like Welcome Series, Cart Abandonment, Post-Purchase, Winback, Re-engagement, Browse Abandonment. Set detected=false if not found.
- "cadence.consistency_score": 0-1 float, how consistent their sending schedule is
- "content_strategy.content_mix": percentages that sum to 100
- "funnel_mapping": percentages that sum to 100
- "subject_line_analysis": derive from the subject line data provided
- Be data-driven. Reference specific numbers from the extraction data.
- "recommendations": 3-7 actionable recommendations for someone analyzing this sender's strategy`;

export async function generateSenderStrategy(
  projectId: string,
  senderId: string
): Promise<{ strategy: Record<string, any>; emailCount: number } | null> {
  if (!anthropic) throw new Error("Anthropic API key not configured");

  // Pass 1: Extract any new emails first
  await extractSenderEmails(projectId, senderId);

  // Fetch all extractions
  const extractions = await getSenderExtractions(projectId, senderId);
  if (!extractions.length) return null;

  // Fetch email subjects + dates for subject line analysis
  const { data: emailMeta } = await supabaseAdmin
    .from("incoming_emails")
    .select("id, subject, created_at")
    .in(
      "id",
      extractions.map((e) => e.email_id)
    )
    .order("created_at", { ascending: true });

  const subjects = (emailMeta ?? []).map((e: any) => ({
    subject: e.subject,
    date: e.created_at,
  }));

  // Build extraction summary (compact)
  const extractionSummary = extractions.map((e) => ({
    type: e.category,
    ...e.data,
  }));

  const response = await anthropic.messages.create({
    model: SONNET_MODEL,
    max_tokens: 4096,
    system: STRATEGY_SYSTEM,
    messages: [
      {
        role: "user",
        content: `Analyze the email marketing strategy for this sender based on ${extractions.length} analyzed emails.

Extraction data:
${JSON.stringify(extractionSummary, null, 0)}

Subject lines with dates:
${JSON.stringify(subjects, null, 0)}`,
      },
    ],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "";
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("Failed to extract JSON from strategy response");

  let strategy: Record<string, any>;
  try {
    strategy = JSON.parse(jsonMatch[0]);
  } catch {
    throw new Error("Failed to parse strategy JSON");
  }

  // Determine date range
  const dates = extractions.map((e) => e.extracted_at).sort();
  const subjectDates = subjects.map((s) => s.date).sort();
  const allDates = [...dates, ...subjectDates].sort();

  await insertSenderStrategy({
    sender_id: senderId,
    project_id: projectId,
    strategy,
    email_count: extractions.length,
    date_range_start: allDates[0] || null,
    date_range_end: allDates[allDates.length - 1] || null,
    model: SONNET_MODEL,
  });

  console.log(`[strategyAnalyzer] Generated strategy for sender ${senderId} (${extractions.length} emails)`);
  return { strategy, emailCount: extractions.length };
}

// --- Batch ---

export async function refreshAllStrategies(
  projectId: string,
  concurrency = 2
): Promise<{ total: number; generated: number; failed: number }> {
  const senders = await listProjectSenders(projectId);
  const targets = senders.filter((s) => s.email_count && s.email_count > 0);
  if (!targets.length) return { total: 0, generated: 0, failed: 0 };

  let generated = 0;
  let failed = 0;

  for (let i = 0; i < targets.length; i += concurrency) {
    const batch = targets.slice(i, i + concurrency);
    const results = await Promise.allSettled(
      batch.map((s) => generateSenderStrategy(projectId, s.id))
    );
    for (const result of results) {
      if (result.status === "fulfilled" && result.value) generated++;
      else failed++;
    }
  }

  console.log(
    `[strategyAnalyzer] Batch: ${generated}/${targets.length} generated, ${failed} failed`
  );
  return { total: targets.length, generated, failed };
}
