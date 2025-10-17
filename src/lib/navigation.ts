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
    description:
      "Sprint status, current focus, and quick links to foundational docs.",
    status: "available",
  },
  {
    title: "Venues",
    href: "/venues",
    description:
      "Venue directory, assignments, and CRUD operations for HQ planners.",
    status: "available",
  },
  {
    title: "Events",
    href: "/events",
    description:
      "Draft creation, submission flow, timeline visibility, and analytics.",
    status: "available",
  },
  {
    title: "Reviews",
    href: "/reviews",
    description:
      "Reviewer queue, SLA indicators, and decision logging for submissions.",
    status: "available",
  },
  {
    title: "Planning Ops",
    href: "/planning",
    description:
      "HQ planning analytics, conflict management, and upcoming dashboard utilities.",
    status: "available",
  },
  {
    title: "AI Workspace",
    href: "/planning#ai-metadata",
    description:
      "Review, regenerate, and publish AI-enhanced content before downstream hand-off.",
    status: "in-progress",
  },
  {
    title: "Settings",
    href: "/settings",
    description: "Role-aware preferences, notification toggles, and profile.",
    status: "upcoming",
  },
];
