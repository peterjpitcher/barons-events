import Link from "next/link";
import { getCheckoutSessionView } from "@/lib/payments/service";

type PageProps = {
  searchParams: Promise<{ session_id?: string }>;
};

export default async function CheckoutCancelPage({ searchParams }: PageProps) {
  const { session_id: sessionId } = await searchParams;
  const view = sessionId ? await getCheckoutSessionView(sessionId) : null;

  return (
    <main className="min-h-screen bg-[var(--navy)] px-4 py-8 text-[var(--navy)]">
      <section className="mx-auto max-w-lg overflow-hidden rounded-[8px] bg-[var(--paper)] shadow-card">
        <div className="flex items-center gap-3 border-b border-[var(--hair)] bg-[var(--navy)] px-6 py-4 text-white">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="Barons Pub Company" className="h-9 w-auto flex-shrink-0" />
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-[var(--mustard-bright)]">Barons Pub Company</p>
            <p className="text-sm text-white/80">Secure event booking</p>
          </div>
        </div>
        <div className="p-6">
          <h1 className="font-serif text-2xl font-bold">Payment cancelled</h1>
          <p className="mt-3 text-sm text-[var(--slate)]">
            {view
              ? `Your ${view.eventTitle} booking is not confirmed until payment is complete.`
              : "Your booking is not confirmed until payment is complete."}
          </p>
          <p className="mt-2 text-sm text-[var(--slate)]">
            Pending ticket holds are released automatically if payment is not completed.
          </p>
          <Link
            href="https://baronspubs.com"
            className="mt-6 inline-flex rounded-md bg-[var(--navy)] px-4 py-2 text-sm font-bold uppercase tracking-wider text-white"
          >
            Back to Barons
          </Link>
        </div>
      </section>
    </main>
  );
}
