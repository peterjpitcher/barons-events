import { redirect } from "next/navigation";

export const metadata = {
  title: "Event types · BaronsHub",
  description: "Manage the picklist of event types available to venues."
};

export default function EventTypesPage() {
  redirect("/settings");
}
