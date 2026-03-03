export default function EventDetailLoading() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="h-5 w-24 animate-pulse rounded-[var(--radius)] bg-[var(--color-muted-surface)]" />
        <div className="h-6 w-20 animate-pulse rounded-full bg-[var(--color-muted-surface)]" />
      </div>
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          <div className="rounded-[var(--radius-lg)] border border-[rgba(39,54,64,0.12)] bg-white shadow-card">
            <div className="space-y-2 border-b border-[rgba(39,54,64,0.08)] p-6">
              <div className="h-7 w-64 animate-pulse rounded-[var(--radius)] bg-[var(--color-muted-surface)]" />
              <div className="h-4 w-48 animate-pulse rounded-[var(--radius)] bg-[var(--color-muted-surface)]" />
            </div>
            <div className="space-y-4 p-6">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="space-y-1">
                  <div className="h-4 w-24 animate-pulse rounded-[var(--radius)] bg-[var(--color-muted-surface)]" />
                  <div className="h-10 w-full animate-pulse rounded-[var(--radius)] bg-[var(--color-muted-surface)]" />
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="space-y-4">
          <div className="rounded-[var(--radius-lg)] border border-[rgba(39,54,64,0.12)] bg-white p-6 shadow-card">
            <div className="space-y-3">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="space-y-1">
                  <div className="h-3 w-20 animate-pulse rounded-[var(--radius)] bg-[var(--color-muted-surface)]" />
                  <div className="h-5 w-full animate-pulse rounded-[var(--radius)] bg-[var(--color-muted-surface)]" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
