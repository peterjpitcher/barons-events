import Link from "next/link";
import { getCheckoutSessionView } from "@/lib/payments/service";

type PageProps = {
  searchParams: Promise<{ session_id?: string }>;
};

export default async function CheckoutCancelPage({ searchParams }: PageProps) {
  const { session_id: sessionId } = await searchParams;
  const view = sessionId ? await getCheckoutSessionView(sessionId) : null;

  return (
    <main className="min-h-screen bg-[#273640] px-4 py-10 text-[#273640]">
      <section className="mx-auto max-w-lg rounded-xl bg-white p-6 shadow-2xl">
        <h1 className="font-serif text-2xl font-bold">Payment cancelled</h1>
        <p className="mt-3 text-sm text-[#637c8c]">
          {view
            ? `Your ${view.eventTitle} booking is not confirmed until payment is complete.`
            : "Your booking is not confirmed until payment is complete."}
        </p>
        <p className="mt-2 text-sm text-[#637c8c]">
          Pending ticket holds are released automatically if payment is not completed.
        </p>
        <Link
          href="https://www.baronspubs.com/"
          className="mt-6 inline-flex rounded-md bg-[#273640] px-4 py-2 text-sm font-bold uppercase tracking-wider text-white"
        >
          Back to Barons
        </Link>
      </section>
    </main>
  );
}
