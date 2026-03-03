export default function EventsLoading() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <div className="h-9 w-48 animate-pulse rounded-[var(--radius)] bg-[var(--color-muted-surface)]" />
          <div className="h-5 w-64 animate-pulse rounded-[var(--radius)] bg-[var(--color-muted-surface)]" />
        </div>
        <div className="h-10 w-32 animate-pulse rounded-full bg-[var(--color-muted-surface)]" />
      </div>
      <div className="flex gap-2">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="h-9 w-24 animate-pulse rounded-full bg-[var(--color-muted-surface)]"
          />
        ))}
      </div>
      <div className="grid gap-4">
        {[1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            className="rounded-[var(--radius-lg)] border border-[rgba(39,54,64,0.12)] bg-white p-5 shadow-card"
          >
            <div className="flex items-center justify-between">
              <div className="space-y-2">
                <div className="h-5 w-56 animate-pulse rounded-[var(--radius)] bg-[var(--color-muted-surface)]" />
                <div className="h-4 w-40 animate-pulse rounded-[var(--radius)] bg-[var(--color-muted-surface)]" />
              </div>
              <div className="h-6 w-20 animate-pulse rounded-full bg-[var(--color-muted-surface)]" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
