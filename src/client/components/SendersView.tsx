import { useMemo, useState } from "react";
import {
  UsersThree,
  EnvelopeSimple,
  TrendUp,
  CalendarBlank,
  ArrowLeft,
  At,
} from "@phosphor-icons/react";
import { Card, CardContent } from "@/components/ui/card.js";
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
import { useIncomingEmails } from "../store/StoreContext.js";
import type { IncomingEmail } from "../store/types.js";

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

interface DomainSummary {
  domain: string;
  count: number;
  latestDate: string;
  firstDate: string;
  addresses: string[];
}

function useSenderDomains(emails: IncomingEmail[]) {
  return useMemo(() => {
    const map = new Map<
      string,
      { count: number; latestDate: string; firstDate: string; addresses: Set<string> }
    >();
    for (const e of emails) {
      const domain = e.from_domain || e.from_address.split("@")[1] || "unknown";
      const existing = map.get(domain);
      if (existing) {
        existing.count++;
        if (e.created_at > existing.latestDate) existing.latestDate = e.created_at;
        if (e.created_at < existing.firstDate) existing.firstDate = e.created_at;
        existing.addresses.add(e.from_address);
      } else {
        map.set(domain, {
          count: 1,
          latestDate: e.created_at,
          firstDate: e.created_at,
          addresses: new Set([e.from_address]),
        });
      }
    }
    return Array.from(map.entries())
      .map(([domain, data]) => ({
        domain,
        count: data.count,
        latestDate: data.latestDate,
        firstDate: data.firstDate,
        addresses: Array.from(data.addresses),
      }))
      .sort((a, b) => b.count - a.count) as DomainSummary[];
  }, [emails]);
}

function useDomainEmails(emails: IncomingEmail[], domain: string) {
  return useMemo(() => {
    return emails.filter(
      (e) => (e.from_domain || e.from_address.split("@")[1] || "unknown") === domain
    );
  }, [emails, domain]);
}

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

// --- Domain List ---

function DomainList({
  domains,
  totalEmails,
  onSelect,
}: {
  domains: DomainSummary[];
  totalEmails: number;
  onSelect: (domain: string) => void;
}) {
  if (domains.length === 0) {
    return (
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-5xl mx-auto space-y-6">
          <div>
            <h1 className="text-xl font-semibold text-foreground">Senders</h1>
            <p className="text-sm text-muted-foreground mt-1">
              0 domains &middot; 0 total emails
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
                  No sender domains yet
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Emails will be grouped by sender domain as they arrive.
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
        <div>
          <h1 className="text-xl font-semibold text-foreground">Senders</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {domains.length} domain{domains.length !== 1 ? "s" : ""} &middot;{" "}
            {totalEmails} total email{totalEmails !== 1 ? "s" : ""}
          </p>
        </div>
        <Card>
          <CardContent className="p-2">
            <div className="divide-y divide-border">
              {domains.map((d) => (
                <button
                  key={d.domain}
                  onClick={() => onSelect(d.domain)}
                  className="w-full flex items-center gap-3 p-3 rounded-lg hover:bg-muted/50 transition-colors text-left"
                >
                  <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center text-sm font-semibold text-primary shrink-0">
                    {d.domain.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                      {d.domain}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {d.addresses.length} address{d.addresses.length !== 1 ? "es" : ""}{" "}
                      &middot; Last seen {formatRelative(d.latestDate)}
                    </p>
                  </div>
                  <span className="text-xs font-medium text-muted-foreground bg-muted px-2 py-1 rounded-md tabular-nums shrink-0">
                    {d.count}
                  </span>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// --- Domain Detail ---

function DomainDetail({
  domain,
  allEmails,
  onBack,
}: {
  domain: string;
  allEmails: IncomingEmail[];
  onBack: () => void;
}) {
  const domainEmails = useDomainEmails(allEmails, domain);
  const volumeData = useDailyVolume(domainEmails, 14);
  const tagBreakdown = useTagBreakdown(domainEmails);
  const recent = domainEmails.slice(0, 5);

  const total = domainEmails.length;
  const firstDate = domainEmails.length > 0
    ? domainEmails[domainEmails.length - 1].created_at
    : null;
  const lastDate = domainEmails.length > 0
    ? domainEmails[0].created_at
    : null;

  const avgPerDay = useMemo(() => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 14);
    const recentCount = domainEmails.filter(
      (e) => new Date(e.created_at) >= cutoff
    ).length;
    return (recentCount / 14).toFixed(1);
  }, [domainEmails]);

  const addresses = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of domainEmails) {
      map.set(e.from_address, (map.get(e.from_address) || 0) + 1);
    }
    return Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([address, count]) => ({ address, count }));
  }, [domainEmails]);

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
            {domain.charAt(0).toUpperCase()}
          </div>
          <h1 className="text-xl font-semibold text-foreground">{domain}</h1>
        </div>

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
            label="First seen"
            value={firstDate ? dayLabel(dateKey(firstDate)) : "—"}
            icon={CalendarBlank}
          />
          <KpiCard
            label="Last seen"
            value={lastDate ? formatRelative(lastDate) : "—"}
            icon={CalendarBlank}
          />
        </div>

        {/* Hero row: volume chart + recent emails */}
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
                    <p className="text-sm">No emails from this domain</p>
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

        {/* Sender addresses */}
        <Card>
          <CardContent className="p-4">
            <div className="mb-4">
              <h3 className="text-sm font-semibold text-foreground">
                Sender addresses
              </h3>
              <p className="text-xs text-muted-foreground">
                {addresses.length} unique address{addresses.length !== 1 ? "es" : ""}
              </p>
            </div>
            <div className="space-y-2">
              {addresses.map(({ address, count }) => (
                <div
                  key={address}
                  className="flex items-center gap-3 py-1.5"
                >
                  <At size={14} className="text-muted-foreground shrink-0" />
                  <span className="text-sm text-foreground truncate flex-1">
                    {address}
                  </span>
                  <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                    {count} email{count !== 1 ? "s" : ""}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// --- Main ---

export function SendersView() {
  const emails = useIncomingEmails();
  const domains = useSenderDomains(emails);
  const [selectedDomain, setSelectedDomain] = useState<string | null>(null);

  if (selectedDomain) {
    return (
      <DomainDetail
        domain={selectedDomain}
        allEmails={emails}
        onBack={() => setSelectedDomain(null)}
      />
    );
  }

  return (
    <DomainList
      domains={domains}
      totalEmails={emails.length}
      onSelect={setSelectedDomain}
    />
  );
}
