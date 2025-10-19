export default function PlanningLoading() {
  return (
    <section className="space-y-8">
      <div className="space-y-3">
        <div className="h-8 w-64 animate-pulse rounded bg-black/10" />
        <div className="h-4 w-full max-w-xl animate-pulse rounded bg-black/10" />
        <div className="flex flex-wrap gap-2">
          <div className="h-6 w-40 animate-pulse rounded-full bg-black/10" />
          <div className="h-6 w-48 animate-pulse rounded-full bg-black/10" />
        </div>
      </div>

      <div className="grid gap-3 rounded-xl border border-black/[0.08] bg-white p-4 shadow-sm sm:grid-cols-5">
        {Array.from({ length: 5 }).map((_, index) => (
          <div key={index} className="space-y-2">
            <div className="h-3 w-20 animate-pulse rounded bg-black/10" />
            <div className="h-6 w-16 animate-pulse rounded bg-black/10" />
            <div className="h-3 w-24 animate-pulse rounded bg-black/10" />
          </div>
        ))}
      </div>

      <div className="space-y-3 rounded-xl border border-black/[0.08] bg-white p-4 shadow-sm">
        <div className="h-4 w-48 animate-pulse rounded bg-black/10" />
        <div className="grid gap-2 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="space-y-2 rounded-lg border border-black/[0.06] bg-black/[0.015] p-3">
              <div className="h-3 w-32 animate-pulse rounded bg-black/10" />
              <div className="h-3 w-full animate-pulse rounded bg-black/10" />
              <div className="h-3 w-20 animate-pulse rounded bg-black/10" />
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {Array.from({ length: 4 }).map((_, index) => (
          <div
            key={index}
            className="space-y-3 rounded-xl border border-black/[0.08] bg-white p-4 shadow-sm"
          >
            <div className="h-5 w-40 animate-pulse rounded bg-black/10" />
            <div className="h-4 w-full animate-pulse rounded bg-black/10" />
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((__, itemIndex) => (
                <div key={itemIndex} className="h-3 w-full animate-pulse rounded bg-black/10" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
