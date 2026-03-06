import { useEffect, useMemo, useState } from "react";
import {
  Tray,
  EnvelopeSimple,
  CheckCircle,
  TrendUp,
  GlobeSimple,
  ArrowRight,
  Copy,
  Check,
  CircleNotch,
  Globe,
  ArrowsDownUp,
  XCircle,
} from "@phosphor-icons/react";
import { Card, CardContent } from "@/components/ui/card.js";
import { Button } from "@/components/ui/button.js";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group.js";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.js";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart.js";
import {
  Area,
  AreaChart,
  CartesianGrid,
  XAxis,
  YAxis,
} from "recharts";
import { useProjectId } from "../store/StoreContext.js";
import { useAuth } from "../context/AuthContext.js";
import { api } from "../lib/api.js";
import { TAG_COLORS } from "../lib/presets.js";
import { Logo } from "./Logo.js";
import type { NavItem } from "./AppSidebar.js";
import { ContentBreakdownCard, type BreakdownItem, type BreakdownSection } from "./ContentBreakdownCard.js";

// --- Countries ---

const COUNTRIES: Record<string, { name: string; flag: string }> = {
  US: { name: "United States", flag: "🇺🇸" },
  GB: { name: "United Kingdom", flag: "🇬🇧" },
  CA: { name: "Canada", flag: "🇨🇦" },
  AU: { name: "Australia", flag: "🇦🇺" },
  DE: { name: "Germany", flag: "🇩🇪" },
  FR: { name: "France", flag: "🇫🇷" },
  IT: { name: "Italy", flag: "🇮🇹" },
  ES: { name: "Spain", flag: "🇪🇸" },
  NL: { name: "Netherlands", flag: "🇳🇱" },
  SE: { name: "Sweden", flag: "🇸🇪" },
  NO: { name: "Norway", flag: "🇳🇴" },
  DK: { name: "Denmark", flag: "🇩🇰" },
  FI: { name: "Finland", flag: "🇫🇮" },
  CH: { name: "Switzerland", flag: "🇨🇭" },
  AT: { name: "Austria", flag: "🇦🇹" },
  BE: { name: "Belgium", flag: "🇧🇪" },
  PT: { name: "Portugal", flag: "🇵🇹" },
  IE: { name: "Ireland", flag: "🇮🇪" },
  PL: { name: "Poland", flag: "🇵🇱" },
  CZ: { name: "Czech Republic", flag: "🇨🇿" },
  JP: { name: "Japan", flag: "🇯🇵" },
  KR: { name: "South Korea", flag: "🇰🇷" },
  CN: { name: "China", flag: "🇨🇳" },
  IN: { name: "India", flag: "🇮🇳" },
  SG: { name: "Singapore", flag: "🇸🇬" },
  HK: { name: "Hong Kong", flag: "🇭🇰" },
  TW: { name: "Taiwan", flag: "🇹🇼" },
  IL: { name: "Israel", flag: "🇮🇱" },
  AE: { name: "UAE", flag: "🇦🇪" },
  SA: { name: "Saudi Arabia", flag: "🇸🇦" },
  BR: { name: "Brazil", flag: "🇧🇷" },
  MX: { name: "Mexico", flag: "🇲🇽" },
  AR: { name: "Argentina", flag: "🇦🇷" },
  CO: { name: "Colombia", flag: "🇨🇴" },
  CL: { name: "Chile", flag: "🇨🇱" },
  ZA: { name: "South Africa", flag: "🇿🇦" },
  NG: { name: "Nigeria", flag: "🇳🇬" },
  EG: { name: "Egypt", flag: "🇪🇬" },
  KE: { name: "Kenya", flag: "🇰🇪" },
  NZ: { name: "New Zealand", flag: "🇳🇿" },
  RU: { name: "Russia", flag: "🇷🇺" },
  UA: { name: "Ukraine", flag: "🇺🇦" },
  TR: { name: "Turkey", flag: "🇹🇷" },
  TH: { name: "Thailand", flag: "🇹🇭" },
  VN: { name: "Vietnam", flag: "🇻🇳" },
  MY: { name: "Malaysia", flag: "🇲🇾" },
  PH: { name: "Philippines", flag: "🇵🇭" },
  ID: { name: "Indonesia", flag: "🇮🇩" },
  RO: { name: "Romania", flag: "🇷🇴" },
  GR: { name: "Greece", flag: "🇬🇷" },
  HU: { name: "Hungary", flag: "🇭🇺" },
};

