import { Card, CardContent } from "@/components/ui/card.js";
import { cn } from "../lib/utils.js";

export interface BreakdownItem {
  id: string;
  label: string;
  color: string;
  count: number;
}

export interface BreakdownStat {
  label: string;
  value: number;
}

export interface BreakdownSection {
  id: string;
  title: string;
  subtitle?: string;
  items: BreakdownItem[];
  stats?: BreakdownStat[];
  note?: string;
}

export function ContentBreakdownCard({
  heading,
  subtitle,
  emptyMessage,
  sections,
  itemLimit = 5,
  className,
}: {
  heading: string;
  subtitle?: string;
  emptyMessage: string;
  sections: BreakdownSection[];
  itemLimit?: number;
  className?: string;
}) {
  if (sections.length === 0) {
    return (
      <Card className={cn("flex flex-col border-border/60", className)}>
        <CardContent className="p-5 flex-1 flex flex-col">
          <h3 className="text-sm font-bold text-foreground">{heading}</h3>
          {subtitle && (
            <p className="text-[10px] uppercase font-bold tracking-widest text-muted-foreground/60 mb-4">
              {subtitle}
            </p>
          )}
          <div className="flex items-center justify-center flex-1 text-muted-foreground">
            <p className="text-xs italic opacity-40 uppercase tracking-widest">{emptyMessage}</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={cn("flex flex-col border-border/60", className)}>
      <CardContent className="p-5 flex-1 flex flex-col">
        <h3 className="text-sm font-bold text-foreground">{heading}</h3>
        {subtitle && (
          <p className="text-[10px] uppercase font-bold tracking-widest text-muted-foreground/60 mb-4">
            {subtitle}
          </p>
        )}
        <div className="space-y-5">
          {sections.map((section, index) => {
            const visibleItems = section.items.slice(0, itemLimit);
            const maxCount = visibleItems.reduce((max, item) => Math.max(max, item.count), 0);

            return (
              <div
                key={section.id}
                className={cn(index > 0 && "border-t border-border/50 pt-4")}
              >
                <div className="mb-3">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50">
                    {section.subtitle ?? "Breakdown"}
                  </p>
                  <p className="text-sm font-semibold text-foreground mt-1">{section.title}</p>
                </div>

                {section.stats && section.stats.length > 0 && (
                  <div className="grid grid-cols-2 gap-3 mb-4">
                    {section.stats.map((stat) => (
                      <div
                        key={stat.label}
                        className="rounded-xl border border-border/60 bg-muted/20 px-3 py-2.5"
                      >
                        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50">
                          {stat.label}
                        </p>
                        <p className="text-lg font-bold text-foreground tabular-nums mt-1">
                          {stat.value}
                        </p>
                      </div>
                    ))}
                  </div>
                )}

                <div className="space-y-2.5">
                  {visibleItems.map((item) => (
                    <div key={item.id} className="space-y-1.5">
                      <div className="flex items-center gap-2">
                        <span
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ backgroundColor: item.color }}
                        />
                        <span className="text-[11px] font-bold text-foreground truncate flex-1 uppercase tracking-tight">
                          {item.label}
                        </span>
                        <span className="text-[11px] tabular-nums font-bold text-muted-foreground/70 shrink-0">
                          {item.count}
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-muted/50 overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${maxCount > 0 ? (item.count / maxCount) * 100 : 0}%`,
                            backgroundColor: item.color,
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>

                {section.items.length > visibleItems.length && (
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/40 pt-3">
                    +{section.items.length - visibleItems.length} more values
                  </p>
                )}

                {section.note && (
                  <p className="text-[10px] text-muted-foreground/60 leading-relaxed pt-3">
                    {section.note}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
