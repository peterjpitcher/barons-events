import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { listCustomersForUser } from "@/lib/customers";
import { CustomersView } from "./CustomersView";

export const metadata = { title: "Customers — BaronsHub" };

export default async function CustomersPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "central_planner" && user.role !== "venue_manager") {
    redirect("/unauthorized");
  }

  const customers = await listCustomersForUser(user);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[var(--color-text)]">Customers</h1>
        <p className="text-sm text-subtle mt-1">
          {customers.length} customer{customers.length !== 1 ? "s" : ""}
        </p>
      </div>
      <CustomersView customers={customers} />
    </div>
  );
}
