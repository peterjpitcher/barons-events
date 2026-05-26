export default function ReviewsLoading() {
  return (
    <div className="app-page">
      <div className="space-y-2">
        <div className="h-9 w-52 animate-pulse rounded-[var(--radius)] bg-[var(--canvas-2)]" />
        <div className="h-5 w-80 animate-pulse rounded-[var(--radius)] bg-[var(--canvas-2)]" />
      </div>
      <div className="grid gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="rounded-[var(--radius-lg)] border border-[var(--hair)] bg-[var(--paper)] shadow-card"
          >
            <div className="flex items-center justify-between border-b border-[var(--hair)] bg-[var(--paper-tint)] p-6">
              <div className="space-y-2">
                <div className="h-6 w-52 animate-pulse rounded-[var(--radius)] bg-[var(--canvas-2)]" />
                <div className="h-4 w-40 animate-pulse rounded-[var(--radius)] bg-[var(--canvas-2)]" />
              </div>
              <div className="h-6 w-24 animate-pulse rounded-full bg-[var(--canvas-2)]" />
            </div>
            <div className="flex items-center justify-between p-6">
              <div className="space-y-2">
                <div className="h-4 w-36 animate-pulse rounded-[var(--radius)] bg-[var(--paper-tint)]" />
                <div className="h-4 w-28 animate-pulse rounded-[var(--radius)] bg-[var(--paper-tint)]" />
              </div>
              <div className="h-10 w-28 animate-pulse rounded-full bg-[var(--canvas-2)]" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
