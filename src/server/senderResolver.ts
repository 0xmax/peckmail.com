import Anthropic from "@anthropic-ai/sdk";
import {
  supabaseAdmin,
  claimDomainForResolving,
  setDomainResolverResult,
  findSenderByName,
  createProjectSender,
  linkDomainToSender,
  listProjectSenders,
  listPendingDomains,
  getLatestEmailForDomain,
  type ProjectSender,
  type ProjectEmailDomain,
} from "./db.js";
import { broadcast } from "./ws.js";

const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

const MODEL = "claude-haiku-4-5-20251001";
const MAX_TURNS = 5;

// --- Search via Serper (Google) ---

async function searchWeb(query: string, limit = 3): Promise<string> {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) return "Error: Web search is not configured (SERPER_API_KEY not set).";
  try {
    const res = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: {
        "X-API-KEY": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ q: query, num: limit }),
    });
    if (!res.ok) {
      const text = await res.text();
      return `Error: Search failed (${res.status}): ${text.slice(0, 200)}`;
    }
    const data = (await res.json()) as {
      organic?: Array<{ title?: string; link?: string; snippet?: string }>;
      knowledgeGraph?: { title?: string; description?: string; website?: string };
    };
    const parts: string[] = [];
    if (data.knowledgeGraph) {
      const kg = data.knowledgeGraph;
      parts.push(`Knowledge Graph: ${kg.title || ""}${kg.website ? ` — ${kg.website}` : ""}\n   ${kg.description || ""}`);
    }
    if (data.organic && data.organic.length > 0) {
      for (let i = 0; i < Math.min(data.organic.length, limit); i++) {
        const r = data.organic[i];
        parts.push(`${i + 1}. ${r.title || "Untitled"} — ${r.link || ""}\n   ${r.snippet || ""}`);
      }
    }
    return parts.length > 0 ? parts.join("\n\n") : "No results found.";
  } catch (err: any) {
    return `Error: Web search failed — ${err.message || "unknown error"}`;
  }
}

// --- Page fetch via Firecrawl ---

async function fetchPage(url: string): Promise<string> {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) return "Error: Page fetching is not configured.";
  try {
    const res = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ url, formats: ["markdown"] }),
    });
    if (!res.ok) {
      const text = await res.text();
      return `Error: Could not fetch page (${res.status}): ${text.slice(0, 200)}`;
    }
    const data = (await res.json()) as {
      data?: { markdown?: string; title?: string };
    };
    const md = data.data?.markdown || "";
    if (!md) return "Error: No content could be extracted from the page.";
    const truncated = md.length > 4000 ? md.slice(0, 4000) + "\n\n... (truncated)" : md;
    return data.data?.title ? `# ${data.data.title}\n\n${truncated}` : truncated;
  } catch (err: any) {
    return `Error: Could not fetch page — ${err.message || "unknown error"}`;
  }
}

// --- Tool definitions ---

const tools: Anthropic.Tool[] = [
  {
    name: "search_web",
    description: "Search the web for information about a brand or company. Use this to identify which company/brand owns a sending domain.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "Search query" },
      },
      required: ["query"],
    },
  },
  {
    name: "fetch_page",
    description: "Fetch and read a web page. Use this to verify brand identity from a website.",
    input_schema: {
      type: "object" as const,
      properties: {
        url: { type: "string", description: "URL to fetch" },
      },
      required: ["url"],
    },
  },
  {
    name: "resolve_sender",
    description: "Submit the final answer identifying the brand/company behind this email domain. Call this exactly once when you have identified the sender.",
    input_schema: {
      type: "object" as const,
      properties: {
        name: {
          type: "string",
          description: "Brand/company name (e.g. 'Clarins', 'Nike', 'Shopify')",
        },
        website: {
          type: "string",
          description: "Brand website URL (e.g. 'https://www.clarins.com')",
        },
        description: {
          type: "string",
          description: "Brief one-line description of the brand/company",
        },
        logo_url: {
          type: "string",
          description: "URL to brand logo if found",
        },
        country: {
          type: "string",
          description: "ISO 3166-1 alpha-2 country code of the brand's headquarters (e.g. 'US', 'FR', 'DE', 'JP')",
        },
        existing_sender_id: {
          type: "string",
          description: "ID of an existing sender to link to (if this domain belongs to a known sender)",
        },
      },
      required: ["name"],
    },
  },
];

