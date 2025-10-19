import { Skeleton } from "@/components/ui/skeleton";

export default function DebriefLoading() {
  return (
    <div className="space-y-8">
      <section className="space-y-4 rounded-[var(--radius-lg)] border border-[rgba(39,54,64,0.08)] bg-white/60 p-6 shadow-soft">
        <Skeleton className="h-4 w-36" />
        <Skeleton className="h-8 w-64" />
        <div className="grid gap-3 md:grid-cols-3">
          <Skeleton className="h-20 rounded-[var(--radius)]" />
          <Skeleton className="h-20 rounded-[var(--radius)]" />
          <Skeleton className="h-20 rounded-[var(--radius)]" />
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr),minmax(0,1fr)]">
        <section className="space-y-4 rounded-[var(--radius-lg)] border border-[rgba(39,54,64,0.08)] bg-white/70 p-6 shadow-soft">
          <Skeleton className="h-5 w-52" />
          <div className="grid gap-4 md:grid-cols-2">
            <Skeleton className="h-12 rounded-[var(--radius)]" />
            <Skeleton className="h-12 rounded-[var(--radius)]" />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Skeleton className="h-12 rounded-[var(--radius)]" />
            <Skeleton className="h-12 rounded-[var(--radius)]" />
          </div>
          <Skeleton className="h-28 rounded-[var(--radius)]" />
          <Skeleton className="h-28 rounded-[var(--radius)]" />
          <Skeleton className="h-32 rounded-[var(--radius)]" />
        </section>
        <aside className="space-y-4">
          <Skeleton className="h-44 rounded-[var(--radius-lg)]" />
          <Skeleton className="h-44 rounded-[var(--radius-lg)]" />
        </aside>
      </div>
    </div>
  );
}

