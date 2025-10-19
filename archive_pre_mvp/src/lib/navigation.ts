export type NavStatus = "available" | "in-progress" | "upcoming";

export type NavigationItem = {
  title: string;
  href: string;
  description: string;
  status: NavStatus;
};

export const mainNavigation: NavigationItem[] = [
  {
    title: "Overview",
    href: "/",
    description: "Workspace snapshot, current focus, and quick links to guides.",
    status: "available",
  },
  {
    title: "Events",
    href: "/events",
    description:
      "Create events, track submissions, and review timelines in one place.",
    status: "available",
  },
  {
    title: "Venues",
    href: "/venues",
    description:
      "Venue directory with assignments, status updates, and follow-up notes.",
    status: "available",
  },
  {
    title: "Settings",
    href: "/settings",
    description: "Profile, notification preferences, and team settings.",
    status: "available",
  },
];
