import { AuthLayout } from "@/components/auth/auth-layout";
import { ResetPasswordCard } from "./reset-password-card";

export const metadata = {
  title: "Reset password · Barons Events",
  description: "Choose a new password to regain access to EventHub."
};

type SearchParams = Record<string, string | undefined>;

type ResetPasswordPageProps = {
  searchParams?: Promise<SearchParams>;
};

export default async function ResetPasswordPage({ searchParams }: ResetPasswordPageProps) {
  const query =
    (await searchParams?.catch(() => ({} as SearchParams))) ??
    ({} as SearchParams);

  return (
    <AuthLayout
      intro={
        <p>
          Follow the instructions in the email we sent and pick a new password. We&apos;ll sign you out when you
          finish so you can log back in securely.
        </p>
      }
    >
      <ResetPasswordCard initialQuery={query} />
    </AuthLayout>
  );
}