// --- System prompt ---

function buildSystemPrompt(existingSenders: ProjectSender[]): string {
  let sendersList = "None yet.";
  if (existingSenders.length > 0) {
    sendersList = existingSenders
      .map((s) => `- "${s.name}" (id: ${s.id})${s.website ? ` — ${s.website}` : ""}`)
      .join("\n");
  }

  return `You are a brand identification agent. Given an email domain and context from a recent email, identify the brand or company behind it.

## Existing senders in this project:
${sendersList}

## Instructions:
1. Use the email body excerpt, display name (from the From address), and subject as PRIMARY signals to identify the brand.
2. For platform domains (e.g., Klaviyo, Shopify, SendGrid), the brand is the STORE/COMPANY sending through that platform, not the platform itself.
3. Strip subdomains to find the root brand domain as a secondary signal (e.g., "fra-news.clarins.com" → "clarins.com").
4. If the root domain looks like a recognizable brand, try fetching it first.
5. If you're unsure, do a web search to verify.
6. If the domain clearly belongs to an existing sender from the list above, set existing_sender_id to that sender's ID.
7. Limit yourself to 2-3 tool calls total, then call resolve_sender exactly once.
8. If you absolutely cannot identify the brand, use a cleaned-up version of the domain name as the sender name.
9. Always try to determine the brand's headquarters country. Use the website TLD, search results, or general knowledge. Provide the ISO 3166-1 alpha-2 country code (e.g. "US", "FR", "DE", "JP").

Call resolve_sender exactly once with your final answer.`;
}

// --- Tool executor ---

async function executeTool(
  toolName: string,
  input: any
): Promise<string> {
  switch (toolName) {
    case "search_web":
      return searchWeb(input.query, 3);
    case "fetch_page":
      return fetchPage(input.url);
    case "resolve_sender":
      // This is the final answer — return confirmation
      return "Sender resolved.";
    default:
      return `Unknown tool: ${toolName}`;
  }
}

// --- Main resolver ---

interface ResolveContext {
  fromAddress: string;
  subject: string;
  bodyExcerpt: string;
}

