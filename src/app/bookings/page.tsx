import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { listAllBookingsForUser } from "@/lib/all-bookings";
import { canViewBookings } from "@/lib/roles";
import { PageHeader } from "@/components/ui/design-primitives";
import { BookingsView } from "./BookingsView";

export const metadata = { title: "All Bookings — BaronsHub 1.1" };

export default async function BookingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canViewBookings(user.role)) {
    redirect("/unauthorized");
  }

  const groups = await listAllBookingsForUser(user);
  const totalBookings = groups.reduce((s, g) => s + g.totalBookings, 0);
  const totalTickets  = groups.reduce((s, g) => s + g.totalTickets, 0);

  return (
    <div className="app-page">
      <PageHeader
        eyebrow="Operations"
        title="All bookings"
        description="Search guest bookings, ticket counts, payment status, and attendance notes across live events."
        meta={
          <>
            <span>{totalBookings} booking{totalBookings !== 1 ? "s" : ""}</span>
            <span className="h-1 w-1 rounded-full bg-[var(--hair-strong)]" />
            <span>{totalTickets} ticket{totalTickets !== 1 ? "s" : ""}</span>
          </>
        }
      />
      <BookingsView groups={groups} />
    </div>
  );
}
