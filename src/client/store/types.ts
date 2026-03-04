export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolUse?: Array<{ tool: string; input: any }>;
}

export interface ChatSession {
  id: string;
  title: string;
  updatedAt: string;
}

export interface EmailTagSummary {
  id: string;
  name: string;
  color: string;
}

export interface IncomingEmail {
  id: string;
  from_address: string;
  from_domain?: string | null;
  subject: string | null;
  status: "received" | "processing" | "processed" | "failed";
  error: string | null;
  created_at: string;
  read_at?: string | null;
  summary?: string | null;
  tags?: EmailTagSummary[];
  extraction_data?: Record<string, any> | null;
}

export interface Sender {
  id: string;
  name: string;
  website: string | null;
  description: string | null;
  logo_url: string | null;
  country: string | null;
  domain_count: number;
  email_count: number;
  created_at: string;
}

export interface SenderStats {
  sparkline: number[];
}

export interface PricingSnapshot {
  currency?: string;
  cheapest_product?: { name: string | null; price: number };
  most_expensive_product?: { name: string | null; price: number };
  deepest_discount_pct?: number;
}

export interface SenderProfileData {
  id: string;
  sender_id: string;
  profile: {
    company_profile?: string;
    industry?: string;
    tags?: string[];
    target_audiences?: string;
    product_portfolio?: string;
    top_products?: string[];
    ongoing_sales?: string;
    pricing_snapshot?: PricingSnapshot;
    pricing_strategy?: string;
    marketing_approach?: string;
    strengths?: string;
    weaknesses?: string;
    recommendations?: string;
  };
  source_urls: string[];
  model: string;
  generated_at: string;
}

export interface EmailExtraction {
  id: string;
  email_id: string;
  category: string | null;
  data: Record<string, any>;
  extracted_at: string;
}

export interface EmailExtractor {
  id: string;
  kind: "category" | "extractor";
  name: string;
  label: string;
  description: string;
  value_type: "text" | "text_array" | "number" | "boolean" | "enum";
  enum_values: string[];
  enum_colors: string[];
  required: boolean;
  sort_order: number;
  enabled: boolean;
}

export interface EmailFlow {
  name: string;
  detected: boolean;
  email_count: number;
  description: string;
}

export interface StrategyCadence {
  avg_per_week: number;
  consistency_score: number;
  peak_days: string[];
  peak_hours: number[];
  pattern: string;
}

export interface StrategyDiscount {
  avg_discount_pct: number;
  max_discount_pct: number;
  frequency: string;
  tactics: string;
}

export interface StrategyContentMix {
  [key: string]: number;
}

export interface StrategyContent {
  primary_tone: string;
  content_mix: StrategyContentMix;
  personalization_usage: string;
  key_themes: string[];
}

export interface StrategySubjectAnalysis {
  avg_length: number;
  emoji_pct: number;
  urgency_pct: number;
  personalization_pct: number;
  common_patterns: string[];
  top_urgency_words: string[];
}

export interface StrategyFunnel {
  awareness: number;
  consideration: number;
  conversion: number;
  retention: number;
}

export interface SenderStrategyData {
  id: string;
  sender_id: string;
  strategy: {
    executive_summary?: string;
    email_flows?: EmailFlow[];
    cadence?: StrategyCadence;
    promotional_calendar?: string;
    discount_strategy?: StrategyDiscount;
    content_strategy?: StrategyContent;
    subject_line_analysis?: StrategySubjectAnalysis;
    segmentation_signals?: string;
    ab_testing_signals?: string;
    funnel_mapping?: StrategyFunnel;
    competitive_insights?: string;
    recommendations?: string[];
  };
  email_count: number;
  date_range_start: string | null;
  date_range_end: string | null;
  model: string;
  generated_at: string;
}

export interface StoreState {
  projectId: string;
  projectName: string;
  connected: boolean;
  chatSessions: ChatSession[];
  currentSessionId: string | null;
  chatMessages: ChatMessage[];
  chatStreaming: boolean;
  chatError: string | null;
  chatPrompt: string | null;
  incomingEmails: IncomingEmail[];
  hasMoreEmails: boolean;
  loadingMoreEmails: boolean;
}

export type StoreAction =
  // Connection
  | { type: "ws:connected" }
  | { type: "ws:disconnected" }
  // Chat
  | { type: "chat:set-sessions"; sessions: ChatSession[] }
  | { type: "chat:load-session"; sessionId: string }
  | { type: "chat:set-messages"; messages: ChatMessage[] }
  | { type: "chat:send"; sessionId: string; message: string; thinking?: boolean }
  | { type: "chat:new-session" }
  | { type: "chat:delete-session"; sessionId: string }
  | { type: "chat:delta"; sessionId: string; text: string }
  | { type: "chat:tool-use"; sessionId: string; tool: string; input: any }
  | { type: "chat:done"; sessionId: string; title: string }
  | { type: "chat:error"; sessionId: string; error: string }
  | { type: "chat:streaming"; streaming: boolean }
  | { type: "chat:prompt"; message: string }
  | { type: "chat:prompt-clear" };
