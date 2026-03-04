import { Badge } from "@/components/ui/badge.js";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  UsersThree,
  EnvelopeSimple,
  TrendUp,
  CalendarBlank,
  ArrowLeft,
  At,
  Pencil,
  Trash,
  CircleNotch,
  MagicWand,
  ArrowsClockwise,
  Globe,
  LinkSimple,
  ArrowsMerge,
  MagnifyingGlass,
  TrendDown,
  SortAscending,
} from "@phosphor-icons/react";
import { Card, CardContent } from "@/components/ui/card.js";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.js";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart.js";
import {
  Bar,
  BarChart,
  CartesianGrid,
  XAxis,
  YAxis,
  Area,
  AreaChart,
} from "recharts";
import { useProjectId } from "../store/StoreContext.js";
import { api } from "../lib/api.js";
import type { Sender, IncomingEmail, SenderStats } from "../store/types.js";

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

interface Domain {
  id: string;
  domain: string;
  enabled: boolean;
  sender_id: string | null;
  resolver_status: string;
  resolver_error: string | null;
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

function dateKey(iso: string) {
  return new Date(iso).toISOString().slice(0, 10);
}

function dayLabel(dateStr: string) {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// --- Data hooks ---

function useDailyVolume(emails: IncomingEmail[], days: number) {
  return useMemo(() => {
    const now = new Date();
    const result: { date: string; label: string; count: number }[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      result.push({ date: key, label: dayLabel(key), count: 0 });
    }
    for (const e of emails) {
      const key = dateKey(e.created_at);
      const entry = result.find((r) => r.date === key);
      if (entry) entry.count++;
    }
    return result;
  }, [emails, days]);
}

function useTagBreakdown(emails: IncomingEmail[]) {
  return useMemo(() => {
    const tagCounts = new Map<
      string,
      { name: string; color: string; count: number }
    >();
    for (const e of emails) {
      if (!e.tags || e.tags.length === 0) {
        const existing = tagCounts.get("_untagged");
        if (existing) {
          existing.count++;
        } else {
          tagCounts.set("_untagged", {
            name: "Untagged",
            color: "#94a3b8",
            count: 1,
          });
        }
        continue;
      }
      for (const tag of e.tags) {
        const existing = tagCounts.get(tag.id);
        if (existing) {
          existing.count++;
        } else {
          tagCounts.set(tag.id, {
            name: tag.name,
            color: tag.color,
            count: 1,
          });
        }
      }
    }
    return Array.from(tagCounts.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .map(([id, data]) => ({ id, ...data }));
  }, [emails]);
}

// --- KPI Card ---

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

// --- Sender List ---

// --- Sparkline + trend helpers ---

const sparklineConfig: ChartConfig = {
  count: { label: "Emails", color: "var(--color-primary)" },
};

function Sparkline({ sparkline, days = 30 }: { sparkline: number[]; days?: number }) {
  const chartData = useMemo(() => {
    const data = sparkline.slice(-days);
    return data.map((count, i) => {
      const date = new Date();
      date.setDate(date.getDate() - (data.length - 1 - i));
      return {
        date: date.toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
        }),
        count,
      };
    });
  }, [sparkline, days]);

  return (
    <ChartContainer
      config={sparklineConfig}
      className="h-9 w-32 aspect-auto shrink-0"
    >
      <AreaChart
        data={chartData}
        margin={{ top: 4, right: 0, bottom: 4, left: 0 }}
      >
        <defs>
          <linearGradient id="sparkline-gradient" x1="0" y1="0" x2="0" y2="1">
            <stop
              offset="5%"
              stopColor="var(--color-count)"
              stopOpacity={0.3}
            />
            <stop
              offset="95%"
              stopColor="var(--color-count)"
              stopOpacity={0}
            />
          </linearGradient>
        </defs>
        <Area
          dataKey="count"
          type="monotone"
          fill="url(#sparkline-gradient)"
          stroke="var(--color-count)"
          strokeWidth={1.5}
          dot={false}
          isAnimationActive={false}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              labelKey="date"
              className="min-w-[100px]"
              indicator="line"
            />
          }
          cursor={{ stroke: "var(--color-border)", strokeWidth: 1 }}
        />
      </AreaChart>
    </ChartContainer>
  );
}

