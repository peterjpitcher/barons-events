import Link from "next/link";
import type { Metadata } from "next";
import { Geist, Geist_Mono, Playfair_Display } from "next/font/google";
import "./globals.css";
import { MainNav } from "@/components/navigation/main-nav";
import { signOutAction } from "@/actions/auth";
import { getSession } from "@/lib/auth";
import { getCurrentUserProfile } from "@/lib/profile";
import { CurrentUserProvider } from "@/components/providers/current-user-provider";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const playfair = Playfair_Display({
  variable: "--font-playfair",
  subsets: ["latin"],
  weight: ["400", "600", "700"],
});

export const metadata: Metadata = {
  title: "EventHub by Barons",
  description:
    "EventHub centralises planning for Barons venues—track events, monitor reviewers, and publish AI metadata in one bright workspace.",
};

const formatRoleLabel = (role: string | null) => {
  if (!role) return null;

  return role
    .split("_")
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await getSession();
  const isAuthenticated = Boolean(session);
  const profile = await getCurrentUserProfile();
  const roleLabel = formatRoleLabel(profile?.role ?? null);

  const userDisplayName =
    profile?.full_name ?? profile?.email ?? session?.user.email ?? "";

  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${playfair.variable} bg-background text-foreground antialiased`}
      >
        <CurrentUserProvider user={profile}>
          <div className="min-h-screen bg-[var(--color-canvas)] text-foreground">
            <header className="relative overflow-hidden">
              <div className="absolute inset-0 bg-[var(--color-primary-900)]" />
              <div className="relative">
                <div className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-10 text-white">
                  <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
                    <div className="space-y-2">
                      <Link
                        href="/"
                        className="flex flex-col text-white transition hover:text-white/80"
                      >
                        <span className="font-brand-serif text-4xl font-semibold tracking-tight text-[var(--color-highlight)]">
                          EventHub
                        </span>
                        <span className="text-sm font-medium uppercase tracking-[0.35em] text-white/80">
                          a Barons Innovation
                        </span>
                      </Link>
                      <p className="text-sm text-white/80">
                        Plan with confidence: keep venues aligned, support reviewers, and share polished updates without the scramble.
                      </p>
                    </div>
                    {isAuthenticated ? (
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
                        <div className="flex items-center gap-3">
                          <Avatar
                            name={userDisplayName}
                            className="h-11 w-11 bg-white/20 text-base font-semibold text-white"
                          />
                          <div className="flex flex-col">
                            <span className="text-sm font-semibold text-white">
                              {userDisplayName}
                            </span>
                            {roleLabel ? (
                              <span className="text-[0.7rem] font-semibold uppercase tracking-[0.3em] text-white/70">
                                {roleLabel}
                              </span>
                            ) : null}
                          </div>
                        </div>
                        <form action={signOutAction} className="sm:ml-4">
                          <Button
                            type="submit"
                            variant="outline"
                            className="border-white/60 bg-white/10 text-white hover:border-white hover:bg-white/20 hover:text-white"
                          >
                            Sign out
                          </Button>
                        </form>
                      </div>
                    ) : null}
                  </div>
                  <div className="h-px bg-white/20" />
                  <MainNav />
                </div>
                <div className="pointer-events-none absolute inset-x-0 bottom-0 translate-y-1/2">
                  <div className="mx-auto h-10 max-w-6xl rounded-t-[2.5rem] bg-[var(--color-canvas)] shadow-[0_-20px_45px_-28px_rgba(15,27,58,0.45)]" />
                </div>
              </div>
            </header>
            <main className="mx-auto max-w-6xl px-6 pb-16 pt-20">{children}</main>
            <footer className="border-t border-[rgba(39,54,64,0.12)] bg-white/80">
              <div className="mx-auto flex max-w-6xl flex-col gap-3 px-6 py-6 text-sm text-[var(--color-text-muted)] md:flex-row md:items-center md:justify-between">
                <div className="text-sm">
                  © {new Date().getFullYear()} Orange Jelly Limited. All rights reserved.
                </div>
                <div className="flex flex-wrap items-center gap-4 text-sm">
                  <a
                    href="mailto:peter@orangejelly.co.uk"
                    className="font-semibold text-[var(--color-primary-700)] underline decoration-dotted underline-offset-2 hover:text-[var(--color-primary-900)]"
                  >
                    Support: Peter Pitcher
                  </a>
                </div>
              </div>
            </footer>
          </div>
        </CurrentUserProvider>
      </body>
    </html>
  );
}
