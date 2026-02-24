import type { Icon } from "@phosphor-icons/react";
import {
  ShoppingCart,
  Sparkle,
  Code,
  Newspaper,
  EnvelopeSimple,
  PencilSimple,
} from "@phosphor-icons/react";

export const TAG_COLORS = [
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#06b6d4",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
  "#94a3b8",
];

export interface PresetTag {
  name: string;
  color: string;
  condition: string;
}

export interface IndustryPreset {
  id: string;
  name: string;
  description: string;
  icon: Icon;
  tags: PresetTag[];
}

export const INDUSTRY_PRESETS: IndustryPreset[] = [
  {
    id: "ecommerce",
    name: "E-Commerce",
    description: "Online stores and retail brands",
    icon: ShoppingCart,
    tags: [
      { name: "Promotional", color: "#ef4444", condition: "Promotional emails with sales, discounts, or special offers" },
      { name: "Non-promotional", color: "#3b82f6", condition: "Non-promotional emails like updates, tips, or educational content" },
      { name: "Welcome Series", color: "#22c55e", condition: "Welcome or onboarding emails for new subscribers" },
      { name: "Win-back", color: "#f97316", condition: "Win-back or re-engagement emails targeting inactive customers" },
      { name: "Seasonal", color: "#eab308", condition: "Seasonal or holiday-themed campaign emails" },
      { name: "Product Launch", color: "#8b5cf6", condition: "Product launch or new product announcement emails" },
      { name: "Transactional", color: "#94a3b8", condition: "Transactional emails like order confirmations, shipping updates, or receipts" },
    ],
  },
  {
    id: "beauty",
    name: "Beauty & Fashion",
    description: "Cosmetics, skincare, and apparel",
    icon: Sparkle,
    tags: [
      { name: "Promotional", color: "#ef4444", condition: "Promotional emails with sales, discounts, or limited-time offers" },
      { name: "New Arrivals", color: "#8b5cf6", condition: "Emails showcasing new arrivals, new collections, or just-dropped products" },
      { name: "Seasonal Collections", color: "#eab308", condition: "Seasonal or holiday collection emails" },
      { name: "Loyalty/Rewards", color: "#22c55e", condition: "Loyalty program, rewards, or VIP member emails" },
      { name: "Tutorials", color: "#06b6d4", condition: "Tutorial, how-to, or beauty/styling tip emails" },
      { name: "Brand Story", color: "#ec4899", condition: "Brand story, behind-the-scenes, or founder message emails" },
    ],
  },
  {
    id: "tech",
    name: "Tech / SaaS",
    description: "Software products and developer tools",
    icon: Code,
    tags: [
      { name: "Product Updates", color: "#3b82f6", condition: "Product update, changelog, or release note emails" },
      { name: "Onboarding/Welcome", color: "#22c55e", condition: "Onboarding, welcome, or getting-started emails" },
      { name: "Re-engagement", color: "#f97316", condition: "Re-engagement or win-back emails for inactive users" },
      { name: "Newsletter", color: "#8b5cf6", condition: "Newsletter or digest emails with curated content" },
      { name: "Security/Account", color: "#ef4444", condition: "Security alerts, password resets, or account-related emails" },
      { name: "Feature Announcements", color: "#06b6d4", condition: "New feature announcements or beta invitations" },
    ],
  },
  {
    id: "media",
    name: "Media & Publishing",
    description: "News outlets and content publishers",
    icon: Newspaper,
    tags: [
      { name: "Breaking News", color: "#ef4444", condition: "Breaking news or urgent alert emails" },
      { name: "Daily Digest", color: "#3b82f6", condition: "Daily digest or daily briefing emails" },
      { name: "Weekly Roundup", color: "#8b5cf6", condition: "Weekly roundup or weekly summary emails" },
      { name: "Opinion/Editorial", color: "#f97316", condition: "Opinion, editorial, or commentary emails" },
      { name: "Sponsored", color: "#eab308", condition: "Sponsored content or paid partnership emails" },
      { name: "Events", color: "#22c55e", condition: "Event announcements, webinars, or conference emails" },
    ],
  },
  {
    id: "general",
    name: "General / Newsletter",
    description: "Multi-purpose email workflows",
    icon: EnvelopeSimple,
    tags: [
      { name: "Promotional", color: "#ef4444", condition: "Promotional emails with sales, offers, or marketing content" },
      { name: "Informational", color: "#3b82f6", condition: "Informational or educational content emails" },
      { name: "Transactional", color: "#94a3b8", condition: "Transactional emails like confirmations, receipts, or account updates" },
      { name: "Weekly Digest", color: "#8b5cf6", condition: "Weekly digest or summary emails" },
      { name: "Announcements", color: "#22c55e", condition: "Announcements, updates, or important notices" },
    ],
  },
  {
    id: "custom",
    name: "Custom",
    description: "Start empty, add your own tags",
    icon: PencilSimple,
    tags: [],
  },
];
