import Anthropic from "@anthropic-ai/sdk";
import {
  supabaseAdmin,
  listProjectSenders,
  listUnclassifiedSenderEmails,
  getSenderClassifications,
  upsertEmailClassifications,
  getSenderStrategy,
  insertSenderStrategy,
  type EmailClassificationRow,
} from "./db.js";

const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

const HAIKU_MODEL = "claude-haiku-4-5-20251001";
const SONNET_MODEL = "claude-sonnet-4-6";
const BATCH_SIZE = 25;
const BODY_MAX_LENGTH = 1500;
const CONCURRENCY = 2;

// --- Pass 1: Classification (Haiku) ---

const CLASSIFY_SYSTEM = `You are an email marketing classifier. Given a batch of emails, classify each one.

Return ONLY a valid JSON array with one object per email, in the same order as input. Each object:
{
  "email_id": "the id",
  "email_type": "welcome|promotional|newsletter|cart_abandon|winback|transactional|announcement|survey|loyalty|seasonal|other",
  "offer": "brief description of offer or null",
  "discount_pct": 0-100 or null,
  "urgency": "none|soft|hard",
  "cta": "primary call-to-action text or null",
  "products_mentioned": ["product1", "product2"],
  "tone": "formal|casual|urgent|friendly|luxury",
  "personalization_level": "none|basic|moderate|advanced",
  "subject_length": number,
  "subject_has_emoji": boolean,
  "subject_has_personalization": boolean,
  "subject_urgency_words": ["word1", "word2"]
}

Rules:
- "discount_pct": integer 0-100, the discount percentage if mentioned (e.g. "20% off" = 20). null if none.
- "subject_length": character count of the subject line
- "subject_has_emoji": true if the subject contains any emoji
- "subject_has_personalization": true if the subject contains first name, location, or other personal tokens
- "subject_urgency_words": array of urgency words found in the subject (e.g. "limited", "hurry", "last chance", "ends today", "don't miss")
- "products_mentioned": specific product names mentioned. Empty array if none.
- Be precise and factual. Only classify what you can determine from the content.`;

interface ClassifyResult {
  email_id: string;
  email_type: string;
  offer: string | null;
  discount_pct: number | null;
  urgency: string;
  cta: string | null;
  products_mentioned: string[];
  tone: string;
  personalization_level: string;
  subject_length: number;
  subject_has_emoji: boolean;
  subject_has_personalization: boolean;
  subject_urgency_words: string[];
}

