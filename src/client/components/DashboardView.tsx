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
import { Badge } from "@/components/ui/badge.js";
import { Button } from "@/components/ui/button.js";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.js";
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
  ChartLegend,
  ChartLegendContent,
  type ChartConfig,
} from "@/components/ui/chart.js";
import {
  Bar,
  BarChart,
  Area,
  AreaChart,
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

function weekdayLabel(dateStr: string) {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString(undefined, { weekday: "short" });
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
  tagDaily,
  days,
}: {
  tagDaily: DashboardStats["tag_daily"];
  days: number;
}) {
  const data = useMemo(() => {
    const now = new Date();
    const buckets: { key: string; label: string; count: number }[] = [];

    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      buckets.push({
        key,
        label: d.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
        count: 0,
      });
    }

    for (const row of tagDaily) {
      const dateStr = typeof row.date === "string" ? row.date.slice(0, 10) : row.date;
      const bucket = buckets.find((b) => b.key === dateStr);
      if (bucket) {
        bucket.count += Number(row.count);
      }
    }
    return buckets;
  }, [tagDaily, days]);

  const config: ChartConfig = {
    count: { label: "Emails", color: "var(--color-primary)" },
  };

  return (
    <Card className="border-border/60">
      <CardContent className="p-5">
        <h3 className="text-sm font-bold text-foreground">Frequency</h3>
        <p className="text-[10px] uppercase font-bold tracking-widest text-muted-foreground/60 mb-6">Volume over time</p>
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
            />
            <ChartTooltip content={<ChartTooltipContent indicator="line" />} />
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

function TagPieChart({
  tagDaily,
}: {
  tagDaily: DashboardStats["tag_daily"];
}) {
  const data = useMemo(() => {
    const tagCounts = new Map<string, { name: string; count: number }>();
    for (const row of tagDaily) {
      const existing = tagCounts.get(row.tag_id);
      if (existing) {
        existing.count += Number(row.count);
      } else {
        tagCounts.set(row.tag_id, {
          name: row.tag_name,
          count: Number(row.count),
        });
      }
    }
    return Array.from(tagCounts.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .map(([id, d]) => ({ 
        id, 
        ...d
      }));
  }, [tagDaily]);

  const total = data.reduce((sum, d) => sum + d.count, 0);
  const config = useMemo(() => {
    const cfg: ChartConfig = {};
    data.forEach((d, i) => {
      cfg[d.id] = { 
        label: d.name, 
        color: `oklch(var(--chart-${(i % 5) + 1}))` 
      };
    });
    return cfg;
  }, [data]);

  if (data.length === 0) {
    return (
      <Card className="flex flex-col border-border/60">
        <CardContent className="p-5 flex-1 flex flex-col">
          <h3 className="text-sm font-bold text-foreground">Distribution</h3>
          <p className="text-[10px] uppercase font-bold tracking-widest text-muted-foreground/60 mb-4">By tag</p>
          <div className="flex items-center justify-center flex-1 text-muted-foreground">
            <p className="text-xs italic opacity-40 uppercase tracking-widest">No tagged emails</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="flex flex-col border-border/60">
      <CardContent className="p-5 flex-1 flex flex-col">
        <h3 className="text-sm font-bold text-foreground">Distribution</h3>
        <p className="text-[10px] uppercase font-bold tracking-widest text-muted-foreground/60 mb-2">By tag</p>
        <div className="flex-1 flex items-center gap-6">
          <ChartContainer config={config} className="aspect-square w-[140px] shrink-0">
            <PieChart>
              <ChartTooltip content={<ChartTooltipContent nameKey="name" hideLabel />} />
              <Pie
                data={data}
                dataKey="count"
                nameKey="name"
                innerRadius={44}
                outerRadius={66}
                strokeWidth={2}
                stroke="var(--color-background)"
              >
                {data.map((entry) => (
                  <Cell 
                    key={entry.id} 
                    fill={`var(--color-${entry.id})`} 
                  />
                ))}
                <Label
                  content={({ viewBox }) => {
                    if (viewBox && "cx" in viewBox && "cy" in viewBox) {
                      return (
                        <text x={viewBox.cx} y={viewBox.cy} textAnchor="middle" dominantBaseline="middle">
                          <tspan x={viewBox.cx} y={viewBox.cy} className="fill-foreground text-xl font-bold tabular-nums">
                            {total}
                          </tspan>
                          <tspan x={viewBox.cx} y={(viewBox.cy || 0) + 16} className="fill-muted-foreground text-[8px] font-bold uppercase tracking-widest opacity-40">
                            TOTAL
                          </tspan>
                        </text>
                      );
                    }
                  }}
                />
              </Pie>
            </PieChart>
          </ChartContainer>
          <div className="flex-1 space-y-2.5 min-w-0">
            {data.slice(0, 5).map((t) => (
              <div key={t.id} className="flex items-center gap-2">
                <span 
                  className="w-1.5 h-1.5 rounded-full shrink-0" 
                  style={{ backgroundColor: `var(--color-${t.id})` }} 
                />
                <span className="text-[11px] font-bold text-foreground truncate flex-1 uppercase tracking-tight">
                  {t.name}
                </span>
                <span className="text-[11px] tabular-nums font-bold text-muted-foreground/60 shrink-0 w-8 text-right">
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

  if (!data || (data.recent_emails.length === 0 && selectedCountries.length === 0)) {
    return <EmptyDashboard onNavigate={onNavigate} />;
  }

  const { kpis } = data;
  const daysNum = parseInt(range);
  const avgPerDay = daysNum > 0 ? (kpis.total / daysNum).toFixed(1) : "0";

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
            Overview of your inbox volume, tag distribution, and recent activity{" "}
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
          <KpiCard label="Unread" value={kpis.unread} icon={Tray} subtitle="CURRENT BALANCE" />
          <KpiCard label="Processed" value={kpis.processed} icon={CheckCircle} subtitle="TOTAL LIFETIME" />
          <KpiCard
            label="Avg / day"
            value={avgPerDay}
            icon={TrendUp}
            subtitle={`L${range}D VELOCITY`}
          />
        </div>

        {/* Activity Section */}
        <VolumeChart tagDaily={data.tag_daily} days={daysNum} />

        {/* Details Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <TagPieChart tagDaily={data.tag_daily} />
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
