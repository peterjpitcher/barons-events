export default function DashboardLoading() {
  return (
    <div className="app-page">
      <div className="space-y-2">
        <div className="h-9 w-64 animate-pulse rounded-[var(--radius)] bg-[var(--canvas-2)]" />
        <div className="h-5 w-96 animate-pulse rounded-[var(--radius)] bg-[var(--canvas-2)]" />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="rounded-[var(--radius-lg)] border border-[var(--hair)] bg-[var(--paper)] shadow-card"
          >
            <div className="space-y-2 border-b border-[var(--hair)] bg-[var(--paper-tint)] p-6">
              <div className="h-5 w-48 animate-pulse rounded-[var(--radius)] bg-[var(--canvas-2)]" />
              <div className="h-4 w-72 animate-pulse rounded-[var(--radius)] bg-[var(--canvas-2)]" />
            </div>
            <div className="space-y-3 p-6">
              {[1, 2, 3].map((j) => (
                <div
                  key={j}
                  className="h-16 animate-pulse rounded-[var(--radius)] bg-[var(--paper-tint)]"
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
