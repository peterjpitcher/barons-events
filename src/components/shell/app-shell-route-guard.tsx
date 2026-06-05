"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

function isPublicChromeRoute(pathname: string): boolean {
  return (
    pathname.startsWith("/forgot-password") ||
    pathname.startsWith("/reset-password") ||
    pathname.startsWith("/unauthorized") ||
    pathname.startsWith("/deactivated") ||
    pathname === "/l" ||
    pathname.startsWith("/l/")
  );
}

export function AppShellRouteGuard({
  children,
  shell,
}: {
  children: ReactNode;
  shell: ReactNode;
}) {
  const pathname = usePathname();
  return isPublicChromeRoute(pathname) ? <>{children}</> : <>{shell}</>;
}