export async function triggerSenderResolution(
  projectId: string,
  domainId: string,
  domain: string,
  context: ResolveContext
): Promise<void> {
  if (!anthropic) {
    console.warn("[senderResolver] Anthropic not configured, skipping");
    await setDomainResolverResult(domainId, "skipped", "Anthropic API key not configured");
    return;
  }

  if (!process.env.SERPER_API_KEY && !process.env.FIRECRAWL_API_KEY) {
    await setDomainResolverResult(domainId, "skipped", "No search API key configured (SERPER_API_KEY or FIRECRAWL_API_KEY)");
    return;
  }

  // Atomic CAS — only resolve if still pending
  const claimed = await claimDomainForResolving(domainId);
  if (!claimed) return;

  try {
    // Get context: existing senders + latest email for this domain
    const existingSenders = await listProjectSenders(projectId);

    let { fromAddress, subject, bodyExcerpt } = context;

    // Fallback: query the latest email for this domain if no body excerpt provided
    if (!bodyExcerpt) {
      const latestEmail = await getLatestEmailForDomain(projectId, domain);
      if (latestEmail) {
        if (!fromAddress) fromAddress = latestEmail.from_address;
        if (!subject) subject = latestEmail.subject || "";
        bodyExcerpt = (latestEmail.body_text || "").slice(0, 1000);
      }
    }

    const userMessage = `Identify the brand/company behind this email domain.

**Domain:** ${domain}
**From address:** ${fromAddress}
**Subject:** ${subject || "(no subject)"}
**Email body excerpt:**
${bodyExcerpt ? bodyExcerpt.slice(0, 1000) : "(not available)"}`;

    const systemPrompt = buildSystemPrompt(existingSenders);

    // Agentic loop
    let messages: Anthropic.MessageParam[] = [{ role: "user", content: userMessage }];
    let resolveResult: { name: string; website?: string; description?: string; logo_url?: string; country?: string; existing_sender_id?: string } | null = null;

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const response = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 1024,
        system: systemPrompt,
        tools,
        messages,
      });

      // Collect text + tool_use blocks
      const assistantContent = response.content;
      messages.push({ role: "assistant", content: assistantContent });

      // Check for tool use
      const toolUseBlocks = assistantContent.filter(
        (b): b is Anthropic.ContentBlockParam & { type: "tool_use"; id: string; name: string; input: any } =>
          b.type === "tool_use"
      );

      if (toolUseBlocks.length === 0) break;

      // Execute tools and collect results
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const toolBlock of toolUseBlocks) {
        if (toolBlock.name === "resolve_sender") {
          resolveResult = toolBlock.input as typeof resolveResult;
          toolResults.push({
            type: "tool_result",
            tool_use_id: toolBlock.id,
            content: "Sender resolved.",
          });
        } else {
          const result = await executeTool(toolBlock.name, toolBlock.input);
          toolResults.push({
            type: "tool_result",
            tool_use_id: toolBlock.id,
            content: result,
          });
        }
      }

      messages.push({ role: "user", content: toolResults });

      // If we got a resolve_sender call, we're done
      if (resolveResult) break;

      // If the model stopped (end_turn) without tool use, we're done
      if (response.stop_reason === "end_turn") break;
    }

    if (!resolveResult) {
      // Fallback — use cleaned domain name
      const rootDomain = domain.split(".").slice(-2).join(".");
      const fallbackName = rootDomain.split(".")[0]
        .replace(/[-_]/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase());
      resolveResult = { name: fallbackName };
    }

    // Link to existing sender or create new one
    let sender: ProjectSender;
    if (resolveResult.existing_sender_id) {
      // Verify the sender exists
      const existing = existingSenders.find((s) => s.id === resolveResult!.existing_sender_id);
      if (existing) {
        sender = existing;
      } else {
        // ID doesn't match — try finding by name
        const byName = await findSenderByName(projectId, resolveResult.name);
        if (byName) {
          sender = byName;
        } else {
          sender = await createProjectSender({
            projectId,
            name: resolveResult.name,
            website: resolveResult.website,
            description: resolveResult.description,
            logo_url: resolveResult.logo_url,
            country: resolveResult.country,
          });
        }
      }
    } else {
      // Check if sender already exists by name
      const byName = await findSenderByName(projectId, resolveResult.name);
      if (byName) {
        sender = byName;
      } else {
        sender = await createProjectSender({
          projectId,
          name: resolveResult.name,
          website: resolveResult.website,
          description: resolveResult.description,
          logo_url: resolveResult.logo_url,
          country: resolveResult.country,
        });
      }
    }

    await linkDomainToSender(domainId, sender.id);

    // Broadcast to connected clients
    broadcast(projectId, {
      type: "sender:resolved",
      domainId,
      senderId: sender.id,
      sender: {
        id: sender.id,
        name: sender.name,
        website: sender.website,
        description: sender.description,
        logo_url: sender.logo_url,
        country: sender.country,
      },
    });

    console.log(`[senderResolver] Resolved ${domain} → "${sender.name}"`);
  } catch (err: any) {
    console.error(`[senderResolver] Failed to resolve ${domain}:`, err);
    await setDomainResolverResult(domainId, "failed", err.message || "Unknown error");
  }
}

// --- Bulk resolution ---

export async function resolveAllPendingDomains(
  projectId: string,
  concurrency = 3
): Promise<{ total: number; resolved: number; failed: number }> {
  // Reset failed domains back to pending so they get retried
  await resetFailedDomains(projectId);

  const pending = await listPendingDomains(projectId, ["pending"]);
  if (!pending.length) return { total: 0, resolved: 0, failed: 0 };

  let resolved = 0;
  let failed = 0;

  // Process in batches of `concurrency`
  for (let i = 0; i < pending.length; i += concurrency) {
    const batch = pending.slice(i, i + concurrency);
    const results = await Promise.allSettled(
      batch.map(async (domain) => {
        const latestEmail = await getLatestEmailForDomain(projectId, domain.domain);
        await triggerSenderResolution(projectId, domain.id, domain.domain, {
          fromAddress: latestEmail?.from_address || "",
          subject: latestEmail?.subject || "",
          bodyExcerpt: (latestEmail?.body_text || "").slice(0, 1000),
        });
      })
    );

    for (const result of results) {
      if (result.status === "fulfilled") resolved++;
      else failed++;
    }
  }

  return { total: pending.length, resolved, failed };
}

async function resetFailedDomains(projectId: string): Promise<void> {
  await supabaseAdmin
    .from("email_domains")
    .update({ resolver_status: "pending", resolver_error: null })
    .eq("project_id", projectId)
    .eq("resolver_status", "failed");
}
