import { AuthLayout } from "@/components/auth/auth-layout";
import { ResetPasswordCard } from "./reset-password-card";

export const metadata = {
  title: "Reset password · BaronsHub 1.1",
  description: "Choose a new password to regain access to BaronsHub 1.1."
};

export default function ResetPasswordPage() {
  return (
    <AuthLayout
      intro={
        <p>
          Follow the instructions in the email we sent and pick a new password. We&apos;ll sign you out when you
          finish so you can log back in securely.
        </p>
      }
    >
      <ResetPasswordCard />
    </AuthLayout>
  );
}