function countryLabel(code: string): string {
  const c = COUNTRIES[code];
  return c ? `${c.flag} ${c.name}` : code;
}

// --- Types ---

interface DashboardStats {
  kpis: { total: number; unread: number; processed: number; failed: number; sender_count: number };
  tag_daily: { date: string; tag_id: string; tag_name: string; tag_color: string; count: number }[];
  category_breakdowns: {
    category_id: string;
    category_name: string;
    category_label: string;
    category_order: number;
    value_id: string;
    value_label: string;
    color: string;
    count: number;
  }[];
  daily_volume: { date: string; count: number }[];
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

// --- Date range ---

type DateRange = "7" | "14" | "30" | "90";

const DATE_RANGES: { value: DateRange; label: string }[] = [
  { value: "7", label: "7D" },
  { value: "14", label: "14D" },
  { value: "30", label: "30D" },
  { value: "90", label: "90D" },
];

// --- Helpers ---

function formatRelative(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function dayLabel(dateStr: string) {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function dateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateRangeLabel(startDate: string, endDate: string) {
  if (startDate === endDate) return dayLabel(startDate);

  const start = new Date(startDate + "T00:00:00");
  const end = new Date(endDate + "T00:00:00");

  if (start.getFullYear() !== end.getFullYear()) {
    return `${start.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })} - ${end.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;
  }

  if (start.getMonth() !== end.getMonth()) {
    return `${dayLabel(startDate)} - ${dayLabel(endDate)}`;
  }

  return `${start.toLocaleDateString(undefined, { month: "short", day: "numeric" })} - ${end.toLocaleDateString(undefined, { day: "numeric" })}`;
}

function weekdayLabel(dateStr: string) {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString(undefined, { weekday: "short" });
}

function sortBreakdownItems(items: BreakdownItem[]) {
  return [...items].sort((a, b) => {
    const aSpecial = a.id === "_untagged" || a.id === "_unclassified";
    const bSpecial = b.id === "_untagged" || b.id === "_unclassified";
    if (aSpecial !== bSpecial) return aSpecial ? 1 : -1;
    if (b.count !== a.count) return b.count - a.count;
    return a.label.localeCompare(b.label);
  });
}

function isHexColor(value: string | null | undefined): value is string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value.trim());
}

function buildCategorySections(
  categoryBreakdowns: DashboardStats["category_breakdowns"],
  totalEmails: number
): BreakdownSection[] {
  const groups = new Map<
    string,
    {
      title: string;
      order: number;
      items: BreakdownItem[];
    }
  >();

  for (const row of categoryBreakdowns) {
    const existing = groups.get(row.category_id);
    const item: BreakdownItem = {
      id: row.value_id,
      label: row.value_label,
      color: row.color,
      count: Number(row.count),
    };
    if (existing) {
      existing.items.push(item);
    } else {
      groups.set(row.category_id, {
        title: row.category_label || row.category_name,
        order: Number(row.category_order),
        items: [item],
      });
    }
  }

  return Array.from(groups.entries())
    .sort((a, b) => a[1].order - b[1].order || a[1].title.localeCompare(b[1].title))
    .map(([id, group]) => {
      const items = sortBreakdownItems(group.items).map((item, index) => ({
        ...item,
        color:
          item.id === "_unclassified"
            ? (isHexColor(item.color) ? item.color : "#94a3b8")
            : (isHexColor(item.color) ? item.color : TAG_COLORS[index % TAG_COLORS.length]),
      }));
      const unclassified = items.find((item) => item.id === "_unclassified")?.count ?? 0;
      return {
        id,
        title: group.title,
        subtitle: "Category",
        items,
        stats: [
          { label: "Classified", value: Math.max(totalEmails - unclassified, 0) },
          { label: "Unclassified", value: unclassified },
        ],
      };
    });
}

function buildTagSection(
  tagDaily: DashboardStats["tag_daily"],
  totalEmails: number
): BreakdownSection | null {
  const tagCounts = new Map<string, BreakdownItem>();
  for (const row of tagDaily) {
    const existing = tagCounts.get(row.tag_id);
    if (existing) {
      existing.count += Number(row.count);
    } else {
      tagCounts.set(row.tag_id, {
        id: row.tag_id,
        label: row.tag_name,
        color: row.tag_color,
        count: Number(row.count),
      });
    }
  }

  const items = sortBreakdownItems(Array.from(tagCounts.values()));
  if (items.length === 0) return null;

  const untagged = items.find((item) => item.id === "_untagged")?.count ?? 0;
  return {
    id: "tags",
    title: "Tags",
    subtitle: "Applied labels",
    items,
    stats: [
      { label: "Tagged", value: Math.max(totalEmails - untagged, 0) },
      { label: "Untagged", value: untagged },
    ],
    note: "Tag counts are raw applications, so one email can appear under multiple tags.",
  };
}

// --- Components ---

function KpiCard({
  label,
  value,
  icon: Icon,
  subtitle,
}: {
  label: string;
  value: string | number;
  icon: typeof EnvelopeSimple;
  subtitle?: string;
}) {
  return (
    <Card className="border-border/60 shadow-sm overflow-hidden group">
      <CardContent className="p-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">{label}</p>
            <p className="text-2xl font-bold text-foreground tabular-nums mt-1 tracking-tight">
              {value}
            </p>
            {subtitle && (
              <p className="text-[10px] font-medium text-muted-foreground/40 mt-1 uppercase tracking-wide">
                {subtitle}
              </p>
            )}
          </div>
          <div className="w-10 h-10 rounded-xl bg-primary/5 border border-primary/10 flex items-center justify-center group-hover:bg-primary/10 transition-colors">
            <Icon size={20} className="text-primary opacity-80" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function VolumeChart({
  dailyVolume,
  days,
}: {
  dailyVolume: DashboardStats["daily_volume"];
  days: number;
}) {
  const useWeeklyBuckets = days >= 30;
  const data = useMemo(() => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const buckets: { key: string; label: string; count: number; rangeLabel: string }[] = [];
    const countsByDate = new Map(
      (dailyVolume ?? []).map((row) => [
        typeof row.date === "string" ? row.date.slice(0, 10) : row.date,
        Number(row.count),
      ])
    );

    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const key = dateKey(d);
      buckets.push({
        key,
        label: dayLabel(key),
        count: countsByDate.get(key) ?? 0,
        rangeLabel: dayLabel(key),
      });
    }

    if (!useWeeklyBuckets) return buckets;

    const weeklyBuckets: { key: string; label: string; count: number; rangeLabel: string }[] = [];
    for (let end = buckets.length; end > 0; end -= 7) {
      const start = Math.max(0, end - 7);
      const slice = buckets.slice(start, end);
      const startKey = slice[0].key;
      const endKey = slice[slice.length - 1].key;
      weeklyBuckets.unshift({
        key: endKey,
        label: dayLabel(endKey),
        count: slice.reduce((sum, bucket) => sum + bucket.count, 0),
        rangeLabel: dateRangeLabel(startKey, endKey),
      });
    }

    return weeklyBuckets;
  }, [dailyVolume, days, useWeeklyBuckets]);

  const config: ChartConfig = {
    count: { label: "Emails", color: "var(--color-primary)" },
  };

  return (
    <Card className="border-border/60">
      <CardContent className="p-5">
        <h3 className="text-sm font-bold text-foreground">Frequency</h3>
        <p className="text-[10px] uppercase font-bold tracking-widest text-muted-foreground/60 mb-6">
          {useWeeklyBuckets ? "Weekly volume over time" : "Daily volume over time"}
        </p>
        <ChartContainer config={config} className="aspect-[4/1] w-full">
          <AreaChart
            data={data}
            margin={{ top: 10, right: 10, bottom: 0, left: -20 }}
          >
            <defs>
              <linearGradient id="vol-gradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--color-primary)" stopOpacity={0.3} />
                <stop offset="95%" stopColor="var(--color-primary)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.1} />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              interval="preserveStartEnd"
              fontSize={10}
              className="font-bold opacity-40 uppercase tracking-tighter"
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              tickMargin={4}
              fontSize={10}
              className="font-bold opacity-40"
              allowDecimals={false}
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  indicator="line"
                  labelFormatter={(_, payload) => payload?.[0]?.payload?.rangeLabel ?? ""}
                />
              }
            />
            <Area
              dataKey="count"
              type="monotone"
              fill="url(#vol-gradient)"
              stroke="var(--color-primary)"
              strokeWidth={2}
              dot={false}
            />
          </AreaChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}

function BreakdownCard({
  tagDaily,
  categoryBreakdowns,
  totalEmails,
}: {
  tagDaily: DashboardStats["tag_daily"];
  categoryBreakdowns: DashboardStats["category_breakdowns"];
  totalEmails: number;
}) {
  const sections = useMemo(() => {
    const nextSections = buildCategorySections(categoryBreakdowns, totalEmails);
    const tagSection = buildTagSection(tagDaily, totalEmails);
    if (tagSection) nextSections.push(tagSection);
    return nextSections;
  }, [categoryBreakdowns, tagDaily, totalEmails]);

  return (
    <ContentBreakdownCard
      heading="Distribution"
      subtitle="Categories and tags as available"
      emptyMessage="No categories or tags yet"
      sections={sections}
      itemLimit={6}
    />
  );
}

function ActivityGrid({
  activityGrid,
}: {
  activityGrid: DashboardStats["activity_grid"];
}) {
  const { grid, maxCount } = useMemo(() => {
    const weeks = 7;
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dayOfWeek = today.getDay();
    const startDate = new Date(today);
    startDate.setDate(startDate.getDate() - dayOfWeek - (weeks - 1) * 7);

    const countMap = new Map<string, number>();
    for (const entry of activityGrid) {
      const key = typeof entry.date === "string" ? entry.date.slice(0, 10) : entry.date;
      countMap.set(key, Number(entry.count));
    }

    const result: { date: string; count: number; weekday: string }[][] = [];
    let max = 0;
    const d = new Date(startDate);
    for (let w = 0; w < weeks; w++) {
      const week: { date: string; count: number; weekday: string }[] = [];
      for (let dow = 0; dow < 7; dow++) {
        const key = d.toISOString().slice(0, 10);
        const count = countMap.get(key) || 0;
        if (count > max) max = count;
        const isFuture = d > now;
        week.push({
          date: key,
          count: isFuture ? -1 : count,
          weekday: weekdayLabel(key),
        });
        d.setDate(d.getDate() + 1);
      }
      result.push(week);
    }
    return { grid: result, maxCount: max };
  }, [activityGrid]);

  function intensity(count: number): string {
    if (count < 0) return "transparent";
    if (count === 0) return "var(--color-muted)";
    const level = maxCount > 0 ? Math.min(count / maxCount, 1) : 0;
    if (level <= 0.25) return "oklch(var(--primary) / 0.2)";
    if (level <= 0.5) return "oklch(var(--primary) / 0.4)";
    if (level <= 0.75) return "oklch(var(--primary) / 0.7)";
    return "oklch(var(--primary))";
  }

  const dayLabels = ["", "Mon", "", "Wed", "", "Fri", ""];

  return (
    <Card className="border-border/60">
      <CardContent className="p-5">
        <div className="mb-6">
          <h3 className="text-sm font-bold text-foreground">Density</h3>
          <p className="text-[10px] uppercase font-bold tracking-widest text-muted-foreground/60">Daily Volume</p>
        </div>
        <div className="flex gap-1.5">
          <div className="flex flex-col gap-1 pr-1">
            {dayLabels.map((l, i) => (
              <div
                key={i}
                className="h-3 text-[8px] font-bold uppercase tracking-tighter leading-3 text-muted-foreground/40 flex items-center"
              >
                {l}
              </div>
            ))}
          </div>
          {grid.map((week, wi) => (
            <div key={wi} className="flex flex-col gap-1">
              {week.map((day) => (
                <div
                  key={day.date}
                  className="w-3 h-3 rounded-[2px] border-[0.5px] border-border/5"
                  style={{ backgroundColor: intensity(day.count) }}
                  title={`${dayLabel(day.date)}: ${day.count < 0 ? "\u2014" : day.count} email${day.count === 1 ? "" : "s"}`}
                />
              ))}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function TopDomains({
  domains,
  onNavigate,
}: {
  domains: DashboardStats["top_domains"];
  onNavigate: (item: NavItem, path?: string) => void;
}) {
  return (
    <Card className="flex flex-col border-border/60">
      <CardContent className="p-5 flex-1 flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-bold text-foreground">
              Senders
            </h3>
            <p className="text-[10px] uppercase font-bold tracking-widest text-muted-foreground/60">Top Domains</p>
          </div>
          <button
            onClick={() => onNavigate("senders")}
            className="h-6 px-2 rounded-md bg-muted/50 hover:bg-muted text-[10px] font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-all flex items-center gap-1.5"
          >
            All
            <ArrowRight size={10} weight="bold" />
          </button>
        </div>
        {domains.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            <p className="text-xs italic opacity-40 uppercase tracking-widest">No activity</p>
          </div>
        ) : (
          <div className="space-y-1">
            {domains.map((d) => (
              <button
                key={d.domain}
                onClick={() => onNavigate("senders")}
                className="flex items-center gap-3 w-full text-left rounded-lg px-2 py-2 hover:bg-muted/50 transition-colors group"
              >
                <div className="w-8 h-8 rounded-lg bg-primary/5 border border-primary/10 flex items-center justify-center shrink-0 group-hover:bg-primary/10 transition-colors">
                  <GlobeSimple
                    size={14}
                    className="text-primary opacity-70"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-foreground truncate group-hover:text-primary transition-colors">
                    {d.domain}
                  </p>
                  <p className="text-[10px] font-medium text-muted-foreground/60">
                    {formatRelative(d.latest_date)}
                  </p>
                </div>
                <span className="text-sm tabular-nums font-bold text-foreground shrink-0">
                  {d.count}
                </span>
              </button>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function RecentEmails({
  emails,
  onNavigate,
}: {
  emails: DashboardStats["recent_emails"];
  onNavigate: (item: NavItem, path?: string) => void;
}) {
  return (
    <Card className="flex flex-col border-border/60">
      <CardContent className="p-5 flex-1 flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-bold text-foreground">
              Recent
            </h3>
            <p className="text-[10px] uppercase font-bold tracking-widest text-muted-foreground/60">Incoming Stream</p>
          </div>
          <button
            onClick={() => onNavigate("inbox")}
            className="h-6 px-2 rounded-md bg-muted/50 hover:bg-muted text-[10px] font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-all flex items-center gap-1.5"
          >
            Inbox
            <ArrowRight size={10} weight="bold" />
          </button>
        </div>
        {emails.length === 0 ? (
          <div className="text-center py-8 flex-1 flex flex-col items-center justify-center">
            <Tray
              size={32}
              weight="duotone"
              className="mx-auto mb-2 text-muted-foreground opacity-20"
            />
            <p className="text-xs italic opacity-40 uppercase tracking-widest">No recent emails</p>
          </div>
        ) : (
          <div className="space-y-1">
            {emails.map((e) => (
              <button
                key={e.id}
                onClick={() =>
                  onNavigate("inbox", `/app/inbox?email=${e.id}`)
                }
                className="flex items-start gap-3 w-full text-left rounded-lg px-2 py-2.5 hover:bg-muted/50 transition-colors group"
              >
                <div className="mt-1.5 shrink-0">
                  {e.read_at == null ? (
                    <span className="block w-2 h-2 rounded-full bg-primary" />
                  ) : e.status === "processing" ? (
                    <span className="block w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                  ) : e.status === "failed" ? (
                    <span className="block w-2 h-2 rounded-full bg-red-400" />
                  ) : (
                    <span className="block w-2 h-2 rounded-full bg-green-400" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-foreground truncate group-hover:text-primary transition-colors">
                    {e.subject || "(no subject)"}
                  </p>
                  <div className="flex items-center gap-2">
                    <p className="text-[11px] text-muted-foreground truncate">
                      {e.from_address}
                    </p>
                    <span className="text-[10px] font-medium text-muted-foreground/40 shrink-0 uppercase tracking-tighter">
                      {formatRelative(e.created_at)}
                    </span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// --- Empty state ---

function EmptyDashboard({
  onNavigate,
}: {
  onNavigate: (item: NavItem, path?: string) => void;
}) {
  const { session } = useAuth();
  const projectId = useProjectId();
  const [projectEmail, setProjectEmail] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!session?.access_token) return;
    fetch(`/api/projects/${projectId}/email`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
      .then((r) => r.json())
      .then((data) => setProjectEmail(data.email ?? null))
      .catch(() => setProjectEmail(null));
  }, [projectId, session?.access_token]);

  const copyEmail = () => {
    if (!projectEmail) return;
    navigator.clipboard.writeText(projectEmail);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex-1 flex items-center justify-center p-6 bg-background">
      <div className="max-w-lg w-full text-center">
        <Logo className="h-16 w-auto mx-auto mb-6 opacity-80" />
        <h1 className="text-3xl font-bold text-foreground tracking-tight">
          Welcome to Peckmail
        </h1>
        <p className="text-muted-foreground mt-3 text-sm leading-relaxed max-w-sm mx-auto">
          Forward your favorite newsletters to your unique address to
          unlock automated insights and deep inbox analytics.
        </p>

        {projectEmail && (
          <div className="mt-10">
            <p className="text-[10px] font-bold text-muted-foreground/60 uppercase tracking-[0.2em] mb-4">
              Your Workspace Email
            </p>
            <button
              onClick={copyEmail}
              className="group inline-flex items-center gap-4 bg-muted/40 hover:bg-muted/60 border border-border/60 rounded-2xl px-6 py-5 transition-all w-full max-w-md mx-auto shadow-sm"
            >
              <EnvelopeSimple
                size={24}
                className="text-primary shrink-0 opacity-80"
              />
              <code className="text-base font-mono font-bold text-foreground truncate flex-1 text-left tracking-tight">
                {projectEmail}
              </code>
              {copied ? (
                <Check
                  size={18}
                  className="text-green-500 shrink-0"
                />
              ) : (
                <Copy
                  size={18}
                  className="text-muted-foreground/40 group-hover:text-foreground shrink-0 transition-colors"
                />
              )}
            </button>
            <p className="text-[10px] font-bold text-muted-foreground/40 mt-3 uppercase tracking-wider">
              Click to copy address
            </p>
          </div>
        )}

        <div className="mt-12 grid grid-cols-1 sm:grid-cols-3 gap-5 text-left">
          {[
            { icon: EnvelopeSimple, title: "Subscribe", desc: "Use your address for newsletter signups" },
            { icon: Tray, title: "Receive", desc: "Emails arrive and get auto-tagged by AI" },
            { icon: TrendUp, title: "Analyze", desc: "Track trends and senders across time" }
          ].map((item, i) => (
            <div key={i} className="rounded-xl border border-border/60 bg-card p-5 shadow-sm">
              <div className="w-8 h-8 rounded-lg bg-primary/5 border border-primary/10 flex items-center justify-center mb-4">
                <item.icon size={16} className="text-primary opacity-80" />
              </div>
              <p className="text-sm font-bold text-foreground">{item.title}</p>
              <p className="text-[11px] leading-relaxed text-muted-foreground mt-1.5 font-medium opacity-80">
                {item.desc}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function MultiCountrySelector({
  availableCountries,
  selectedCountries,
  onChange,
}: {
  availableCountries: string[];
  selectedCountries: string[];
  onChange: (codes: string[]) => void;
}) {
  const toggleCountry = (code: string) => {
    if (selectedCountries.includes(code)) {
      onChange(selectedCountries.filter((c) => c !== code));
    } else {
      onChange([...selectedCountries, code]);
    }
  };

  const label =
    selectedCountries.length === 0
      ? "Global View"
      : selectedCountries.length === 1
      ? countryLabel(selectedCountries[0])
      : `${selectedCountries.length} Countries`;

  return (
    <div className="flex items-center gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs border-transparent bg-muted/30 shadow-none px-3 gap-2 hover:bg-muted/50"
          >
            <Globe size={13} className="text-muted-foreground/60" />
            {label}
            <ArrowsDownUp size={10} className="ml-1 opacity-40" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-[200px]">
          <DropdownMenuLabel className="text-[10px] uppercase tracking-widest opacity-50">Filter by Origin</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuCheckboxItem
            checked={selectedCountries.length === 0}
            onCheckedChange={() => onChange([])}
            className="text-xs"
          >
            All Countries
          </DropdownMenuCheckboxItem>
          <DropdownMenuSeparator />
          <div className="max-h-[300px] overflow-y-auto">
            {availableCountries.sort().map((code) => (
              <DropdownMenuCheckboxItem
                key={code}
                checked={selectedCountries.includes(code)}
                onCheckedChange={() => toggleCountry(code)}
                className="text-xs"
              >
                {countryLabel(code)}
              </DropdownMenuCheckboxItem>
            ))}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
      
      {selectedCountries.length > 0 && (
        <button
          onClick={() => onChange([])}
          className="text-muted-foreground/40 hover:text-foreground transition-colors p-1"
          title="Clear all filters"
        >
          <XCircle size={14} weight="fill" />
        </button>
      )}
    </div>
  );
}

// --- Main ---

export function DashboardView({
  onNavigate,
}: {
  onNavigate: (item: NavItem, path?: string) => void;
}) {
  const projectId = useProjectId();
  const [range, setRange] = useState<DateRange>("14");
  const [selectedCountries, setSelectedCountries] = useState<string[]>([]);
  const [data, setData] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    
    let url = `/api/projects/${projectId}/dashboard?days=${range}`;
    selectedCountries.forEach(c => {
      url += `&country=${c}`;
    });

    api
      .get<DashboardStats>(url)
      .then((stats) => {
        if (!cancelled) {
          setData(stats);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, range, selectedCountries]);

  if (loading && !data) {
    return (
      <div className="flex-1 overflow-y-auto p-6 bg-background">
        <div className="max-w-5xl mx-auto space-y-8">
          <div className="flex flex-col gap-1 border-b border-border/40 pb-6">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Dashboard</h1>
            <p className="text-sm text-muted-foreground mt-1">Calculating stats and trends...</p>
          </div>
          <div className="flex items-center justify-center py-24 bg-card border border-border/60 rounded-xl shadow-sm">
            <CircleNotch size={24} className="animate-spin text-muted-foreground" />
          </div>
        </div>
      </div>
    );
  }

  if (!data || (data.kpis.total === 0 && selectedCountries.length === 0)) {
    return <EmptyDashboard onNavigate={onNavigate} />;
  }

  const { kpis } = data;
  const daysNum = parseInt(range);
  const senderCount = kpis.sender_count;
  const weeksInRange = daysNum / 7;
  const avgPerSender =
    weeksInRange > 0 && senderCount > 0
      ? (kpis.total / senderCount / weeksInRange).toFixed(1)
      : "0";
  const avgPerSenderSubtitle =
    senderCount > 0
      ? `PER WEEK / ${senderCount} ACTIVE ${senderCount === 1 ? "SENDER" : "SENDERS"}`
      : "NO ACTIVE SENDERS";

  return (
    <div className="flex-1 overflow-y-auto p-6 bg-background">
      <div className="max-w-5xl mx-auto space-y-8">
        {/* Page Header */}
        <div className="flex flex-col gap-1 border-b border-border/40 pb-6">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              Dashboard
            </h1>
            <div className="flex items-center gap-3">
              {/* Multi-Country Selector */}
              {data.countries && data.countries.length > 0 && (
                <MultiCountrySelector
                  availableCountries={data.countries}
                  selectedCountries={selectedCountries}
                  onChange={setSelectedCountries}
                />
              )}

              {/* Timeframe Selector */}
              <div className="flex items-center gap-1.5 bg-muted/30 p-1 rounded-lg border border-border/40">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground px-1.5 opacity-50">View</span>
                <ToggleGroup
                  type="single"
                  value={range}
                  onValueChange={(v) => v && setRange(v as DateRange)}
                  className="h-6"
                >
                  {DATE_RANGES.map((r) => (
                    <ToggleGroupItem
                      key={r.value}
                      value={r.value}
                      className="h-6 px-2 text-[10px] font-bold min-w-0 data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-sm"
                    >
                      {r.label}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </div>
            </div>
          </div>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Overview of your inbox volume, content breakdowns, and recent activity{" "}
            {selectedCountries.length > 0
              ? `from ${selectedCountries.length} selected countries`
              : "globally"}.
          </p>
        </div>

        {/* KPI row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <KpiCard
            label="Total emails"
            value={kpis.total}
            icon={EnvelopeSimple}
            subtitle={`L${range}D VOLUME`}
          />
          <KpiCard label="Unread" value={kpis.unread} icon={Tray} subtitle={`L${range}D UNREAD`} />
          <KpiCard
            label="Processed"
            value={kpis.processed}
            icon={CheckCircle}
            subtitle={`L${range}D PROCESSED`}
          />
          <KpiCard
            label="Avg / sender / wk"
            value={avgPerSender}
            icon={TrendUp}
            subtitle={avgPerSenderSubtitle}
          />
        </div>

        {/* Activity Section */}
        <VolumeChart dailyVolume={data.daily_volume} days={daysNum} />

        {/* Details Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <BreakdownCard
            tagDaily={data.tag_daily}
            categoryBreakdowns={data.category_breakdowns ?? []}
            totalEmails={kpis.total}
          />
          <RecentEmails emails={data.recent_emails} onNavigate={onNavigate} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 pb-12">
          <ActivityGrid activityGrid={data.activity_grid} />
          <TopDomains domains={data.top_domains} onNavigate={onNavigate} />
        </div>
      </div>
    </div>
  );
}
