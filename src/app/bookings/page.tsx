import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { listAllBookingsForUser } from "@/lib/all-bookings";
import { canManageBookings } from "@/lib/roles";
import { BookingsView } from "./BookingsView";

export const metadata = { title: "All Bookings — BaronsHub" };

export default async function BookingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canManageBookings(user.role, user.venueId)) {
    redirect("/unauthorized");
  }

  const groups = await listAllBookingsForUser(user);
  const totalBookings = groups.reduce((s, g) => s + g.totalBookings, 0);
  const totalTickets  = groups.reduce((s, g) => s + g.totalTickets, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[var(--color-text)]">All Bookings</h1>
        <p className="text-sm text-subtle mt-1">
          {totalBookings} booking{totalBookings !== 1 ? "s" : ""} · {totalTickets} ticket{totalTickets !== 1 ? "s" : ""}
        </p>
      </div>
      <BookingsView groups={groups} />
    </div>
  );
}
