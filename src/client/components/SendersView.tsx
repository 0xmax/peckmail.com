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
  ArrowsDownUp,
  XCircle,
  CaretUp,
  CaretDown,
  CaretLeft,
  CaretRight,
  GlobeSimple,
  Buildings,
  Package,
  CurrencyDollar,
  Megaphone,
  Target,
  ShieldCheck,
  Warning,
  Lightbulb,
  Tag,
  Storefront,
  CheckCircle,
  ChartPie,
} from "@phosphor-icons/react";
import { Card, CardContent } from "@/components/ui/card.js";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs.js";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group.js";
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
  Pie,
  PieChart,
  Cell,
} from "recharts";
import { useProjectId } from "../store/StoreContext.js";
import { api } from "../lib/api.js";
import type { Sender, IncomingEmail, SenderStats, SenderProfileData, PricingSnapshot, SenderStrategyData, EmailClassification } from "../store/types.js";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible.js";

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

// --- Sender Avatar ---

function SenderAvatar({ sender, size = 32 }: { sender: Pick<Sender, "name" | "website" | "logo_url">; size?: number }) {
  const [imgFailed, setImgFailed] = useState(false);

  const src = useMemo(() => {
    if (sender.logo_url) return sender.logo_url;
    if (sender.website) {
      try {
        const hostname = new URL(sender.website).hostname;
        return `https://www.google.com/s2/favicons?domain=${hostname}&sz=${size * 2}`;
      } catch {}
    }
    return null;
  }, [sender.logo_url, sender.website, size]);

  if (src && !imgFailed) {
    return (
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        className="rounded-lg object-contain bg-neutral-100"
        loading="lazy"
        onError={() => setImgFailed(true)}
      />
    );
  }

  return (
    <span className="text-[11px] font-bold text-primary select-none">
      {sender.name.charAt(0).toUpperCase()}
    </span>
  );
}

// --- Sparkline + trend helpers ---

const sparklineConfig: ChartConfig = {
  count: { label: "Emails", color: "var(--color-primary)" },
};

