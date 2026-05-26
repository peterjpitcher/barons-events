export default function EventsLoading() {
  return (
    <div className="app-page">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <div className="h-9 w-48 animate-pulse rounded-[var(--radius)] bg-[var(--canvas-2)]" />
          <div className="h-5 w-64 animate-pulse rounded-[var(--radius)] bg-[var(--canvas-2)]" />
        </div>
        <div className="h-10 w-32 animate-pulse rounded-full bg-[var(--canvas-2)]" />
      </div>
      <div className="flex gap-2">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="h-9 w-24 animate-pulse rounded-full bg-[var(--canvas-2)]"
          />
        ))}
      </div>
      <div className="grid gap-4">
        {[1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            className="rounded-[var(--radius-lg)] border border-[var(--hair)] bg-[var(--paper)] p-5 shadow-card"
          >
            <div className="flex items-center justify-between">
              <div className="space-y-2">
                <div className="h-5 w-56 animate-pulse rounded-[var(--radius)] bg-[var(--canvas-2)]" />
                <div className="h-4 w-40 animate-pulse rounded-[var(--radius)] bg-[var(--canvas-2)]" />
              </div>
              <div className="h-6 w-20 animate-pulse rounded-full bg-[var(--canvas-2)]" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
