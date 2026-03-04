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
} from "@phosphor-icons/react";
import { Card, CardContent } from "@/components/ui/card.js";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
  type ChartConfig,
} from "@/components/ui/chart.js";
import {
  Bar,
  BarChart,
  CartesianGrid,
  XAxis,
  YAxis,
  PieChart,
  Pie,
  Cell,
  Label,
} from "recharts";
import { useProjectId } from "../store/StoreContext.js";
import { useAuth } from "../context/AuthContext.js";
import { api } from "../lib/api.js";
import { Logo } from "./Logo.js";
import type { NavItem } from "./AppSidebar.js";

// --- Types ---

interface DashboardStats {
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
}

// --- Date range ---

type DateRange = "7d" | "14d" | "30d" | "90d";

const DATE_RANGES: { value: DateRange; label: string }[] = [
  { value: "7d", label: "7 days" },
  { value: "14d", label: "14 days" },
  { value: "30d", label: "30 days" },
  { value: "90d", label: "90 days" },
];

function daysFromRange(range: DateRange): number {
  return parseInt(range);
}

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

function weekdayLabel(dateStr: string) {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString(undefined, { weekday: "short" });
}

// --- Components ---

function DateRangeSelector({
  value,
  onChange,
}: {
  value: DateRange;
  onChange: (v: DateRange) => void;
}) {
  return (
    <div className="flex items-center gap-1 bg-muted rounded-lg p-0.5">
      {DATE_RANGES.map((r) => (
        <button
          key={r.value}
          onClick={() => onChange(r.value)}
          className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
            value === r.value
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {r.label}
        </button>
      ))}
    </div>
  );
}

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
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="text-2xl font-bold text-foreground tabular-nums mt-1">
              {value}
            </p>
            {subtitle && (
              <p className="text-xs text-muted-foreground mt-0.5">
                {subtitle}
              </p>
            )}
          </div>
          <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
            <Icon size={18} className="text-primary" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function TagPieChart({
  tagDaily,
}: {
  tagDaily: DashboardStats["tag_daily"];
}) {
  const data = useMemo(() => {
    const tagCounts = new Map<string, { name: string; color: string; count: number }>();
    for (const row of tagDaily) {
      const existing = tagCounts.get(row.tag_id);
      if (existing) {
        existing.count += Number(row.count);
      } else {
        tagCounts.set(row.tag_id, {
          name: row.tag_name,
          color: row.tag_color,
          count: Number(row.count),
        });
      }
    }
    return Array.from(tagCounts.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .map(([id, d]) => ({ id, ...d }));
  }, [tagDaily]);

  const total = data.reduce((sum, d) => sum + d.count, 0);
  const config: ChartConfig = Object.fromEntries(
    data.map((t) => [t.id, { label: t.name, color: t.color }])
  );

  if (data.length === 0) {
    return (
      <Card className="flex flex-col">
        <CardContent className="p-4 flex-1 flex flex-col">
          <h3 className="text-sm font-semibold text-foreground">
            Distribution by tag
          </h3>
          <p className="text-xs text-muted-foreground mb-4">Email breakdown</p>
          <div className="flex items-center justify-center flex-1 text-muted-foreground">
            <p className="text-sm">No tagged emails yet</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="flex flex-col">
      <CardContent className="p-4 flex-1 flex flex-col">
        <h3 className="text-sm font-semibold text-foreground">
          Distribution by tag
        </h3>
        <p className="text-xs text-muted-foreground mb-2">Email breakdown</p>
        <div className="flex-1 flex items-center gap-4">
          <ChartContainer
            config={config}
            className="aspect-square w-[160px] shrink-0"
          >
            <PieChart>
              <ChartTooltip
                content={<ChartTooltipContent nameKey="name" hideLabel />}
              />
              <Pie
                data={data}
                dataKey="count"
                nameKey="name"
                innerRadius={48}
                outerRadius={72}
                strokeWidth={2}
                stroke="var(--color-background)"
              >
                {data.map((entry) => (
                  <Cell key={entry.id} fill={entry.color} />
                ))}
                <Label
                  content={({ viewBox }) => {
                    if (viewBox && "cx" in viewBox && "cy" in viewBox) {
                      return (
                        <text
                          x={viewBox.cx}
                          y={viewBox.cy}
                          textAnchor="middle"
                          dominantBaseline="middle"
                        >
                          <tspan
                            x={viewBox.cx}
                            y={viewBox.cy}
                            className="fill-foreground text-2xl font-bold"
                          >
                            {total}
                          </tspan>
                          <tspan
                            x={viewBox.cx}
                            y={(viewBox.cy || 0) + 18}
                            className="fill-muted-foreground text-[10px]"
                          >
                            emails
                          </tspan>
                        </text>
                      );
                    }
                  }}
                />
              </Pie>
            </PieChart>
          </ChartContainer>
          <div className="flex-1 space-y-1.5 min-w-0">
            {data.map((t) => (
              <div key={t.id} className="flex items-center gap-2">
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: t.color }}
                />
                <span className="text-xs text-foreground truncate flex-1">
                  {t.name}
                </span>
                <span className="text-xs tabular-nums text-muted-foreground shrink-0">
                  {t.count}
                </span>
                <span className="text-[10px] tabular-nums text-muted-foreground shrink-0 w-8 text-right">
                  {total > 0 ? Math.round((t.count / total) * 100) : 0}%
                </span>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function StackedTagBarChart({
  tagDaily,
  days,
}: {
  tagDaily: DashboardStats["tag_daily"];
  days: number;
}) {
  // Derive unique tags from tag_daily
  const tagIds = useMemo(() => {
    const seen = new Map<string, { id: string; name: string; color: string }>();
    for (const row of tagDaily) {
      if (!seen.has(row.tag_id)) {
        seen.set(row.tag_id, { id: row.tag_id, name: row.tag_name, color: row.tag_color });
      }
    }
    return Array.from(seen.values());
  }, [tagDaily]);

  // Build bucketed data from tag_daily rows
  const data = useMemo(() => {
    const now = new Date();
    const bucketByWeek = days > 30;
    const buckets: { key: string; label: string; [tagId: string]: number | string }[] = [];

    if (bucketByWeek) {
      const numWeeks = Math.ceil(days / 7);
      for (let i = numWeeks - 1; i >= 0; i--) {
        const end = new Date(now);
        end.setDate(end.getDate() - i * 7);
        const start = new Date(end);
        start.setDate(start.getDate() - 6);
        const key = start.toISOString().slice(0, 10);
        const label =
          start.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
          "\u2013" +
          end.toLocaleDateString(undefined, { month: "short", day: "numeric" });
        const bucket: any = { key, label };
        for (const t of tagIds) bucket[t.id] = 0;
        buckets.push(bucket);
      }
      for (const row of tagDaily) {
        const rowDate = new Date(row.date + "T00:00:00");
        for (let i = buckets.length - 1; i >= 0; i--) {
          const bStart = new Date(buckets[i].key + "T00:00:00");
          const bEnd = new Date(bStart);
          bEnd.setDate(bEnd.getDate() + 7);
          if (rowDate >= bStart && rowDate < bEnd) {
            (buckets[i] as any)[row.tag_id] =
              ((buckets[i] as any)[row.tag_id] || 0) + Number(row.count);
            break;
          }
        }
      }
    } else {
      for (let i = days - 1; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        const key = d.toISOString().slice(0, 10);
        const label =
          days <= 14
            ? d.toLocaleDateString(undefined, { weekday: "short", day: "numeric" })
            : dayLabel(key);
        const bucket: any = { key, label };
        for (const t of tagIds) bucket[t.id] = 0;
        buckets.push(bucket);
      }
      for (const row of tagDaily) {
        const dateStr = typeof row.date === "string" ? row.date.slice(0, 10) : row.date;
        const bucket = buckets.find((b) => b.key === dateStr);
        if (bucket) {
          (bucket as any)[row.tag_id] =
            ((bucket as any)[row.tag_id] || 0) + Number(row.count);
        }
      }
    }
    return buckets;
  }, [tagDaily, days, tagIds]);

  const allKeys = tagIds.map((t) => t.id);

  const config: ChartConfig = useMemo(() => {
    const cfg: ChartConfig = {};
    for (const t of tagIds) {
      cfg[t.id] = { label: t.name, color: t.color };
    }
    return cfg;
  }, [tagIds]);

  if (allKeys.length === 0) {
    return (
      <Card>
        <CardContent className="p-4">
          <h3 className="text-sm font-semibold text-foreground">
            Emails over time
          </h3>
          <p className="text-xs text-muted-foreground mb-4">By tag</p>
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <p className="text-sm">No emails in this period</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-4">
        <h3 className="text-sm font-semibold text-foreground">
          Emails over time
        </h3>
        <p className="text-xs text-muted-foreground mb-4">Stacked by tag</p>
        <ChartContainer config={config} className="aspect-[4/1] w-full">
          <BarChart
            data={data}
            margin={{ top: 4, right: 4, bottom: 0, left: -20 }}
          >
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              interval="preserveStartEnd"
              fontSize={11}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              tickMargin={4}
              allowDecimals={false}
            />
            <ChartTooltip content={<ChartTooltipContent />} />
            <ChartLegend content={<ChartLegendContent />} />
            {allKeys.map((key) => (
              <Bar
                key={key}
                dataKey={key}
                stackId="tags"
                fill={`var(--color-${key})`}
                radius={0}
              />
            ))}
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
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
    startDate.setDate(startDate.getDate() - (weeks * 7 - 1) - dayOfWeek);

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
    if (level <= 0.25) return "oklch(0.78 0.12 312)";
    if (level <= 0.5) return "oklch(0.66 0.18 312)";
    if (level <= 0.75) return "oklch(0.56 0.22 312)";
    return "oklch(0.48 0.25 312)";
  }

  const dayLabels = ["", "Mon", "", "Wed", "", "Fri", ""];

  return (
    <Card>
      <CardContent className="p-4">
        <div className="mb-4">
          <h3 className="text-sm font-semibold text-foreground">Activity</h3>
          <p className="text-xs text-muted-foreground">Last 7 weeks</p>
        </div>
        <div className="flex gap-1">
          <div className="flex flex-col gap-1 pr-1">
            {dayLabels.map((l, i) => (
              <div
                key={i}
                className="h-3 text-[9px] leading-3 text-muted-foreground flex items-center"
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
                  className="w-3 h-3 rounded-sm"
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
    <Card className="flex flex-col">
      <CardContent className="p-4 flex-1 flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-semibold text-foreground">
              Top senders
            </h3>
            <p className="text-xs text-muted-foreground">By domain</p>
          </div>
          <button
            onClick={() => onNavigate("senders")}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
          >
            View all
            <ArrowRight size={12} />
          </button>
        </div>
        {domains.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            <p className="text-sm">No senders yet</p>
          </div>
        ) : (
          <div className="space-y-2">
            {domains.map((d) => (
              <button
                key={d.domain}
                onClick={() => onNavigate("senders")}
                className="flex items-center gap-3 w-full text-left rounded-md px-2 py-1.5 -mx-2 hover:bg-muted/50 transition-colors group"
              >
                <div className="w-7 h-7 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                  <GlobeSimple
                    size={14}
                    className="text-primary"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-foreground truncate group-hover:text-primary transition-colors">
                    {d.domain}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    {formatRelative(d.latest_date)}
                  </p>
                </div>
                <span className="text-xs tabular-nums font-medium text-muted-foreground shrink-0">
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
    <Card className="flex flex-col">
      <CardContent className="p-4 flex-1 flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-foreground">
            Recent emails
          </h3>
          <button
            onClick={() => onNavigate("inbox")}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
          >
            View all
            <ArrowRight size={12} />
          </button>
        </div>
        {emails.length === 0 ? (
          <div className="text-center py-8 flex-1 flex flex-col items-center justify-center">
            <Tray
              size={32}
              weight="duotone"
              className="mx-auto mb-2 text-muted-foreground"
            />
            <p className="text-sm text-muted-foreground">No emails yet</p>
            <p className="text-xs text-muted-foreground mt-1">
              Forward newsletters to your workspace email to get started.
            </p>
          </div>
        ) : (
          <div className="space-y-1">
            {emails.map((e) => (
              <button
                key={e.id}
                onClick={() =>
                  onNavigate("inbox", `/app/inbox?email=${e.id}`)
                }
                className="flex items-start gap-3 w-full text-left rounded-md px-2 py-2 -mx-2 hover:bg-muted/50 transition-colors group"
              >
                <div className="mt-1.5 shrink-0">
                  {e.status === "received" ? (
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
                  <p className="text-sm text-foreground truncate group-hover:text-primary transition-colors">
                    {e.subject || "(no subject)"}
                  </p>
                  <div className="flex items-center gap-2">
                    <p className="text-xs text-muted-foreground truncate">
                      {e.from_address}
                    </p>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {formatRelative(e.created_at)}
                    </span>
                  </div>
                  {e.tags && e.tags.length > 0 && (
                    <div className="flex items-center gap-1 mt-1">
                      {e.tags.map((tag) => (
                        <span
                          key={tag.id}
                          className="inline-flex items-center gap-0.5 text-[10px] leading-none px-1.5 py-0.5 rounded-full"
                          style={{
                            backgroundColor: tag.color + "20",
                            color: tag.color,
                          }}
                        >
                          <span
                            className="w-1.5 h-1.5 rounded-full"
                            style={{ backgroundColor: tag.color }}
                          />
                          {tag.name}
                        </span>
                      ))}
                    </div>
                  )}
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
    <div className="flex-1 flex items-center justify-center p-6">
      <div className="max-w-lg w-full text-center">
        <Logo className="h-16 w-auto mx-auto mb-6" />
        <h1 className="text-2xl font-bold text-foreground">
          Welcome to Peckmail
        </h1>
        <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
          Subscribe to newsletters and forward emails to your unique address to
          start tracking, tagging, and analyzing your inbox.
        </p>

        {projectEmail && (
          <div className="mt-8">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
              Your workspace email
            </p>
            <button
              onClick={copyEmail}
              className="group inline-flex items-center gap-3 bg-muted/60 hover:bg-muted border border-border rounded-xl px-5 py-4 transition-colors w-full max-w-md mx-auto"
            >
              <EnvelopeSimple
                size={20}
                className="text-primary shrink-0"
              />
              <code className="text-base font-mono text-foreground truncate flex-1 text-left">
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
                  className="text-muted-foreground group-hover:text-foreground shrink-0 transition-colors"
                />
              )}
            </button>
            <p className="text-xs text-muted-foreground mt-2">
              Click to copy
            </p>
          </div>
        )}

        <div className="mt-10 grid grid-cols-1 sm:grid-cols-3 gap-4 text-left">
          <div className="rounded-lg border border-border p-4">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center mb-3">
              <EnvelopeSimple size={16} className="text-primary" />
            </div>
            <p className="text-sm font-medium text-foreground">Subscribe</p>
            <p className="text-xs text-muted-foreground mt-1">
              Use your workspace email to sign up for newsletters
            </p>
          </div>
          <div className="rounded-lg border border-border p-4">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center mb-3">
              <Tray size={16} className="text-primary" />
            </div>
            <p className="text-sm font-medium text-foreground">Receive</p>
            <p className="text-xs text-muted-foreground mt-1">
              Emails arrive in your inbox, auto-tagged by AI
            </p>
          </div>
          <div className="rounded-lg border border-border p-4">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center mb-3">
              <TrendUp size={16} className="text-primary" />
            </div>
            <p className="text-sm font-medium text-foreground">Analyze</p>
            <p className="text-xs text-muted-foreground mt-1">
              Track trends, senders, and content across all your emails
            </p>
          </div>
        </div>
      </div>
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
  const [range, setRange] = useState<DateRange>("14d");
  const days = daysFromRange(range);
  const [data, setData] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .get<DashboardStats>(`/api/projects/${projectId}/dashboard?days=${days}`)
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
  }, [projectId, days]);

  if (loading && !data) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <CircleNotch size={24} className="text-muted-foreground animate-spin" />
      </div>
    );
  }

  if (!data || data.recent_emails.length === 0) {
    return <EmptyDashboard onNavigate={onNavigate} />;
  }

  const { kpis } = data;
  const avgPerDay = days > 0 ? (kpis.total / days).toFixed(1) : "0";

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Header with date selector */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-foreground">Dashboard</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Overview of your email activity
            </p>
          </div>
          <DateRangeSelector value={range} onChange={setRange} />
        </div>

        {/* KPI row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <KpiCard
            label="Total emails"
            value={kpis.total}
            icon={EnvelopeSimple}
            subtitle={`Last ${days} days`}
          />
          <KpiCard label="Unread" value={kpis.unread} icon={Tray} />
          <KpiCard label="Processed" value={kpis.processed} icon={CheckCircle} />
          <KpiCard
            label="Avg / day"
            value={avgPerDay}
            icon={TrendUp}
            subtitle={`Last ${days} days`}
          />
        </div>

        {/* Stacked bar chart (full width) */}
        <StackedTagBarChart tagDaily={data.tag_daily} days={days} />

        {/* Pie chart + Recent emails */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <TagPieChart tagDaily={data.tag_daily} />
          <RecentEmails emails={data.recent_emails} onNavigate={onNavigate} />
        </div>

        {/* Activity grid + Top domains */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <ActivityGrid activityGrid={data.activity_grid} />
          <TopDomains domains={data.top_domains} onNavigate={onNavigate} />
        </div>
      </div>
    </div>
  );
}
