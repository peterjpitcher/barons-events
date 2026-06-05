import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { listCustomersForUser } from "@/lib/customers";
import { canViewCustomers } from "@/lib/roles";
import { PageHeader } from "@/components/ui/design-primitives";
import { CustomersView } from "./CustomersView";

export const metadata = { title: "Customers — BaronsHub 1.1" };

export default async function CustomersPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canViewCustomers(user.role)) {
    redirect("/unauthorized");
  }

  const customers = await listCustomersForUser(user);

  return (
    <div className="app-page">
      <div className="hidden md:block">
        <PageHeader
          eyebrow="Audience"
          title="Customers"
          description="Browse booking history, contact details, and marketing opt-in status."
          meta={<span>{customers.length} customer{customers.length !== 1 ? "s" : ""}</span>}
        />
      </div>
      <div className="md:hidden">
        <p className="mobile-eyebrow">Audience</p>
        <h1 className="mt-1 font-brand-serif text-[1.85rem] font-medium leading-tight text-[var(--navy)]">
          Customers
        </h1>
      </div>
      <CustomersView customers={customers} />
    </div>
  );
}
