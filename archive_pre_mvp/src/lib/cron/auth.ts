export const getCronSecret = () => process.env.CRON_SECRET;

export function validateCronRequest(request: Request): Response | null {
  const secret = getCronSecret();
  if (!secret) {
    return new Response(
      JSON.stringify({
        error: "CRON_SECRET is not configured.",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  const header = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;

  if (header !== expected) {
    return new Response(
      JSON.stringify({
        error: "Unauthorized cron invocation.",
      }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }

  return null;
}
