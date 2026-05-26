import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata = {
  title: "Account Deactivated · BaronsHub 1.1",
};

export default function DeactivatedPage(): React.ReactElement {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--canvas)] p-4">
      <Card className="max-w-md">
        <CardHeader>
          <CardTitle className="text-center">Account deactivated</CardTitle>
        </CardHeader>
        <CardContent className="text-center text-[var(--ink-muted)]">
          <p>Your account has been deactivated by an administrator.</p>
          <p className="mt-2">
            If you believe this is an error, please contact your administrator.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