async function classifyBatch(
  emails: { id: string; subject: string | null; body_text: string | null }[]
): Promise<ClassifyResult[]> {
  if (!anthropic) throw new Error("Anthropic API key not configured");

  const emailsText = emails
    .map((e, i) => {
      const body = (e.body_text || "").slice(0, BODY_MAX_LENGTH);
      return `--- Email ${i + 1} ---\nID: ${e.id}\nSubject: ${e.subject || "(no subject)"}\nBody:\n${body}`;
    })
    .join("\n\n");

  const response = await anthropic.messages.create({
    model: HAIKU_MODEL,
    max_tokens: 4096,
    system: CLASSIFY_SYSTEM,
    messages: [{ role: "user", content: `Classify these ${emails.length} emails:\n\n${emailsText}` }],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "";
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error("Failed to extract JSON array from classification response");

  try {
    return JSON.parse(jsonMatch[0]) as ClassifyResult[];
  } catch {
    throw new Error("Failed to parse classification JSON");
  }
}

export async function classifySenderEmails(
  projectId: string,
  senderId: string
): Promise<{ classified: number; total: number }> {
  const unclassified = await listUnclassifiedSenderEmails(projectId, senderId, 500);
  if (!unclassified.length) return { classified: 0, total: 0 };

  let classified = 0;

  // Batch into groups of BATCH_SIZE
  const batches: typeof unclassified[] = [];
  for (let i = 0; i < unclassified.length; i += BATCH_SIZE) {
    batches.push(unclassified.slice(i, i + BATCH_SIZE));
  }

  // Process with concurrency
  for (let i = 0; i < batches.length; i += CONCURRENCY) {
    const chunk = batches.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      chunk.map(async (batch) => {
        const classifications = await classifyBatch(batch);
        const rows = classifications.map((c) => ({
          email_id: c.email_id,
          project_id: projectId,
          sender_id: senderId,
          email_type: c.email_type,
          offer: c.offer || null,
          discount_pct: c.discount_pct ?? null,
          urgency: c.urgency || "none",
          cta: c.cta || null,
          products_mentioned: c.products_mentioned || [],
          tone: c.tone || "casual",
          personalization_level: c.personalization_level || "none",
          subject_length: c.subject_length ?? null,
          subject_has_emoji: c.subject_has_emoji ?? false,
          subject_has_personalization: c.subject_has_personalization ?? false,
          subject_urgency_words: c.subject_urgency_words || [],
          model: HAIKU_MODEL,
          classified_at: new Date().toISOString(),
        }));
        await upsertEmailClassifications(rows as any);
        return rows.length;
      })
    );

    for (const result of results) {
      if (result.status === "fulfilled") classified += result.value;
      else console.error("[strategyAnalyzer] Batch classification failed:", result.reason);
    }
  }

  console.log(`[strategyAnalyzer] Classified ${classified}/${unclassified.length} emails for sender ${senderId}`);
  return { classified, total: unclassified.length };
}

// --- Pass 2: Strategy Analysis (Sonnet) ---

const STRATEGY_SYSTEM = `You are an email marketing strategist. Given classified email data and subject lines from a sender, produce a comprehensive strategy analysis.

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
- Be data-driven. Reference specific numbers from the classifications.
- "recommendations": 3-7 actionable recommendations for someone analyzing this sender's strategy`;

export async function generateSenderStrategy(
  projectId: string,
  senderId: string
): Promise<{ strategy: Record<string, any>; emailCount: number } | null> {
  if (!anthropic) throw new Error("Anthropic API key not configured");

  // Pass 1: Classify any new emails first
  await classifySenderEmails(projectId, senderId);

  // Fetch all classifications (compact, no body text)
  const classifications = await getSenderClassifications(projectId, senderId);
  if (!classifications.length) return null;

  // Fetch email subjects + dates for subject line analysis
  const { data: emailMeta } = await supabaseAdmin
    .from("incoming_emails")
    .select("id, subject, created_at")
    .in(
      "id",
      classifications.map((c) => c.email_id)
    )
    .order("created_at", { ascending: true });

  const subjects = (emailMeta ?? []).map((e: any) => ({
    subject: e.subject,
    date: e.created_at,
  }));

  // Build classification summary (compact)
  const classificationSummary = classifications.map((c) => ({
    type: c.email_type,
    offer: c.offer,
    discount_pct: c.discount_pct,
    urgency: c.urgency,
    tone: c.tone,
    personalization: c.personalization_level,
    products: c.products_mentioned,
    cta: c.cta,
  }));

  const response = await anthropic.messages.create({
    model: SONNET_MODEL,
    max_tokens: 4096,
    system: STRATEGY_SYSTEM,
    messages: [
      {
        role: "user",
        content: `Analyze the email marketing strategy for this sender based on ${classifications.length} classified emails.

Classification data:
${JSON.stringify(classificationSummary, null, 0)}

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
  const dates = classifications.map((c) => c.classified_at).sort();
  const subjectDates = subjects.map((s) => s.date).sort();
  const allDates = [...dates, ...subjectDates].sort();

  const row = await insertSenderStrategy({
    sender_id: senderId,
    project_id: projectId,
    strategy,
    email_count: classifications.length,
    date_range_start: allDates[0] || null,
    date_range_end: allDates[allDates.length - 1] || null,
    model: SONNET_MODEL,
  });

  console.log(`[strategyAnalyzer] Generated strategy for sender ${senderId} (${classifications.length} emails)`);
  return { strategy, emailCount: classifications.length };
}

// --- Batch ---

export async function refreshAllStrategies(
  projectId: string,
  concurrency = 2
): Promise<{ total: number; generated: number; failed: number }> {
  const senders = await listProjectSenders(projectId);
  // Only senders with emails
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