function periodTrend(sparkline: number[], days: number) {
  const current = sparkline.slice(-days);
  const prev = sparkline.slice(-days * 2, -days);
  const count = current.reduce((a, b) => a + b, 0);
  const prevCount = prev.reduce((a, b) => a + b, 0);
  return { count, delta: count - prevCount };
}

function TrendLabel({ sparkline, days = 7 }: { sparkline: number[]; days?: number }) {
  const { delta } = useMemo(() => periodTrend(sparkline, days), [sparkline, days]);

  if (delta > 0) {
    return (
      <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-600 border-transparent font-bold text-[9px] uppercase tracking-wider px-1.5 h-5 flex items-center gap-1">
        <TrendUp size={10} weight="bold" />
        Increasing
      </Badge>
    );
  }
  if (delta < 0) {
    return (
      <Badge variant="secondary" className="bg-rose-500/10 text-rose-600 border-transparent font-bold text-[9px] uppercase tracking-wider px-1.5 h-5 flex items-center gap-1">
        <TrendDown size={10} weight="bold" />
        Decreasing
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-muted-foreground/60 border-border/50 font-bold text-[9px] uppercase tracking-wider px-1.5 h-5 flex items-center gap-1">
      Stable
    </Badge>
  );
}

function SenderList({
  senders,
  domains,
  loading,
  resolving,
  onSelect,
  onResolveAll,
  stats,
}: {
  senders: Sender[];
  domains: Domain[];
  loading: boolean;
  resolving: boolean;
  onSelect: (senderId: string) => void;
  onResolveAll: () => void;
  stats: Record<string, SenderStats> | null;
}) {
  const [countryFilter, setCountryFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [timeframe, setTimeframe] = useState<number>(30);
  const [sortBy, setSortBy] = useState<"default" | "name" | "total" | "trending" | "declining">("default");
  const unlinkedDomains = domains.filter((d) => !d.sender_id);
  const totalEmails = senders.reduce((sum, s) => sum + s.email_count, 0);

  const availableCountries = useMemo(() => {
    const codes = new Set<string>();
    for (const s of senders) {
      if (s.country) codes.add(s.country);
    }
    return Array.from(codes).sort((a, b) => {
      const nameA = COUNTRIES[a]?.name ?? a;
      const nameB = COUNTRIES[b]?.name ?? b;
      return nameA.localeCompare(nameB);
    });
  }, [senders]);

  const filteredSenders = useMemo(() => {
    let result = senders;
    if (countryFilter !== "all") {
      result = result.filter((s) => s.country === countryFilter);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter((s) => {
        if (s.name.toLowerCase().includes(q)) return true;
        const senderDomains = domains.filter((d) => d.sender_id === s.id);
        return senderDomains.some((d) => d.domain.toLowerCase().includes(q));
      });
    }
    if (sortBy !== "default") {
      result = [...result].sort((a, b) => {
        if (sortBy === "name") return a.name.localeCompare(b.name);
        const stA = stats?.[a.id];
        const stB = stats?.[b.id];
        const totalA = stA?.sparkline.slice(-timeframe).reduce((s, v) => s + v, 0) ?? 0;
        const totalB = stB?.sparkline.slice(-timeframe).reduce((s, v) => s + v, 0) ?? 0;
        if (sortBy === "total") return totalB - totalA;
        const deltaA = stA ? periodTrend(stA.sparkline, timeframe).delta : 0;
        const deltaB = stB ? periodTrend(stB.sparkline, timeframe).delta : 0;
        if (sortBy === "trending") return deltaB - deltaA;
        if (sortBy === "declining") return deltaA - deltaB;
        return 0;
      });
    }
    return result;
  }, [senders, domains, countryFilter, search, sortBy, stats, timeframe]);

  const filteredUnlinkedDomains = useMemo(() => {
    if (!search.trim()) return unlinkedDomains;
    const q = search.trim().toLowerCase();
    return unlinkedDomains.filter((d) => d.domain.toLowerCase().includes(q));
  }, [unlinkedDomains, search]);

  if (loading) {
    return (
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-5xl mx-auto space-y-6">
          <div>
            <h1 className="text-xl font-semibold text-foreground">Senders</h1>
            <p className="text-sm text-muted-foreground mt-1">Loading...</p>
          </div>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-center py-12">
                <CircleNotch size={24} className="animate-spin text-muted-foreground" />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (senders.length === 0 && unlinkedDomains.length === 0) {
    return (
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-5xl mx-auto space-y-6">
          <div>
            <h1 className="text-xl font-semibold text-foreground">Senders</h1>
            <p className="text-sm text-muted-foreground mt-1">
              0 senders &middot; 0 total emails
            </p>
          </div>
          <Card>
            <CardContent className="p-4">
              <div className="text-center py-12">
                <UsersThree
                  size={40}
                  weight="duotone"
                  className="mx-auto mb-3 text-muted-foreground"
                />
                <p className="text-sm text-muted-foreground">
                  No senders yet
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Senders are automatically identified when emails arrive.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-foreground">Senders</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {senders.length} sender{senders.length !== 1 ? "s" : ""} &middot;{" "}
              {totalEmails} total email{totalEmails !== 1 ? "s" : ""}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <MagnifyingGlass
                size={14}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                placeholder="Search senders..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-8 text-xs pl-8 w-[200px]"
              />
            </div>
            <div className="flex items-center rounded-md border border-border bg-muted/30 p-0.5">
              {[7, 14, 30].map((d) => (
                <button
                  key={d}
                  onClick={() => setTimeframe(d)}
                  className={`px-2 py-0.5 text-xs font-medium rounded transition-colors ${
                    timeframe === d
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {d}d
                </button>
              ))}
            </div>
            <Select value={sortBy} onValueChange={(v) => setSortBy(v as typeof sortBy)}>
              <SelectTrigger className="w-[150px] h-8 text-xs">
                <SortAscending size={14} className="mr-1.5 shrink-0 text-muted-foreground" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="default">Default</SelectItem>
                <SelectItem value="name">Name</SelectItem>
                <SelectItem value="total">Most emails</SelectItem>
                <SelectItem value="trending">Trending up</SelectItem>
                <SelectItem value="declining">Trending down</SelectItem>
              </SelectContent>
            </Select>
            {availableCountries.length > 0 && (
              <Select value={countryFilter} onValueChange={setCountryFilter}>
                <SelectTrigger className="w-[180px] h-8 text-xs">
                  <SelectValue placeholder="All countries" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All countries</SelectItem>
                  <SelectSeparator />
                  {availableCountries.map((code) => (
                    <SelectItem key={code} value={code}>
                      {countryLabel(code)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {unlinkedDomains.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={onResolveAll}
                disabled={resolving}
              >
                {resolving ? (
                  <CircleNotch size={14} className="animate-spin mr-1.5" />
                ) : (
                  <MagicWand size={14} className="mr-1.5" />
                )}
                {resolving ? "Resolving..." : `Resolve all (${unlinkedDomains.length})`}
              </Button>
            )}
          </div>
        </div>

        {/* Sender list */}
        {filteredSenders.length > 0 && (
          <Card>
            <CardContent className="p-2">
              {/* Header */}
              <div className="flex items-center gap-4 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground border-b border-border/50 mb-1">
                <div className="w-9 shrink-0" />
                <div className="flex-1 min-w-0">Sender</div>
                <div className="w-32 shrink-0 text-center">Activity ({timeframe}d)</div>
                <div className="w-28 shrink-0 text-right">Trend</div>
                <div className="w-24 shrink-0 text-right">{timeframe}d Total</div>
              </div>
              <div className="divide-y divide-border">
                {filteredSenders.map((s) => {
                  const st = stats?.[s.id];
                  const periodTotal = st?.sparkline.slice(-timeframe).reduce((a, b) => a + b, 0) ?? 0;
                  return (
                    <button
                      key={s.id}
                      onClick={() => onSelect(s.id)}
                      className="w-full flex items-center gap-4 px-3 py-2.5 rounded-lg hover:bg-muted/50 transition-colors text-left"
                    >
                      <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center text-sm font-semibold text-primary shrink-0">
                        {s.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 leading-none">
                          <p className="text-sm font-semibold text-foreground truncate">
                            {s.name}
                          </p>
                          {s.country && COUNTRIES[s.country] && (
                            <span className="text-xs shrink-0" title={COUNTRIES[s.country].name}>
                              {COUNTRIES[s.country].flag}
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-1.5">
                          {s.domain_count} domain{s.domain_count !== 1 ? "s" : ""}
                        </p>
                      </div>
                      <div className="w-32 shrink-0 flex items-center justify-center">
                        {st ? (
                          <Sparkline sparkline={st.sparkline} days={timeframe} />
                        ) : (
                          <span className="text-xs text-muted-foreground">&mdash;</span>
                        )}
                      </div>
                      <div className="w-28 shrink-0 flex justify-end">
                        {st ? (
                          <TrendLabel sparkline={st.sparkline} days={timeframe} />
                        ) : (
                          <span className="text-xs text-muted-foreground">&mdash;</span>
                        )}
                      </div>
                      <div className="w-24 shrink-0 text-right">
                        <span className="text-sm font-bold tabular-nums text-foreground">
                          {st ? periodTotal : s.email_count}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Unlinked domains */}
        {filteredUnlinkedDomains.length > 0 && (
          <>
            <div>
              <h2 className="text-sm font-semibold text-foreground">
                Unlinked domains
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                {filteredUnlinkedDomains.length} domain{filteredUnlinkedDomains.length !== 1 ? "s" : ""} not yet linked to a sender
              </p>
            </div>
            <Card>
              <CardContent className="p-2">
                <div className="divide-y divide-border">
                  {filteredUnlinkedDomains.map((d) => (
                    <div
                      key={d.id}
                      className="flex items-center gap-3 p-3"
                    >
                      <div className="w-7 h-7 rounded bg-muted flex items-center justify-center text-xs font-medium text-muted-foreground shrink-0">
                        {d.domain.charAt(0).toUpperCase()}
                      </div>
                      <span className="text-sm text-foreground truncate flex-1">
                        {d.domain}
                      </span>
                      <ResolverStatusBadge status={d.resolver_status} error={d.resolver_error} />
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}

function ResolverStatusBadge({ status, error }: { status: string; error: string | null }) {
  switch (status) {
    case "resolving":
      return (
        <span className="flex items-center gap-1 text-xs text-amber-600">
          <CircleNotch size={12} className="animate-spin" />
          Resolving
        </span>
      );
    case "resolved":
      return <span className="text-xs text-green-600">Resolved</span>;
    case "failed":
      return (
        <span className="text-xs text-red-500" title={error || undefined}>
          Failed
        </span>
      );
    case "skipped":
      return <span className="text-xs text-muted-foreground">Skipped</span>;
    default:
      return <span className="text-xs text-muted-foreground">Pending</span>;
  }
}

// --- Sender Detail ---

function SenderDetail({
  sender,
  domains,
  allSenders,
  onBack,
  onRefresh,
}: {
  sender: Sender;
  domains: Domain[];
  allSenders: Sender[];
  onBack: () => void;
  onRefresh: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(sender.name);
  const [editWebsite, setEditWebsite] = useState(sender.website || "");
  const [editDescription, setEditDescription] = useState(sender.description || "");
  const [editCountry, setEditCountry] = useState(sender.country || "");
  const [saving, setSaving] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergeTarget, setMergeTarget] = useState("");
  const [merging, setMerging] = useState(false);
  const projectId = useProjectId();

  // Fetch sender emails from API instead of filtering in-memory
  const [senderEmails, setSenderEmails] = useState<IncomingEmail[]>([]);
  const [hasMoreSenderEmails, setHasMoreSenderEmails] = useState(false);
  const [loadingMoreSenderEmails, setLoadingMoreSenderEmails] = useState(false);
  useEffect(() => {
    api.get<{ emails: IncomingEmail[]; hasMore: boolean }>(
      `/api/projects/${projectId}/senders/${sender.id}/emails?limit=50`
    ).then((data) => {
      setSenderEmails(data.emails);
      setHasMoreSenderEmails(data.hasMore);
    }).catch(() => {});
  }, [projectId, sender.id]);

  const loadMoreSenderEmails = async () => {
    if (loadingMoreSenderEmails || !hasMoreSenderEmails) return;
    const lastEmail = senderEmails[senderEmails.length - 1];
    if (!lastEmail) return;
    setLoadingMoreSenderEmails(true);
    try {
      const data = await api.get<{ emails: IncomingEmail[]; hasMore: boolean }>(
        `/api/projects/${projectId}/senders/${sender.id}/emails?limit=50&before=${lastEmail.id}`
      );
      setSenderEmails((prev) => [...prev, ...data.emails]);
      setHasMoreSenderEmails(data.hasMore);
    } catch {
      // ignore
    } finally {
      setLoadingMoreSenderEmails(false);
    }
  };

  const senderDomains = domains.filter((d) => d.sender_id === sender.id);
  const volumeData = useDailyVolume(senderEmails, 14);
  const tagBreakdown = useTagBreakdown(senderEmails);
  const recent = senderEmails.slice(0, 5);

  const total = sender.email_count;
  const avgPerDay = useMemo(() => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 14);
    const recentCount = senderEmails.filter(
      (e) => new Date(e.created_at) >= cutoff
    ).length;
    return (recentCount / 14).toFixed(1);
  }, [senderEmails]);

  const volumeConfig: ChartConfig = {
    count: { label: "Emails", color: "var(--color-primary)" },
  };

  const tagConfig: ChartConfig = Object.fromEntries(
    tagBreakdown.map((t) => [t.id, { label: t.name, color: t.color }])
  );
  const tagData = tagBreakdown.map((t) => ({
    name: t.name,
    count: t.count,
    fill: t.color,
  }));

  const mergeableSenders = allSenders.filter((s) => s.id !== sender.id);

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.patch(`/api/projects/${projectId}/senders/${sender.id}`, {
        name: editName.trim() || undefined,
        website: editWebsite.trim() || null,
        description: editDescription.trim() || null,
        country: editCountry.trim() || null,
      });
      setEditing(false);
      onRefresh();
    } catch (err: any) {
      alert(err.message || "Failed to update sender");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Delete sender "${sender.name}"? Linked domains will be unlinked.`)) return;
    try {
      await api.del(`/api/projects/${projectId}/senders/${sender.id}`);
      onBack();
      onRefresh();
    } catch (err: any) {
      alert(err.message || "Failed to delete sender");
    }
  };

  const handleMerge = async () => {
    if (!mergeTarget) return;
    setMerging(true);
    try {
      await api.post(`/api/projects/${projectId}/senders/${sender.id}/merge`, {
        merge_sender_id: mergeTarget,
      });
      setMergeOpen(false);
      onRefresh();
    } catch (err: any) {
      alert(err.message || "Failed to merge senders");
    } finally {
      setMerging(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="w-8 h-8 rounded-lg hover:bg-muted flex items-center justify-center transition-colors"
          >
            <ArrowLeft size={18} className="text-muted-foreground" />
          </button>
          <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center text-sm font-semibold text-primary shrink-0">
            {sender.name.charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-semibold text-foreground truncate">
              {sender.name}
            </h1>
            {sender.website && (
              <p className="text-xs text-muted-foreground truncate">
                {sender.website}
              </p>
            )}
            {sender.country && (
              <p className="text-xs text-muted-foreground">
                {countryLabel(sender.country)}
              </p>
            )}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setEditName(sender.name);
                setEditWebsite(sender.website || "");
                setEditDescription(sender.description || "");
                setEditCountry(sender.country || "");
                setEditing(true);
              }}
            >
              <Pencil size={14} />
            </Button>
            {mergeableSenders.length > 0 && (
              <Button variant="ghost" size="sm" onClick={() => setMergeOpen(true)}>
                <ArrowsMerge size={14} />
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={handleDelete}>
              <Trash size={14} />
            </Button>
          </div>
        </div>

        {sender.description && (
          <p className="text-sm text-muted-foreground">{sender.description}</p>
        )}

        {/* KPI row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <KpiCard label="Total emails" value={total} icon={EnvelopeSimple} />
          <KpiCard
            label="Avg / day"
            value={avgPerDay}
            icon={TrendUp}
            subtitle="Last 14 days"
          />
          <KpiCard
            label="Domains"
            value={senderDomains.length}
            icon={Globe}
          />
          <KpiCard
            label="Created"
            value={dayLabel(dateKey(sender.created_at))}
            icon={CalendarBlank}
          />
        </div>

        {/* Volume chart + recent emails */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
          <div className="lg:col-span-3">
            <Card>
              <CardContent className="p-4">
                <div className="mb-4">
                  <h3 className="text-sm font-semibold text-foreground">
                    Email volume
                  </h3>
                  <p className="text-xs text-muted-foreground">Last 14 days</p>
                </div>
                <ChartContainer config={volumeConfig} className="aspect-[2.5/1] w-full">
                  <AreaChart data={volumeData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                    <defs>
                      <linearGradient id="fillSenderVolume" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--color-count)" stopOpacity={0.3} />
                        <stop offset="100%" stopColor="var(--color-count)" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid vertical={false} />
                    <XAxis
                      dataKey="label"
                      tickLine={false}
                      axisLine={false}
                      tickMargin={8}
                      interval="preserveStartEnd"
                    />
                    <YAxis
                      tickLine={false}
                      axisLine={false}
                      tickMargin={4}
                      allowDecimals={false}
                    />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Area
                      dataKey="count"
                      type="monotone"
                      stroke="var(--color-count)"
                      fill="url(#fillSenderVolume)"
                      strokeWidth={2}
                    />
                  </AreaChart>
                </ChartContainer>
              </CardContent>
            </Card>
          </div>
          <div className="lg:col-span-2">
            <Card className="h-full">
              <CardContent className="p-4">
                <div className="mb-4">
                  <h3 className="text-sm font-semibold text-foreground">
                    Recent emails
                  </h3>
                </div>
                {recent.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <p className="text-sm">No emails from this sender</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {recent.map((e) => (
                      <div key={e.id} className="flex items-start gap-3">
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
                          <p className="text-sm text-foreground truncate">
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
                        </div>
                      </div>
                    ))}
                    {hasMoreSenderEmails && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full text-xs"
                        onClick={loadMoreSenderEmails}
                        disabled={loadingMoreSenderEmails}
                      >
                        {loadingMoreSenderEmails ? (
                          <>
                            <CircleNotch size={14} className="animate-spin mr-1.5" />
                            Loading...
                          </>
                        ) : (
                          "Load more"
                        )}
                      </Button>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Tag breakdown */}
        {tagData.length > 0 && (
          <Card>
            <CardContent className="p-4">
              <div className="mb-4">
                <h3 className="text-sm font-semibold text-foreground">
                  Emails by tag
                </h3>
              </div>
              <ChartContainer config={tagConfig} className="aspect-[3/1] w-full">
                <BarChart
                  data={tagData}
                  layout="vertical"
                  margin={{ top: 0, right: 4, bottom: 0, left: 0 }}
                >
                  <CartesianGrid horizontal={false} />
                  <YAxis
                    dataKey="name"
                    type="category"
                    tickLine={false}
                    axisLine={false}
                    width={80}
                    tickMargin={4}
                  />
                  <XAxis type="number" tickLine={false} axisLine={false} allowDecimals={false} />
                  <ChartTooltip content={<ChartTooltipContent hideLabel />} />
                  <Bar dataKey="count" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ChartContainer>
            </CardContent>
          </Card>
        )}

        {/* Linked domains */}
        <Card>
          <CardContent className="p-4">
            <div className="mb-4">
              <h3 className="text-sm font-semibold text-foreground">
                Linked domains
              </h3>
              <p className="text-xs text-muted-foreground">
                {senderDomains.length} domain{senderDomains.length !== 1 ? "s" : ""}
              </p>
            </div>
            {senderDomains.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                No domains linked to this sender
              </p>
            ) : (
              <div className="space-y-2">
                {senderDomains.map((d) => (
                  <div
                    key={d.id}
                    className="flex items-center gap-3 py-1.5"
                  >
                    <LinkSimple size={14} className="text-muted-foreground shrink-0" />
                    <span className="text-sm text-foreground truncate flex-1">
                      {d.domain}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Edit dialog */}
        <Dialog open={editing} onOpenChange={setEditing}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit sender</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <div>
                <label className="text-sm font-medium text-foreground">Name</label>
                <Input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  placeholder="Brand name"
                  className="mt-1"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-foreground">Website</label>
                <Input
                  value={editWebsite}
                  onChange={(e) => setEditWebsite(e.target.value)}
                  placeholder="https://..."
                  className="mt-1"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-foreground">Description</label>
                <Input
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  placeholder="Brief description"
                  className="mt-1"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-foreground">Country</label>
                <Select value={editCountry || "__none__"} onValueChange={(v) => setEditCountry(v === "__none__" ? "" : v)}>
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Select country" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">No country</SelectItem>
                    <SelectSeparator />
                    {Object.entries(COUNTRIES)
                      .sort(([, a], [, b]) => a.name.localeCompare(b.name))
                      .map(([code, { name, flag }]) => (
                        <SelectItem key={code} value={code}>
                          {flag} {name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
                <Button onClick={handleSave} disabled={saving || !editName.trim()}>
                  {saving ? (
                    <CircleNotch size={14} className="animate-spin mr-1.5" />
                  ) : null}
                  Save
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Merge dialog */}
        <Dialog open={mergeOpen} onOpenChange={setMergeOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Merge sender</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              Merge another sender into <strong>{sender.name}</strong>. All domains
              from the merged sender will be reassigned here.
            </p>
            <div className="pt-2">
              <Select value={mergeTarget} onValueChange={setMergeTarget}>
                <SelectTrigger>
                  <SelectValue placeholder="Select sender to merge" />
                </SelectTrigger>
                <SelectContent>
                  {mergeableSenders.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name} ({s.domain_count} domains)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setMergeOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleMerge} disabled={merging || !mergeTarget}>
                {merging ? (
                  <CircleNotch size={14} className="animate-spin mr-1.5" />
                ) : (
                  <ArrowsMerge size={14} className="mr-1.5" />
                )}
                Merge
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}

// --- Main ---

export function SendersView() {
  const projectId = useProjectId();
  const [senders, setSenders] = useState<Sender[]>([]);
  const [domains, setDomains] = useState<Domain[]>([]);
  const [loading, setLoading] = useState(true);
  const [resolving, setResolving] = useState(false);
  const [selectedSenderId, setSelectedSenderId] = useState<string | null>(null);
  const [senderStats, setSenderStats] = useState<Record<string, SenderStats> | null>(null);

  const fetchData = useCallback(async () => {
    const [sendersRes, domainsRes] = await Promise.allSettled([
      api.get<{ senders: Sender[] }>(`/api/projects/${projectId}/senders`),
      api.get<{ domains: Domain[] }>(`/api/projects/${projectId}/domains`),
    ]);
    if (sendersRes.status === "fulfilled") setSenders(sendersRes.value.senders);
    else console.error("[SendersView] Failed to fetch senders:", sendersRes.reason);
    if (domainsRes.status === "fulfilled") setDomains(domainsRes.value.domains);
    else console.error("[SendersView] Failed to fetch domains:", domainsRes.reason);
    setLoading(false);
  }, [projectId]);

  // Fetch sender stats
  useEffect(() => {
    api.get<{ stats: Record<string, SenderStats> }>(
      `/api/projects/${projectId}/senders/stats`
    ).then((data) => {
      setSenderStats(data.stats);
    }).catch((err) => {
      console.error("[SendersView] Failed to fetch sender stats:", err);
    });
  }, [projectId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Listen for sender:resolved events from WS
  useEffect(() => {
    const handler = () => {
      fetchData();
    };
    window.addEventListener("sender:resolved", handler);
    return () => window.removeEventListener("sender:resolved", handler);
  }, [fetchData]);

  const handleResolveAll = async () => {
    setResolving(true);
    try {
      await api.post(`/api/projects/${projectId}/senders/resolve-all`);
      // Poll for updates — resolution happens in the background
      const interval = setInterval(async () => {
        await fetchData();
      }, 3000);
      // Stop polling after 2 minutes
      setTimeout(() => {
        clearInterval(interval);
        setResolving(false);
      }, 120000);
    } catch (err: any) {
      alert(err.message || "Failed to start resolution");
      setResolving(false);
    }
  };

  const selectedSender = senders.find((s) => s.id === selectedSenderId);

  if (selectedSender) {
    return (
      <SenderDetail
        sender={selectedSender}
        domains={domains}
        allSenders={senders}
        onBack={() => setSelectedSenderId(null)}
        onRefresh={fetchData}
      />
    );
  }

  return (
    <SenderList
      senders={senders}
      domains={domains}
      loading={loading}
      resolving={resolving}
      onSelect={setSelectedSenderId}
      onResolveAll={handleResolveAll}
      stats={senderStats}
    />
  );
}