function Sparkline({ sparkline, days = 30, name }: { sparkline: number[]; days?: number; name: string }) {
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

  const gradientId = `sparkline-gradient-${name.replace(/[^a-zA-Z0-9]/g, "-")}`;

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
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop
              offset="5%"
              stopColor="var(--color-primary)"
              stopOpacity={0.3}
            />
            <stop
              offset="95%"
              stopColor="var(--color-primary)"
              stopOpacity={0}
            />
          </linearGradient>
        </defs>
        <Area
          dataKey="count"
          type="monotone"
          fill={`url(#${gradientId})`}
          stroke="var(--color-primary)"
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
      <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-transparent font-bold text-[9px] uppercase tracking-wider px-1.5 h-5 flex items-center gap-1">
        <TrendUp size={10} weight="bold" />
        Increasing
      </Badge>
    );
  }
  if (delta < 0) {
    return (
      <Badge variant="secondary" className="bg-rose-500/10 text-rose-600 dark:text-rose-400 border-transparent font-bold text-[9px] uppercase tracking-wider px-1.5 h-5 flex items-center gap-1">
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
  refreshingLogos,
  refreshingProfiles,
  onSelect,
  onResolveAll,
  onRefreshLogos,
  onRefreshProfiles,
  stats,
}: {
  senders: Sender[];
  domains: Domain[];
  loading: boolean;
  resolving: boolean;
  refreshingLogos: boolean;
  refreshingProfiles: boolean;
  onSelect: (senderId: string) => void;
  onResolveAll: () => void;
  onRefreshLogos: () => void;
  onRefreshProfiles: (all?: boolean) => void;
  stats: Record<string, SenderStats> | null;
}) {
  const [countryFilter, setCountryFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [timeframe, setTimeframe] = useState<number>(30);
  const [sortBy, setSortBy] = useState<"name" | "total" | "trending" | "declining" | "country">("total");
  const [sortOrder, setSortOrder] = useState<"desc" | "asc">("desc");
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const unlinkedDomains = domains.filter((d) => !d.sender_id);

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
    let result = [...senders];
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

    result.sort((a, b) => {
      let valA: any;
      let valB: any;

      if (sortBy === "name") {
        valA = a.name.toLowerCase();
        valB = b.name.toLowerCase();
      } else if (sortBy === "country") {
        valA = a.country || "ZZ";
        valB = b.country || "ZZ";
      } else {
        const stA = stats?.[a.id];
        const stB = stats?.[b.id];
        if (sortBy === "total") {
          valA = stA?.sparkline.slice(-timeframe).reduce((s, v) => s + v, 0) ?? 0;
          valB = stB?.sparkline.slice(-timeframe).reduce((s, v) => s + v, 0) ?? 0;
        } else if (sortBy === "trending" || sortBy === "declining") {
          valA = stA ? periodTrend(stA.sparkline, timeframe).delta : 0;
          valB = stB ? periodTrend(stB.sparkline, timeframe).delta : 0;
        }
      }

      if (valA < valB) return sortOrder === "asc" ? -1 : 1;
      if (valA > valB) return sortOrder === "asc" ? 1 : -1;
      return 0;
    });

    return result;
  }, [senders, domains, countryFilter, search, sortBy, sortOrder, stats, timeframe]);

  // Reset page when filters change
  useEffect(() => {
    setPage(1);
  }, [search, countryFilter, timeframe, sortBy, sortOrder]);

  const totalPages = Math.ceil(filteredSenders.length / pageSize);
  const paginatedSenders = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredSenders.slice(start, start + pageSize);
  }, [filteredSenders, page, pageSize]);

  const toggleSort = (field: typeof sortBy) => {
    if (sortBy === field) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortBy(field);
      setSortOrder(field === "name" || field === "country" ? "asc" : "desc");
    }
  };

  const SortIcon = ({ field }: { field: typeof sortBy }) => {
    if (sortBy !== field) return <ArrowsDownUp size={10} className="ml-1 opacity-20" />;
    return sortOrder === "asc" ? (
      <CaretUp size={10} weight="bold" className="ml-1 text-primary" />
    ) : (
      <CaretDown size={10} weight="bold" className="ml-1 text-primary" />
    );
  };

  const filteredUnlinkedDomains = useMemo(() => {
    if (!search.trim()) return unlinkedDomains;
    const q = search.trim().toLowerCase();
    return unlinkedDomains.filter((d) => d.domain.toLowerCase().includes(q));
  }, [unlinkedDomains, search]);

  if (loading) {
    return (
      <div className="flex-1 overflow-y-auto p-6 bg-background">
        <div className="max-w-5xl mx-auto space-y-8">
          <div className="flex flex-col gap-1 border-b border-border/40 pb-6">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Senders</h1>
            <p className="text-sm text-muted-foreground mt-1">Loading senders and stats...</p>
          </div>
          <div className="flex items-center justify-center py-24 bg-card border border-border/60 rounded-xl shadow-sm">
            <CircleNotch size={24} className="animate-spin text-muted-foreground" />
          </div>
        </div>
      </div>
    );
  }

  if (senders.length === 0 && unlinkedDomains.length === 0) {
    return (
      <div className="flex-1 overflow-y-auto p-6 bg-background">
        <div className="max-w-5xl mx-auto space-y-8">
          <div className="flex flex-col gap-1 border-b border-border/40 pb-6">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Senders</h1>
            <p className="text-sm text-muted-foreground mt-1">0 senders &middot; 0 total emails</p>
          </div>
          <div className="text-center py-24 bg-card border border-border/60 rounded-xl shadow-sm">
            <UsersThree
              size={40}
              weight="duotone"
              className="mx-auto mb-3 text-muted-foreground"
            />
            <p className="text-sm text-muted-foreground font-medium">No senders yet</p>
            <p className="text-xs text-muted-foreground mt-1">
              Senders are automatically identified when emails arrive.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-6 bg-background">
      <div className="max-w-5xl mx-auto space-y-8">
        {/* Page Header */}
        <div className="flex flex-col gap-1 border-b border-border/40 pb-6">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
              Senders
              <Badge variant="outline" className="font-mono text-[10px] py-0 h-4 px-1.5 opacity-60">
                {senders.length}
              </Badge>
            </h1>
            <div className="flex items-center gap-1.5">
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => onRefreshProfiles(e.shiftKey)}
                disabled={refreshingProfiles}
                className="h-8 w-8 p-0 text-muted-foreground/50 hover:text-foreground"
                title="Generate missing profiles (shift-click to refresh all)"
              >
                {refreshingProfiles ? (
                  <CircleNotch size={14} className="animate-spin" />
                ) : (
                  <Buildings size={14} />
                )}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={onRefreshLogos}
                disabled={refreshingLogos}
                className="h-8 w-8 p-0 text-muted-foreground/50 hover:text-foreground"
                title="Refresh sender logos"
              >
                {refreshingLogos ? (
                  <CircleNotch size={14} className="animate-spin" />
                ) : (
                  <ArrowsClockwise size={14} />
                )}
              </Button>
              {unlinkedDomains.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onResolveAll}
                  disabled={resolving}
                  className="h-8 text-xs font-semibold px-3"
                >
                  {resolving ? (
                    <CircleNotch size={14} className="animate-spin mr-2" />
                  ) : (
                    <MagicWand size={14} className="mr-2" />
                  )}
                  Resolve all ({unlinkedDomains.length})
                </Button>
              )}
            </div>
          </div>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Monitor sender activity and trends. Senders are automatically identified and grouped from incoming emails.
          </p>
        </div>

        {/* Unified Search & List Container */}
        <div className="flex flex-col border border-border/60 rounded-xl overflow-hidden shadow-sm bg-card">
          {/* Top Panel: Filters & Controls */}
          <div className="flex items-center justify-between gap-4 p-2 border-b border-border/60">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <div className="relative flex-1 max-w-sm group">
                <MagnifyingGlass
                  size={14}
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/60"
                />
                <Input
                  placeholder="Search senders..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="h-8 text-xs pl-8 pr-8 border-transparent bg-muted/30 focus-visible:bg-muted/50 transition-colors w-full shadow-none"
                />
                {search && (
                  <button
                    onClick={() => setSearch("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground/40 hover:text-foreground transition-colors"
                  >
                    <XCircle size={14} weight="fill" />
                  </button>
                )}
              </div>
              
              {availableCountries.length > 0 && (
                <div className="relative">
                  <Select value={countryFilter} onValueChange={setCountryFilter}>
                    <SelectTrigger className="w-[140px] h-8 text-xs border-transparent bg-muted/30 shadow-none pr-8">
                      <Globe size={13} className="mr-1.5 text-muted-foreground/60" />
                      <SelectValue placeholder="Country" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Countries</SelectItem>
                      <SelectSeparator />
                      {availableCountries.map((code) => (
                        <SelectItem key={code} value={code}>
                          {countryLabel(code)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {countryFilter !== "all" && (
                    <button
                      onClick={() => setCountryFilter("all")}
                      className="absolute right-7 top-1/2 -translate-y-1/2 text-muted-foreground/40 hover:text-foreground transition-colors"
                    >
                      <XCircle size={12} weight="fill" />
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="flex items-center gap-3 shrink-0">
              <div className="flex items-center gap-1.5 bg-muted/30 p-1 rounded-lg border border-border/40">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground px-1.5 opacity-50">View</span>
                <ToggleGroup
                  type="single"
                  value={String(timeframe)}
                  onValueChange={(v) => v && setTimeframe(Number(v))}
                  className="h-6"
                >
                  {[7, 14, 30].map((d) => (
                    <ToggleGroupItem
                      key={d}
                      value={String(d)}
                      className="h-6 px-2 text-[10px] font-bold min-w-0 data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-sm"
                    >
                      {d}D
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </div>

              <Select value={sortBy} onValueChange={(v) => setSortBy(v as any)}>
                <SelectTrigger className="w-[130px] h-8 text-xs border-transparent bg-muted/30 shadow-none">
                  <ArrowsDownUp size={13} className="mr-1.5 text-muted-foreground/60" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="name">Name</SelectItem>
                  <SelectItem value="country">Region</SelectItem>
                  <SelectItem value="total">Most emails</SelectItem>
                  <SelectItem value="trending">Trending up</SelectItem>
                  <SelectItem value="declining">Trending down</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* List Section */}
          {paginatedSenders.length > 0 ? (
            <div className="p-1">
              {/* Table Header */}
              <div className="flex items-center gap-4 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground border-b border-border/50 mb-1">
                <div className="w-8 shrink-0" /> {/* Avatar space */}
                <button
                  onClick={() => toggleSort("name")}
                  className="flex-1 min-w-0 flex items-center hover:text-foreground transition-colors text-left"
                >
                  Sender
                  <SortIcon field="name" />
                </button>
                <div className="w-32 shrink-0 text-center">Activity</div>
                <button
                  onClick={() => toggleSort("trending")}
                  className="w-24 shrink-0 flex items-center justify-end hover:text-foreground transition-colors"
                >
                  Trend
                  <SortIcon field="trending" />
                </button>
                <button
                  onClick={() => toggleSort("total")}
                  className="w-20 shrink-0 flex items-center justify-end hover:text-foreground transition-colors"
                >
                  Vol
                  <SortIcon field="total" />
                </button>
              </div>
              <div className="divide-y divide-border/40">
                {paginatedSenders.map((s) => {
                  const st = stats?.[s.id];
                  const periodTotal = st?.sparkline.slice(-timeframe).reduce((a, b) => a + b, 0) ?? 0;
                  return (
                    <button
                      key={s.id}
                      onClick={() => onSelect(s.id)}
                      className="w-full flex items-center gap-4 px-3 py-2.5 rounded-lg hover:bg-muted/40 transition-colors text-left group"
                    >
                      <div className="w-8 h-8 rounded-lg bg-primary/5 border border-primary/10 flex items-center justify-center shrink-0 group-hover:bg-primary/10 transition-colors overflow-hidden">
                        <SenderAvatar sender={s} size={32} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-[13px] font-bold text-foreground truncate leading-tight">
                            {s.name}
                          </p>
                          {s.country && COUNTRIES[s.country] && (
                            <span className="text-base leading-none shrink-0" title={COUNTRIES[s.country].name}>
                              {COUNTRIES[s.country].flag}
                            </span>
                          )}
                        </div>
                        <p className="text-[10px] font-medium text-muted-foreground/60 mt-1 uppercase tracking-tight">
                          {s.domain_count} domain{s.domain_count !== 1 ? "s" : ""}
                        </p>
                      </div>
                      <div className="w-32 shrink-0 flex items-center justify-center">
                        {st ? (
                          <Sparkline sparkline={st.sparkline} days={timeframe} name={s.id} />
                        ) : (
                          <span className="text-xs text-muted-foreground opacity-20">&mdash;</span>
                        )}
                      </div>
                      <div className="w-24 shrink-0 flex justify-end">
                        {st ? (
                          <TrendLabel sparkline={st.sparkline} days={timeframe} />
                        ) : (
                          <span className="text-xs text-muted-foreground opacity-20">&mdash;</span>
                        )}
                      </div>
                      <div className="w-20 shrink-0 text-right">
                        <span className="text-[13px] font-bold tabular-nums text-foreground">
                          {st ? periodTotal : s.email_count}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Pagination Footer */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between gap-4 px-3 py-4 mt-2 border-t border-border/40">
                  <p className="text-[11px] font-medium text-muted-foreground">
                    Showing <span className="text-foreground">{(page - 1) * pageSize + 1}</span> to <span className="text-foreground">{Math.min(page * pageSize, filteredSenders.length)}</span> of <span className="text-foreground">{filteredSenders.length}</span> senders
                  </p>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={page === 1}
                      onClick={() => setPage(page - 1)}
                      className="h-8 w-8 p-0"
                    >
                      <CaretLeft size={14} weight="bold" />
                    </Button>
                    <div className="flex items-center gap-1 px-2">
                      {Array.from({ length: totalPages }).map((_, i) => {
                        const p = i + 1;
                        if (totalPages > 5 && Math.abs(p - page) > 1 && p !== 1 && p !== totalPages) {
                          if (p === 2 || (p === totalPages - 1 && totalPages > 2)) return <span key={p} className="text-[10px] opacity-20 mx-0.5">...</span>;
                          return null;
                        }
                        return (
                          <Button
                            key={p}
                            variant={page === p ? "secondary" : "ghost"}
                            size="sm"
                            onClick={() => setPage(p)}
                            className={`h-7 min-w-7 px-1.5 text-[10px] font-bold ${page === p ? "bg-primary/10 text-primary" : "text-muted-foreground"}`}
                          >
                            {p}
                          </Button>
                        );
                      })}
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={page === totalPages}
                      onClick={() => setPage(page + 1)}
                      className="h-8 w-8 p-0"
                    >
                      <CaretRight size={14} weight="bold" />
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="py-24 text-center">
              <MagnifyingGlass
                size={32}
                className="mx-auto mb-3 text-muted-foreground opacity-20"
              />
              <p className="text-sm text-muted-foreground font-medium">No results found</p>
              <p className="text-xs text-muted-foreground mt-1">
                Try adjusting your search or filters to find what you're looking for.
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setSearch("");
                  setCountryFilter("all");
                }}
                className="mt-6 h-8 text-xs px-4 border-dashed hover:border-solid transition-all"
              >
                Clear all filters
              </Button>
            </div>
          )}
        </div>

        {/* Unlinked domains */}
        {filteredUnlinkedDomains.length > 0 && (
          <div className="space-y-4">
            <div className="flex flex-col gap-1">
              <h2 className="text-lg font-bold tracking-tight text-foreground">
                Unlinked domains
              </h2>
              <p className="text-xs text-muted-foreground">
                {filteredUnlinkedDomains.length} domain{filteredUnlinkedDomains.length !== 1 ? "s" : ""} not yet linked to a sender
              </p>
            </div>
            <div className="border border-border/60 rounded-xl overflow-hidden shadow-sm bg-card p-2">
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
            </div>
          </div>
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

// --- Profile Section ---

function ProfileSection({
  icon: Icon,
  title,
  content,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  title: string;
  content?: string;
}) {
  const [open, setOpen] = useState(false);
  if (!content || content === "Not enough information available.") return null;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex items-center gap-2 w-full py-2 px-1 rounded-md hover:bg-muted/40 transition-colors text-left group">
        <Icon size={14} className="text-muted-foreground shrink-0" />
        <span className="text-sm font-medium text-foreground flex-1">{title}</span>
        <CaretRight
          size={12}
          className={`text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`}
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <p className="text-sm text-muted-foreground pl-7 pb-2 leading-relaxed">
          {content}
        </p>
      </CollapsibleContent>
    </Collapsible>
  );
}

function PricingSnapshotCard({ snapshot }: { snapshot: PricingSnapshot }) {
  const cur = snapshot.currency || "USD";
  const fmt = (v: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: cur, maximumFractionDigits: 0 }).format(v);

  const cheapest = snapshot.cheapest_product;
  const expensive = snapshot.most_expensive_product;
  const discount = snapshot.deepest_discount_pct;

  const hasData =
    (cheapest?.name && cheapest.price > 0) ||
    (expensive?.name && expensive.price > 0) ||
    (discount && discount > 0);

  if (!hasData) return null;

  return (
    <div className="grid grid-cols-3 gap-3 pl-7 py-2">
      {cheapest?.name && cheapest.price > 0 && (
        <div className="rounded-lg border border-border/50 bg-muted/20 p-2.5">
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Cheapest</p>
          <p className="text-base font-bold text-foreground mt-0.5">{fmt(cheapest.price)}</p>
          <p className="text-xs text-muted-foreground truncate mt-0.5" title={cheapest.name}>{cheapest.name}</p>
        </div>
      )}
      {expensive?.name && expensive.price > 0 && (
        <div className="rounded-lg border border-border/50 bg-muted/20 p-2.5">
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Most expensive</p>
          <p className="text-base font-bold text-foreground mt-0.5">{fmt(expensive.price)}</p>
          <p className="text-xs text-muted-foreground truncate mt-0.5" title={expensive.name}>{expensive.name}</p>
        </div>
      )}
      {discount != null && discount > 0 && (
        <div className="rounded-lg border border-border/50 bg-muted/20 p-2.5">
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Deepest discount</p>
          <p className="text-base font-bold text-foreground mt-0.5">{discount}%</p>
          <p className="text-xs text-muted-foreground mt-0.5">off</p>
        </div>
      )}
    </div>
  );
}

// --- Strategy Card ---

const PIE_COLORS = [
  "var(--color-primary)",
  "hsl(200 70% 50%)",
  "hsl(150 60% 45%)",
  "hsl(35 90% 55%)",
  "hsl(280 60% 55%)",
  "hsl(0 70% 55%)",
  "hsl(180 50% 45%)",
  "hsl(60 70% 45%)",
];

const FUNNEL_COLORS: Record<string, string> = {
  awareness: "hsl(200 70% 50%)",
  consideration: "hsl(35 90% 55%)",
  conversion: "hsl(150 60% 45%)",
  retention: "hsl(280 60% 55%)",
};

function CollapsibleSection({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button className="flex items-center justify-between w-full py-2 text-sm font-medium text-foreground hover:text-primary transition-colors">
          <span>{title}</span>
          {open ? <CaretUp size={14} /> : <CaretDown size={14} />}
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="pb-3 text-sm text-muted-foreground">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function StatBox({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-border/50 bg-muted/20 p-2.5 text-center">
      <p className="text-base font-bold text-foreground">{value}</p>
      <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mt-0.5">{label}</p>
    </div>
  );
}

function StrategyCard({
  senderId,
  projectId,
}: {
  senderId: string;
  projectId: string;
}) {
  const [strategy, setStrategy] = useState<SenderStrategyData | null>(null);
  const [classifications, setClassifications] = useState<EmailClassification[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    setLoading(true);
    Promise.allSettled([
      api.get<{ strategy: SenderStrategyData | null }>(
        `/api/projects/${projectId}/senders/${senderId}/strategy`
      ),
      api.get<{ classifications: EmailClassification[] }>(
        `/api/projects/${projectId}/senders/${senderId}/classifications`
      ),
    ]).then(([stratRes, classRes]) => {
      if (stratRes.status === "fulfilled") setStrategy(stratRes.value.strategy);
      if (classRes.status === "fulfilled") setClassifications(classRes.value.classifications);
    }).finally(() => setLoading(false));
  }, [projectId, senderId]);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      await api.post(`/api/projects/${projectId}/senders/${senderId}/strategy`);
      const [stratRes, classRes] = await Promise.allSettled([
        api.get<{ strategy: SenderStrategyData | null }>(
          `/api/projects/${projectId}/senders/${senderId}/strategy`
        ),
        api.get<{ classifications: EmailClassification[] }>(
          `/api/projects/${projectId}/senders/${senderId}/classifications`
        ),
      ]);
      if (stratRes.status === "fulfilled") setStrategy(stratRes.value.strategy);
      if (classRes.status === "fulfilled") setClassifications(classRes.value.classifications);
    } catch (err: any) {
      alert(err.message || "Failed to generate strategy");
    } finally {
      setGenerating(false);
    }
  };

  const s = strategy?.strategy;

  const contentMixData = useMemo(() => {
    if (!s?.content_strategy?.content_mix) return [];
    return Object.entries(s.content_strategy.content_mix)
      .filter(([, v]) => v > 0)
      .map(([key, value]) => ({
        name: key.charAt(0).toUpperCase() + key.slice(1),
        value,
      }));
  }, [s?.content_strategy?.content_mix]);

  const contentMixConfig: ChartConfig = useMemo(() => {
    const cfg: ChartConfig = {};
    contentMixData.forEach((d, i) => {
      cfg[d.name] = { label: d.name, color: PIE_COLORS[i % PIE_COLORS.length] };
    });
    return cfg;
  }, [contentMixData]);

  const cadenceDayData = useMemo(() => {
    if (!s?.cadence?.peak_days) return [];
    const allDays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
    return allDays.map((day) => ({
      day: day.slice(0, 3),
      peak: s.cadence!.peak_days.includes(day) ? 1 : 0,
    }));
  }, [s?.cadence?.peak_days]);

  const cadenceConfig: ChartConfig = {
    peak: { label: "Peak day", color: "var(--color-primary)" },
  };

  const discountTrendData = useMemo(() => {
    if (!classifications.length) return [];
    const withDiscount = classifications
      .filter((c) => c.discount_pct != null && c.discount_pct > 0)
      .sort((a, b) => a.classified_at.localeCompare(b.classified_at));
    if (!withDiscount.length) return [];
    return withDiscount.map((c) => ({
      date: new Date(c.classified_at).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
      discount: c.discount_pct,
    }));
  }, [classifications]);

  const discountConfig: ChartConfig = {
    discount: { label: "Discount %", color: "hsl(35 90% 55%)" },
  };

  const funnelData = useMemo(() => {
    if (!s?.funnel_mapping) return [];
    return [
      { stage: "Awareness", pct: s.funnel_mapping.awareness, fill: FUNNEL_COLORS.awareness },
      { stage: "Consideration", pct: s.funnel_mapping.consideration, fill: FUNNEL_COLORS.consideration },
      { stage: "Conversion", pct: s.funnel_mapping.conversion, fill: FUNNEL_COLORS.conversion },
      { stage: "Retention", pct: s.funnel_mapping.retention, fill: FUNNEL_COLORS.retention },
    ];
  }, [s?.funnel_mapping]);

  const funnelConfig: ChartConfig = {
    pct: { label: "%" },
  };

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-foreground">Email strategy</h3>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleGenerate}
            disabled={generating}
          >
            {generating ? (
              <CircleNotch size={14} className="animate-spin mr-1.5" />
            ) : (
              <MagicWand size={14} className="mr-1.5" />
            )}
            {strategy ? "Regenerate" : "Analyze"}
          </Button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <CircleNotch size={20} className="animate-spin text-muted-foreground" />
          </div>
        ) : !strategy ? (
          <div className="text-center py-8 text-muted-foreground">
            <ChartPie size={32} weight="duotone" className="mx-auto mb-2 opacity-40" />
            <p className="text-sm">No strategy analysis yet</p>
            <p className="text-xs mt-1">Click Analyze to classify emails and generate insights</p>
          </div>
        ) : (
          <div className="space-y-5">
            {s?.executive_summary && (
              <p className="text-sm text-muted-foreground leading-relaxed">{s.executive_summary}</p>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {contentMixData.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-foreground mb-2">Email type mix</p>
                  <ChartContainer config={contentMixConfig} className="aspect-square max-h-[200px] w-full">
                    <PieChart>
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Pie
                        data={contentMixData}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        innerRadius={40}
                        outerRadius={80}
                        strokeWidth={2}
                      >
                        {contentMixData.map((_, i) => (
                          <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                        ))}
                      </Pie>
                    </PieChart>
                  </ChartContainer>
                  <div className="flex flex-wrap gap-2 mt-2 justify-center">
                    {contentMixData.map((d, i) => (
                      <span key={d.name} className="flex items-center gap-1 text-[11px] text-muted-foreground">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }} />
                        {d.name} ({d.value}%)
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {cadenceDayData.length > 0 && s?.cadence && (
                <div>
                  <p className="text-xs font-medium text-foreground mb-2">Cadence</p>
                  <ChartContainer config={cadenceConfig} className="aspect-[2/1] w-full">
                    <BarChart data={cadenceDayData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                      <CartesianGrid vertical={false} />
                      <XAxis dataKey="day" tickLine={false} axisLine={false} tickMargin={8} />
                      <YAxis hide />
                      <Bar dataKey="peak" radius={[4, 4, 0, 0]} fill="var(--color-peak)" />
                    </BarChart>
                  </ChartContainer>
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    <StatBox label="Avg/week" value={s.cadence.avg_per_week} />
                    <StatBox label="Consistency" value={`${Math.round(s.cadence.consistency_score * 100)}%`} />
                  </div>
                </div>
              )}
            </div>

            {discountTrendData.length > 0 && (
              <div>
                <p className="text-xs font-medium text-foreground mb-2">Discount trend</p>
                <ChartContainer config={discountConfig} className="aspect-[3/1] w-full">
                  <AreaChart data={discountTrendData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                    <defs>
                      <linearGradient id="fillDiscount" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--color-discount)" stopOpacity={0.3} />
                        <stop offset="100%" stopColor="var(--color-discount)" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid vertical={false} />
                    <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={8} interval="preserveStartEnd" />
                    <YAxis tickLine={false} axisLine={false} tickMargin={4} unit="%" />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Area dataKey="discount" type="monotone" stroke="var(--color-discount)" fill="url(#fillDiscount)" strokeWidth={2} />
                  </AreaChart>
                </ChartContainer>
              </div>
            )}

            {s?.email_flows && s.email_flows.length > 0 && (
              <div>
                <p className="text-xs font-medium text-foreground mb-2">Email flows</p>
                <div className="space-y-1.5">
                  {s.email_flows.map((flow) => (
                    <div key={flow.name} className="flex items-center gap-2">
                      {flow.detected ? (
                        <CheckCircle size={14} className="text-green-500 shrink-0" />
                      ) : (
                        <XCircle size={14} className="text-muted-foreground/40 shrink-0" />
                      )}
                      <span className={`text-sm ${flow.detected ? "text-foreground" : "text-muted-foreground/60"}`}>
                        {flow.name}
                      </span>
                      {flow.detected && flow.email_count > 0 && (
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                          {flow.email_count} email{flow.email_count !== 1 ? "s" : ""}
                        </Badge>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {s?.subject_line_analysis && (
              <div>
                <p className="text-xs font-medium text-foreground mb-2">Subject line insights</p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  <StatBox label="Avg length" value={s.subject_line_analysis.avg_length} />
                  <StatBox label="Emoji %" value={`${s.subject_line_analysis.emoji_pct}%`} />
                  <StatBox label="Urgency %" value={`${s.subject_line_analysis.urgency_pct}%`} />
                  <StatBox label="Personal %" value={`${s.subject_line_analysis.personalization_pct}%`} />
                </div>
              </div>
            )}

            {funnelData.length > 0 && (
              <div>
                <p className="text-xs font-medium text-foreground mb-2">Funnel distribution</p>
                <ChartContainer config={funnelConfig} className="aspect-[4/1] w-full">
                  <BarChart data={funnelData} layout="vertical" margin={{ top: 0, right: 4, bottom: 0, left: 0 }}>
                    <CartesianGrid horizontal={false} />
                    <YAxis dataKey="stage" type="category" tickLine={false} axisLine={false} width={90} tickMargin={4} />
                    <XAxis type="number" tickLine={false} axisLine={false} unit="%" />
                    <ChartTooltip content={<ChartTooltipContent hideLabel />} />
                    <Bar dataKey="pct" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ChartContainer>
              </div>
            )}

            <div className="border-t border-border/40 pt-2 space-y-0">
              {s?.promotional_calendar && (
                <CollapsibleSection title="Promotional calendar">
                  {s.promotional_calendar}
                </CollapsibleSection>
              )}
              {s?.discount_strategy && (
                <CollapsibleSection title="Discount strategy">
                  <div className="space-y-1">
                    <p><strong>Avg discount:</strong> {s.discount_strategy.avg_discount_pct}%</p>
                    <p><strong>Max discount:</strong> {s.discount_strategy.max_discount_pct}%</p>
                    <p><strong>Frequency:</strong> {s.discount_strategy.frequency}</p>
                    <p><strong>Tactics:</strong> {s.discount_strategy.tactics}</p>
                  </div>
                </CollapsibleSection>
              )}
              {s?.segmentation_signals && (
                <CollapsibleSection title="Segmentation signals">
                  {s.segmentation_signals}
                </CollapsibleSection>
              )}
              {s?.ab_testing_signals && (
                <CollapsibleSection title="A/B testing signals">
                  {s.ab_testing_signals}
                </CollapsibleSection>
              )}
              {s?.competitive_insights && (
                <CollapsibleSection title="Competitive insights">
                  {s.competitive_insights}
                </CollapsibleSection>
              )}
              {s?.recommendations && s.recommendations.length > 0 && (
                <CollapsibleSection title="Recommendations">
                  <ul className="list-disc list-inside space-y-1">
                    {s.recommendations.map((rec, i) => (
                      <li key={i}>{rec}</li>
                    ))}
                  </ul>
                </CollapsibleSection>
              )}
            </div>

            <div className="pt-3 border-t border-border/40">
              <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                <span>{strategy.email_count} emails analyzed</span>
                {strategy.date_range_start && strategy.date_range_end && (
                  <span>
                    {new Date(strategy.date_range_start).toLocaleDateString()} – {new Date(strategy.date_range_end).toLocaleDateString()}
                  </span>
                )}
                <span>Generated {new Date(strategy.generated_at).toLocaleDateString()}</span>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
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
  const [profile, setProfile] = useState<SenderProfileData | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
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

  // Fetch sender profile
  useEffect(() => {
    setProfileLoading(true);
    api.get<{ profile: SenderProfileData | null }>(
      `/api/projects/${projectId}/senders/${sender.id}/profile`
    ).then((data) => {
      setProfile(data.profile);
    }).catch(() => {}).finally(() => {
      setProfileLoading(false);
    });
  }, [projectId, sender.id]);

  const handleGenerateProfile = async () => {
    setGenerating(true);
    try {
      const data = await api.post<{ profile: Record<string, string>; sourceUrls: string[] }>(
        `/api/projects/${projectId}/senders/${sender.id}/profile`
      );
      // Refetch to get the full row
      const refreshed = await api.get<{ profile: SenderProfileData | null }>(
        `/api/projects/${projectId}/senders/${sender.id}/profile`
      );
      setProfile(refreshed.profile);
    } catch (err: any) {
      alert(err.message || "Failed to generate profile");
    } finally {
      setGenerating(false);
    }
  };

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
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <button
              onClick={onBack}
              className="w-8 h-8 rounded-lg hover:bg-muted flex items-center justify-center transition-colors"
            >
              <ArrowLeft size={18} className="text-muted-foreground" />
            </button>
            <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 overflow-hidden">
              <SenderAvatar sender={sender} size={36} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-semibold text-foreground truncate">
                  {sender.name}
                </h1>
                {sender.country && COUNTRIES[sender.country] && (
                  <span className="text-base leading-none shrink-0" title={COUNTRIES[sender.country].name}>
                    {COUNTRIES[sender.country].flag}
                  </span>
                )}
              </div>
              {sender.website && (
                <p className="text-xs text-muted-foreground truncate">
                  {sender.website}
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

          {/* Inline KPIs + tags */}
          <div className="flex items-center gap-3 flex-wrap pl-[68px]">
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <EnvelopeSimple size={13} className="text-muted-foreground/60" />
              <span className="font-semibold text-foreground tabular-nums">{total}</span> emails
            </span>
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <TrendUp size={13} className="text-muted-foreground/60" />
              <span className="font-semibold text-foreground tabular-nums">{avgPerDay}</span>/day
            </span>
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <LinkSimple size={13} className="text-muted-foreground/60" />
              <span className="font-semibold text-foreground tabular-nums">{senderDomains.length}</span> domain{senderDomains.length !== 1 ? "s" : ""}
            </span>
            {profile?.profile.industry && (
              <span className="inline-flex items-center text-[11px] font-medium bg-primary/10 text-primary rounded-md px-1.5 py-0.5">
                {profile.profile.industry}
              </span>
            )}
            {profile?.profile.tags?.map((tag, i) => (
              <span key={i} className="inline-flex items-center text-[11px] bg-muted/60 text-muted-foreground rounded-md px-1.5 py-0.5">
                {tag}
              </span>
            ))}
          </div>
        </div>

        <Tabs defaultValue="overview">
          <TabsList variant="line">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="company">Company</TabsTrigger>
            <TabsTrigger value="strategy">Strategy</TabsTrigger>
            <TabsTrigger value="emails">Emails</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-6 mt-6">
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

        {/* Volume chart - full width */}
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

        {/* About + Recent emails */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* About card */}
          <Card>
            <CardContent className="p-4">
              <h3 className="text-sm font-semibold text-foreground mb-3">About</h3>
              <div className="space-y-2.5">
                {sender.description && (
                  <p className="text-sm text-muted-foreground leading-relaxed">{sender.description}</p>
                )}
                {sender.website && (
                  <div className="flex items-center gap-2">
                    <GlobeSimple size={14} className="text-muted-foreground shrink-0" />
                    <a
                      href={sender.website}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-primary hover:underline truncate"
                    >
                      {sender.website}
                    </a>
                  </div>
                )}
                {sender.country && COUNTRIES[sender.country] && (
                  <div className="flex items-center gap-2">
                    <span className="text-base leading-none">{COUNTRIES[sender.country].flag}</span>
                    <span className="text-sm text-muted-foreground">{COUNTRIES[sender.country].name}</span>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <LinkSimple size={14} className="text-muted-foreground shrink-0" />
                  <span className="text-sm text-muted-foreground">
                    {senderDomains.length} domain{senderDomains.length !== 1 ? "s" : ""}
                  </span>
                </div>
                {profile && (profile.profile.industry || (profile.profile.tags && profile.profile.tags.length > 0)) && (
                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    {profile.profile.industry && (
                      <span className="inline-flex items-center text-xs font-medium bg-primary/10 text-primary rounded-md px-2 py-0.5">
                        {profile.profile.industry}
                      </span>
                    )}
                    {profile.profile.tags?.map((tag, i) => (
                      <span key={i} className="inline-flex items-center text-[11px] bg-muted/60 text-muted-foreground rounded-md px-1.5 py-0.5">
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Recent emails */}
          <Card>
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
                <div className="space-y-1">
                  {recent.map((e) => (
                    <a
                      key={e.id}
                      href={`/app/inbox?email=${e.id}`}
                      onClick={(ev) => {
                        ev.preventDefault();
                        window.history.pushState(null, "", `/app/inbox?email=${e.id}`);
                        window.dispatchEvent(new PopStateEvent("popstate"));
                      }}
                      className="flex items-start gap-3 rounded-md px-2 py-2 -mx-2 hover:bg-muted/50 transition-colors"
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
                    </a>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
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
          </TabsContent>

          <TabsContent value="company" className="mt-6">
        {/* Company profile */}
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-foreground">
                Company profile
              </h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleGenerateProfile}
                disabled={generating || !sender.website}
                title={!sender.website ? "Add a website to generate a profile" : undefined}
              >
                {generating ? (
                  <CircleNotch size={14} className="animate-spin mr-1.5" />
                ) : (
                  <MagicWand size={14} className="mr-1.5" />
                )}
                {profile ? "Regenerate" : "Generate"}
              </Button>
            </div>
            {profileLoading ? (
              <div className="flex items-center justify-center py-8">
                <CircleNotch size={20} className="animate-spin text-muted-foreground" />
              </div>
            ) : !profile ? (
              <div className="text-center py-8 text-muted-foreground">
                <Buildings size={32} weight="duotone" className="mx-auto mb-2 opacity-40" />
                <p className="text-sm">No profile generated yet</p>
                <p className="text-xs mt-1">
                  {sender.website
                    ? "Click Generate to create a company analysis"
                    : "Add a website URL to this sender first"}
                </p>
              </div>
            ) : (
              <div className="space-y-1">
                <ProfileSection icon={Buildings} title="Company profile" content={profile.profile.company_profile} />

                {/* Industry & tags */}
                {(profile.profile.industry || (profile.profile.tags && profile.profile.tags.length > 0)) && (
                  <div className="flex flex-wrap items-center gap-1.5 pl-7 py-1.5">
                    {profile.profile.industry && (
                      <span className="inline-flex items-center text-xs font-medium bg-primary/10 text-primary rounded-md px-2 py-0.5">
                        {profile.profile.industry}
                      </span>
                    )}
                    {profile.profile.tags?.map((tag, i) => (
                      <span key={i} className="inline-flex items-center text-[11px] bg-muted/60 text-muted-foreground rounded-md px-1.5 py-0.5">
                        {tag}
                      </span>
                    ))}
                  </div>
                )}

                <ProfileSection icon={Target} title="Target audiences" content={profile.profile.target_audiences} />
                <ProfileSection icon={Package} title="Product portfolio" content={profile.profile.product_portfolio} />

                {/* Top products */}
                {profile.profile.top_products && profile.profile.top_products.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pl-7 py-1.5">
                    {profile.profile.top_products.map((p, i) => (
                      <span key={i} className="inline-flex items-center gap-1 text-xs bg-muted/60 text-foreground rounded-md px-2 py-0.5">
                        <Storefront size={10} className="text-muted-foreground" />
                        {p}
                      </span>
                    ))}
                  </div>
                )}

                {/* Pricing snapshot */}
                {profile.profile.pricing_snapshot && (
                  <PricingSnapshotCard snapshot={profile.profile.pricing_snapshot} />
                )}

                <ProfileSection icon={Tag} title="Ongoing sales" content={profile.profile.ongoing_sales} />
                <ProfileSection icon={CurrencyDollar} title="Pricing strategy" content={profile.profile.pricing_strategy} />
                <ProfileSection icon={Megaphone} title="Marketing approach" content={profile.profile.marketing_approach} />
                <ProfileSection icon={ShieldCheck} title="Strengths" content={profile.profile.strengths} />
                <ProfileSection icon={Warning} title="Weaknesses" content={profile.profile.weaknesses} />
                <ProfileSection icon={Lightbulb} title="Recommendations" content={profile.profile.recommendations} />

                {profile.source_urls.length > 0 && (
                  <div className="pt-3 border-t border-border/40 mt-3">
                    <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
                      Sources
                    </p>
                    <div className="space-y-0.5">
                      {profile.source_urls.map((url, i) => (
                        <a
                          key={i}
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block text-xs text-muted-foreground hover:text-foreground truncate transition-colors"
                        >
                          {url}
                        </a>
                      ))}
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-2">
                      Generated {new Date(profile.generated_at).toLocaleDateString()}
                    </p>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

          </TabsContent>

          <TabsContent value="strategy" className="mt-6">
        {/* Email strategy */}
        <StrategyCard senderId={sender.id} projectId={projectId} />
          </TabsContent>

          <TabsContent value="emails" className="mt-6 space-y-6">
        {/* All emails */}
        <Card>
          <CardContent className="p-4">
            <div className="mb-4">
              <h3 className="text-sm font-semibold text-foreground">
                All emails
              </h3>
              <p className="text-xs text-muted-foreground">
                {senderEmails.length} email{senderEmails.length !== 1 ? "s" : ""} loaded
              </p>
            </div>
            {senderEmails.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <p className="text-sm">No emails from this sender</p>
              </div>
            ) : (
              <div className="space-y-1">
                {senderEmails.map((e) => (
                  <a
                    key={e.id}
                    href={`/app/inbox?email=${e.id}`}
                    onClick={(ev) => {
                      ev.preventDefault();
                      window.history.pushState(null, "", `/app/inbox?email=${e.id}`);
                      window.dispatchEvent(new PopStateEvent("popstate"));
                    }}
                    className="flex items-start gap-3 rounded-md px-2 py-2 -mx-2 hover:bg-muted/50 transition-colors"
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
                  </a>
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
          </TabsContent>
        </Tabs>

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
  const [selectedSenderId, setSelectedSenderId] = useState<string | null>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("sender");
  });
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

  const [refreshingLogos, setRefreshingLogos] = useState(false);
  const [refreshingProfiles, setRefreshingProfiles] = useState(false);

  const handleRefreshProfiles = async (all = false) => {
    setRefreshingProfiles(true);
    try {
      await api.post(`/api/projects/${projectId}/senders/refresh-profiles${all ? "?all=1" : ""}`);
      setTimeout(() => {
        setRefreshingProfiles(false);
      }, 15000);
    } catch (err: any) {
      alert(err.message || "Failed to refresh profiles");
      setRefreshingProfiles(false);
    }
  };

  const handleRefreshLogos = async () => {
    setRefreshingLogos(true);
    try {
      await api.post(`/api/projects/${projectId}/senders/refresh-logos`);
      // Poll for updates
      const interval = setInterval(async () => {
        await fetchData();
      }, 2000);
      setTimeout(() => {
        clearInterval(interval);
        setRefreshingLogos(false);
      }, 30000);
    } catch (err: any) {
      alert(err.message || "Failed to refresh logos");
      setRefreshingLogos(false);
    }
  };

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

  const updateSenderParam = (id: string | null) => {
    const url = new URL(window.location.href);
    if (id) {
      url.searchParams.set("sender", id);
    } else {
      url.searchParams.delete("sender");
    }
    window.history.replaceState(null, "", url.pathname + url.search);
  };

  const handleSelectSender = (id: string) => {
    setSelectedSenderId(id);
    updateSenderParam(id);
  };

  const handleBack = () => {
    setSelectedSenderId(null);
    updateSenderParam(null);
  };

  const selectedSender = senders.find((s) => s.id === selectedSenderId);

  if (selectedSender) {
    return (
      <SenderDetail
        sender={selectedSender}
        domains={domains}
        allSenders={senders}
        onBack={handleBack}
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
      refreshingLogos={refreshingLogos}
      refreshingProfiles={refreshingProfiles}
      onSelect={handleSelectSender}
      onResolveAll={handleResolveAll}
      onRefreshLogos={handleRefreshLogos}
      onRefreshProfiles={handleRefreshProfiles}
      stats={senderStats}
    />
  );
}
