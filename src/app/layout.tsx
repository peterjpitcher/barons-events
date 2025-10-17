import Link from "next/link";
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { MainNav } from "@/components/navigation/main-nav";
import { signOutAction } from "@/actions/auth";
import { getSession } from "@/lib/auth";
import { getCurrentUserProfile } from "@/lib/profile";
import { CurrentUserProvider } from "@/components/providers/current-user-provider";

export const dynamic = "force-dynamic";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Barons Events Platform",
  description:
    "Internal planning workspace for Barons pubs to submit, review, and analyse events.",
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
        className={`${geistSans.variable} ${geistMono.variable} bg-background text-foreground antialiased`}
      >
        <CurrentUserProvider user={profile}>
          <div className="min-h-screen bg-background text-foreground">
            <header className="border-b border-black/5 bg-white px-6 py-6 shadow-sm">
              <div className="mx-auto flex max-w-6xl flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <Link href="/" className="block font-semibold tracking-tight">
                    Barons Events Platform
                  </Link>
                  <span className="text-sm text-black/60">
                    Event pipeline · Reviewer queue · Planning analytics
                  </span>
                </div>
                {isAuthenticated ? (
                  <div className="flex flex-col items-stretch gap-4 sm:flex-row sm:items-center sm:gap-6">
                    <MainNav />
                    <div className="flex flex-col items-start gap-1 sm:items-end">
                      <span className="text-sm font-medium text-black">
                        {userDisplayName}
                      </span>
                      {roleLabel ? (
                        <span className="text-xs font-medium uppercase tracking-wide text-black/50">
                          {roleLabel}
                        </span>
                      ) : null}
                      <form action={signOutAction}>
                        <button
                          type="submit"
                          className="text-xs font-semibold text-black/60 underline underline-offset-4 hover:text-black"
                        >
                          Sign out
                        </button>
                      </form>
                    </div>
                  </div>
                ) : null}
              </div>
            </header>
            <main className="mx-auto max-w-6xl px-6 py-10">{children}</main>
          </div>
        </CurrentUserProvider>
      </body>
    </html>
  );
}
