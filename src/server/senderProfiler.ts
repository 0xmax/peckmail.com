import Anthropic from "@anthropic-ai/sdk";
import { fetchPage } from "./senderResolver.js";
import {
  supabaseAdmin,
  listProjectSenders,
} from "./db.js";

const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

const MODEL = "claude-sonnet-4-6";
const PAGE_MAX_LENGTH = 6000;

// --- Scraping (deterministic) ---

const PROBE_PATHS = ["/about", "/about-us", "/pricing", "/products"];

async function scrapeWebsite(
  websiteUrl: string
): Promise<{ pages: { url: string; content: string }[]; urls: string[] }> {
  const origin = new URL(websiteUrl).origin;

  // Fetch homepage + probe subpages in parallel
  const candidates = [
    websiteUrl,
    ...PROBE_PATHS.map((p) => `${origin}${p}`),
  ];

  const results = await Promise.allSettled(
    candidates.map(async (url) => {
      const content = await fetchPage(url, PAGE_MAX_LENGTH);
      if (content.startsWith("Error:")) return null;
      return { url, content };
    })
  );

  const pages: { url: string; content: string }[] = [];
  const urls: string[] = [];

  for (const result of results) {
    if (result.status === "fulfilled" && result.value) {
      pages.push(result.value);
      urls.push(result.value.url);
      if (pages.length >= 4) break; // Cap at 4 pages
    }
  }

  return { pages, urls };
}

// --- Analysis (single Claude call) ---

const SYSTEM_PROMPT = `You are a brand/company analyst. Given scraped website content, produce a structured JSON analysis of the company.

Return ONLY valid JSON with these exact keys:
{
  "company_profile": "2-3 sentence overview of the company, what they do, their market position",
  "industry": "Primary industry/sector (e.g. 'Fashion & Apparel', 'SaaS', 'Food & Beverage', 'Health & Wellness')",
  "tags": ["tag1", "tag2", "tag3"],
  "target_audiences": "Who are their primary and secondary customer segments",
  "product_portfolio": "Key products or services they offer",
  "top_products": ["Product Name 1", "Product Name 2", "Product Name 3"],
  "ongoing_sales": "Current promotions, sales, or special offers (or 'None found')",
  "pricing_snapshot": {
    "currency": "USD",
    "cheapest_product": { "name": "Product name", "price": 0 },
    "most_expensive_product": { "name": "Product name", "price": 0 },
    "deepest_discount_pct": 0
  },
  "pricing_strategy": "How they price their products (freemium, premium, tiered, etc.)",
  "marketing_approach": "Their marketing channels, tone, and strategy",
  "strengths": "3-5 key competitive strengths",
  "weaknesses": "3-5 potential weaknesses or risks",
  "recommendations": "3-5 recommendations for an AI email assistant working with emails from this company (e.g., key terms to recognize, tone suggestions, priority handling)"
}

Rules:
- String values: 1-3 sentences or comma-separated list. Be concise and insightful.
- "industry": single string, the primary industry or sector.
- "tags": array of 3-7 lowercase descriptive tags (e.g. "luxury", "subscription", "b2b", "eco-friendly", "dtc", "marketplace", "freemium"). Capture business model, positioning, and notable traits.
- "top_products": array of up to 5 product/service names (most prominent). Empty array if not found.
- "pricing_snapshot": use the 3-letter ISO currency code. Set price to 0 and name to null if not found. "deepest_discount_pct" is an integer 0-100 (0 if no discounts found).
- If information is unavailable for a string section, write "Not enough information available."`;

async function analyzeContent(
  senderName: string,
  pages: { url: string; content: string }[]
): Promise<Record<string, any>> {
  if (!anthropic) throw new Error("Anthropic API key not configured");

  const pagesText = pages
    .map((p, i) => `--- Page ${i + 1}: ${p.url} ---\n${p.content}`)
    .join("\n\n");

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Analyze this company: "${senderName}"\n\nWebsite content:\n\n${pagesText}`,
      },
    ],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";

  // Extract JSON from response (handle markdown code blocks)
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("Failed to extract JSON from analysis");

  try {
    return JSON.parse(jsonMatch[0]);
  } catch {
    throw new Error("Failed to parse JSON from analysis response");
  }
}

// --- Public API ---

export async function generateSenderProfile(
  projectId: string,
  senderId: string
): Promise<{ profile: Record<string, any>; sourceUrls: string[] } | null> {
  // Get sender info
  const { data: sender } = await supabaseAdmin
    .from("email_senders")
    .select("id, name, website")
    .eq("id", senderId)
    .eq("project_id", projectId)
    .is("deleted_at", null)
    .single();

  if (!sender) return null;
  if (!sender.website) throw new Error("Sender has no website configured");

  // Scrape
  const { pages, urls } = await scrapeWebsite(sender.website);
  if (pages.length === 0) throw new Error("Could not fetch any pages from the website");

  // Analyze
  const profile = await analyzeContent(sender.name, pages);

  // Insert row
  const { error } = await supabaseAdmin.from("sender_profiles").insert({
    sender_id: senderId,
    project_id: projectId,
    profile,
    source_urls: urls,
    model: MODEL,
  });
  if (error) throw new Error(`Failed to save profile: ${error.message}`);

  console.log(`[senderProfiler] Generated profile for "${sender.name}"`);
  return { profile, sourceUrls: urls };
}

export async function refreshAllProfiles(
  projectId: string,
  concurrency = 2
): Promise<{ total: number; generated: number; failed: number }> {
  const senders = await listProjectSenders(projectId);
  const targets = senders.filter((s) => s.website);
  if (!targets.length) return { total: 0, generated: 0, failed: 0 };

  return batchGenerate(projectId, targets, concurrency);
}

export async function refreshMissingProfiles(
  projectId: string,
  concurrency = 2
): Promise<{ total: number; generated: number; failed: number }> {
  const senders = await listProjectSenders(projectId);
  const sendersWithWebsites = senders.filter((s) => s.website);

  if (!sendersWithWebsites.length) return { total: 0, generated: 0, failed: 0 };

  // Find senders that already have profiles
  const { data: existingProfiles } = await supabaseAdmin
    .from("sender_profiles")
    .select("sender_id")
    .eq("project_id", projectId);

  const profiledSenderIds = new Set(
    (existingProfiles ?? []).map((p: { sender_id: string }) => p.sender_id)
  );

  const targets = sendersWithWebsites.filter(
    (s) => !profiledSenderIds.has(s.id)
  );

  if (!targets.length) return { total: 0, generated: 0, failed: 0 };

  return batchGenerate(projectId, targets, concurrency);
}

async function batchGenerate(
  projectId: string,
  targets: { id: string }[],
  concurrency: number
): Promise<{ total: number; generated: number; failed: number }> {

  let generated = 0;
  let failed = 0;

  // Process in batches
  for (let i = 0; i < targets.length; i += concurrency) {
    const batch = targets.slice(i, i + concurrency);
    const results = await Promise.allSettled(
      batch.map((s) => generateSenderProfile(projectId, s.id))
    );
    for (const result of results) {
      if (result.status === "fulfilled" && result.value) generated++;
      else failed++;
    }
  }

  console.log(
    `[senderProfiler] Batch: ${generated}/${targets.length} generated, ${failed} failed`
  );
  return { total: targets.length, generated, failed };
}
