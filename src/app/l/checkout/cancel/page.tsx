import Link from "next/link";
import { XCircle } from "lucide-react";
import { getCheckoutSessionView } from "@/lib/payments/service";

type PageProps = {
  searchParams: Promise<{ session_id?: string }>;
};

export default async function CheckoutCancelPage({ searchParams }: PageProps) {
  const { session_id: sessionId } = await searchParams;
  const view = sessionId ? await getCheckoutSessionView(sessionId) : null;

  return (
    <main className="flex min-h-screen items-center bg-[var(--paper)] px-4 py-8 text-[var(--navy)] sm:bg-[var(--navy)]">
      <section className="mx-auto w-full max-w-lg overflow-hidden rounded-[18px] bg-[var(--paper)] shadow-card sm:rounded-[8px]">
        <div className="hidden items-center gap-3 border-b border-[var(--hair)] bg-[var(--navy)] px-6 py-4 text-white sm:flex">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="Barons Pub Company" className="h-9 w-auto flex-shrink-0" />
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-[var(--mustard-bright)]">Barons Pub Company</p>
            <p className="text-sm text-white/80">Secure event booking</p>
          </div>
        </div>
        <div className="p-6 text-center sm:text-left">
          <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-[var(--burgundy-tint)] text-[var(--burgundy)] sm:hidden">
            <XCircle className="h-11 w-11" aria-hidden="true" />
          </div>
          <h1 className="font-serif text-[26px] font-bold sm:text-2xl">Nothing was charged</h1>
          <p className="mx-auto mt-3 max-w-[18rem] text-sm leading-relaxed text-[var(--slate)] sm:mx-0 sm:max-w-none">
            {view
              ? `Your ${view.eventTitle} booking is not confirmed until payment is complete.`
              : "Your booking is not confirmed until payment is complete."}
          </p>
          <p className="mx-auto mt-2 max-w-[18rem] text-sm leading-relaxed text-[var(--slate)] sm:mx-0 sm:max-w-none">
            Pending ticket holds are released automatically if payment is not completed.
          </p>
          <Link
            href="https://baronspubs.com"
            className="mt-6 inline-flex min-h-11 w-full items-center justify-center rounded-[11px] bg-[var(--navy)] px-4 py-2 text-sm font-bold uppercase tracking-wider text-white sm:w-auto sm:rounded-md"
          >
            Back to Barons
          </Link>
        </div>
      </section>
    </main>
  );
}
