import { useMemo } from "react";
import {
  Tray,
  EnvelopeSimple,
  ChartLine,
  CheckCircle,
  Clock,
  TrendUp,
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

function weekdayLabel(dateStr: string) {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString(undefined, { weekday: "short" });
}

// --- Build chart data ---

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

    // Only look at last 14 days
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 14);

    for (const e of emails) {
      if (new Date(e.created_at) < cutoff) continue;
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

function useActivityGrid(emails: IncomingEmail[]) {
  return useMemo(() => {
    // Build 7 weeks x 7 days grid
    const weeks = 7;
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dayOfWeek = today.getDay(); // 0=Sun
    const startDate = new Date(today);
    startDate.setDate(startDate.getDate() - (weeks * 7 - 1) - dayOfWeek);

    const countMap = new Map<string, number>();
    for (const e of emails) {
      const key = dateKey(e.created_at);
      countMap.set(key, (countMap.get(key) || 0) + 1);
    }

    const grid: { date: string; count: number; weekday: string }[][] = [];
    let maxCount = 0;
    const d = new Date(startDate);
    for (let w = 0; w < weeks; w++) {
      const week: { date: string; count: number; weekday: string }[] = [];
      for (let dow = 0; dow < 7; dow++) {
        const key = d.toISOString().slice(0, 10);
        const count = countMap.get(key) || 0;
        if (count > maxCount) maxCount = count;
        const isFuture = d > now;
        week.push({
          date: key,
          count: isFuture ? -1 : count,
          weekday: weekdayLabel(key),
        });
        d.setDate(d.getDate() + 1);
      }
      grid.push(week);
    }
    return { grid, maxCount };
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

function VolumeChart({ emails }: { emails: IncomingEmail[] }) {
  const data = useDailyVolume(emails, 14);
  const config: ChartConfig = {
    count: { label: "Emails", color: "var(--color-primary)" },
  };

  return (
    <Card>
      <CardContent className="p-4">
        <div className="mb-4">
          <h3 className="text-sm font-semibold text-foreground">
            Email volume
          </h3>
          <p className="text-xs text-muted-foreground">Last 14 days</p>
        </div>
        <ChartContainer config={config} className="aspect-[2.5/1] w-full">
          <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
            <defs>
              <linearGradient id="fillVolume" x1="0" y1="0" x2="0" y2="1">
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
              fill="url(#fillVolume)"
              strokeWidth={2}
            />
          </AreaChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}

function TagBarChart({ emails }: { emails: IncomingEmail[] }) {
  const breakdown = useTagBreakdown(emails);
  const config: ChartConfig = Object.fromEntries(
    breakdown.map((t) => [t.id, { label: t.name, color: t.color }])
  );
  const data = breakdown.map((t) => ({
    name: t.name,
    count: t.count,
    fill: t.color,
  }));

  if (data.length === 0) {
    return (
      <Card>
        <CardContent className="p-4">
          <div className="mb-4">
            <h3 className="text-sm font-semibold text-foreground">
              Emails by tag
            </h3>
            <p className="text-xs text-muted-foreground">Last 14 days</p>
          </div>
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <p className="text-sm">No tagged emails yet</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-4">
        <div className="mb-4">
          <h3 className="text-sm font-semibold text-foreground">
            Emails by tag
          </h3>
          <p className="text-xs text-muted-foreground">Last 14 days</p>
        </div>
        <ChartContainer config={config} className="aspect-[2/1] w-full">
          <BarChart
            data={data}
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
  );
}

function ActivityGrid({ emails }: { emails: IncomingEmail[] }) {
  const { grid, maxCount } = useActivityGrid(emails);

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
          {/* Day-of-week labels */}
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
          {/* Grid */}
          {grid.map((week, wi) => (
            <div key={wi} className="flex flex-col gap-1">
              {week.map((day) => (
                <div
                  key={day.date}
                  className="w-3 h-3 rounded-sm"
                  style={{ backgroundColor: intensity(day.count) }}
                  title={`${dayLabel(day.date)}: ${day.count < 0 ? "—" : day.count} email${day.count === 1 ? "" : "s"}`}
                />
              ))}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function RecentEmails({ emails }: { emails: IncomingEmail[] }) {
  const recent = emails.slice(0, 5);

  return (
    <Card>
      <CardContent className="p-4">
        <div className="mb-4">
          <h3 className="text-sm font-semibold text-foreground">
            Recent emails
          </h3>
        </div>
        {recent.length === 0 ? (
          <div className="text-center py-8">
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
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// --- Main ---

export function DashboardView() {
  const emails = useIncomingEmails();
  const total = emails.length;
  const unread = emails.filter((e) => e.status === "received").length;
  const processed = emails.filter((e) => e.status === "processed").length;

  // Avg per day (last 14 days)
  const avgPerDay = useMemo(() => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 14);
    const recent = emails.filter(
      (e) => new Date(e.created_at) >= cutoff
    ).length;
    return (recent / 14).toFixed(1);
  }, [emails]);

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        <h1 className="text-xl font-semibold text-foreground">Dashboard</h1>

        {/* Hero row: recent emails + volume chart */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
          <div className="lg:col-span-3">
            <VolumeChart emails={emails} />
          </div>
          <div className="lg:col-span-2">
            <RecentEmails emails={emails} />
          </div>
        </div>

        {/* KPI row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <KpiCard
            label="Total emails"
            value={total}
            icon={EnvelopeSimple}
          />
          <KpiCard
            label="Unread"
            value={unread}
            icon={Tray}
          />
          <KpiCard
            label="Processed"
            value={processed}
            icon={CheckCircle}
          />
          <KpiCard
            label="Avg / day"
            value={avgPerDay}
            icon={TrendUp}
            subtitle="Last 14 days"
          />
        </div>

        {/* Bottom row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <TagBarChart emails={emails} />
          <ActivityGrid emails={emails} />
        </div>
      </div>
    </div>
  );
}
