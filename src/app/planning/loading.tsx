export default function PlanningLoading() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <div className="h-9 w-56 animate-pulse rounded-[var(--radius)] bg-[var(--color-muted-surface)]" />
          <div className="h-5 w-80 animate-pulse rounded-[var(--radius)] bg-[var(--color-muted-surface)]" />
        </div>
        <div className="flex gap-2">
          <div className="h-10 w-28 animate-pulse rounded-full bg-[var(--color-muted-surface)]" />
          <div className="h-10 w-28 animate-pulse rounded-full bg-[var(--color-muted-surface)]" />
        </div>
      </div>
      <div className="grid gap-6 md:grid-cols-3">
        {["30-day", "60-day", "90-day"].map((label) => (
          <div key={label} className="space-y-3">
            <div className="h-6 w-32 animate-pulse rounded-[var(--radius)] bg-[var(--color-muted-surface)]" />
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="rounded-[var(--radius-lg)] border border-[rgba(39,54,64,0.12)] bg-white p-4 shadow-card"
              >
                <div className="space-y-2">
                  <div className="h-5 w-40 animate-pulse rounded-[var(--radius)] bg-[var(--color-muted-surface)]" />
                  <div className="h-4 w-28 animate-pulse rounded-[var(--radius)] bg-[var(--color-muted-surface)]" />
                  <div className="h-4 w-24 animate-pulse rounded-[var(--radius)] bg-[var(--color-muted-surface)]" />
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
