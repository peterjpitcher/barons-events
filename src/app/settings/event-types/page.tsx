import { redirect } from "next/navigation";

export const metadata = {
  title: "Event types · BaronsHub 1.1",
  description: "Manage the picklist of event types available to venues."
};

export default function EventTypesPage() {
  redirect("/settings?tab=event-types");
}
