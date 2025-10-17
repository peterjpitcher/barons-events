export default function ReviewsLoading() {
  return (
    <section className="space-y-8">
      <div className="space-y-3">
        <div className="h-8 w-64 animate-pulse rounded bg-black/10" />
        <div className="h-4 w-full max-w-xl animate-pulse rounded bg-black/10" />
        <div className="flex flex-wrap gap-2">
          <div className="h-6 w-48 animate-pulse rounded-full bg-black/10" />
          <div className="h-6 w-40 animate-pulse rounded-full bg-black/10" />
        </div>
      </div>

      <div className="rounded-xl border border-black/[0.08] bg-white p-6 shadow-sm">
        <div className="h-5 w-52 animate-pulse rounded bg-black/10" />
        <div className="mt-3 h-4 w-full animate-pulse rounded bg-black/10" />
        <div className="mt-6 grid gap-3 rounded-lg border border-black/[0.08] bg-white px-4 py-4 shadow-sm sm:grid-cols-5">
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className="space-y-2">
              <div className="h-3 w-20 animate-pulse rounded bg-black/10" />
              <div className="h-6 w-16 animate-pulse rounded bg-black/10" />
              <div className="h-3 w-24 animate-pulse rounded bg-black/10" />
            </div>
          ))}
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="h-10 w-full animate-pulse rounded bg-black/10" />
            <div className="h-10 w-full animate-pulse rounded bg-black/10" />
          </div>
          <div className="h-10 w-32 animate-pulse rounded bg-black/10" />
        </div>
        <div className="mt-6 h-48 w-full animate-pulse rounded bg-black/10" />
      </div>

      <div className="rounded-xl border border-black/[0.08] bg-white p-6 shadow-sm">
        <div className="h-5 w-48 animate-pulse rounded bg-black/10" />
        <div className="mt-2 h-4 w-full max-w-md animate-pulse rounded bg-black/10" />
        <div className="mt-6 space-y-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <div
              key={index}
              className="space-y-2 rounded-lg border border-black/[0.08] bg-black/[0.015] p-4"
            >
              <div className="h-4 w-64 animate-pulse rounded bg-black/10" />
              <div className="h-3 w-40 animate-pulse rounded bg-black/10" />
              <div className="h-3 w-32 animate-pulse rounded bg-black/10" />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
