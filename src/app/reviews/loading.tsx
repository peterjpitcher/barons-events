export default function ReviewsLoading() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="h-9 w-52 animate-pulse rounded-[var(--radius)] bg-[var(--color-muted-surface)]" />
        <div className="h-5 w-80 animate-pulse rounded-[var(--radius)] bg-[var(--color-muted-surface)]" />
      </div>
      <div className="grid gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="rounded-[var(--radius-lg)] border border-[rgba(39,54,64,0.12)] bg-white shadow-card"
          >
            <div className="flex items-center justify-between border-b border-[rgba(39,54,64,0.08)] p-6">
              <div className="space-y-2">
                <div className="h-6 w-52 animate-pulse rounded-[var(--radius)] bg-[var(--color-muted-surface)]" />
                <div className="h-4 w-40 animate-pulse rounded-[var(--radius)] bg-[var(--color-muted-surface)]" />
              </div>
              <div className="h-6 w-24 animate-pulse rounded-full bg-[var(--color-muted-surface)]" />
            </div>
            <div className="flex items-center justify-between p-6">
              <div className="space-y-2">
                <div className="h-4 w-36 animate-pulse rounded-[var(--radius)] bg-[var(--color-muted-surface)]" />
                <div className="h-4 w-28 animate-pulse rounded-[var(--radius)] bg-[var(--color-muted-surface)]" />
              </div>
              <div className="h-10 w-28 animate-pulse rounded-full bg-[var(--color-muted-surface)]" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
