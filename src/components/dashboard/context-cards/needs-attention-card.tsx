import Link from "next/link";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export type DashboardAttentionItem = {
  id: string;
  title: string;
  subtitle: string;
  href: string;
  label: string;
  tone: "neutral" | "info" | "success" | "warning" | "danger";
};

type NeedsAttentionCardProps = {
  items: DashboardAttentionItem[];
};

export function NeedsAttentionCard({ items }: NeedsAttentionCardProps): React.ReactNode {
  const visibleItems = items.slice(0, 6);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-[var(--mustard-dark)]" aria-hidden="true" />
          <CardTitle className="text-sm">Needs Attention</CardTitle>
        </div>
        <Badge variant={items.length > 0 ? "warning" : "success"}>
          {items.length}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-2">
        {visibleItems.length === 0 ? (
          <div className="flex items-center gap-2 py-2 text-sm text-subtle">
            <CheckCircle2 className="h-4 w-4 text-[var(--sage-dark)]" aria-hidden="true" />
            No urgent operational issues right now.
          </div>
        ) : (
          visibleItems.map((item) => (
            <Link
              key={item.id}
              href={item.href}
              className="flex items-start justify-between gap-3 rounded-[8px] border border-[var(--hair)] px-3 py-2 text-sm transition-colors hover:bg-[var(--paper-tint)]"
            >
              <span className="min-w-0">
                <span className="block truncate font-medium text-[var(--ink)]">{item.title}</span>
                <span className="block truncate text-xs text-subtle">{item.subtitle}</span>
              </span>
              <Badge variant={item.tone} className="shrink-0">
                {item.label}
              </Badge>
            </Link>
          ))
        )}
        {items.length > visibleItems.length ? (
          <p className="text-xs text-subtle">+{items.length - visibleItems.length} more items in the workspace.</p>
        ) : null}
      </CardContent>
    </Card>
  );
}
