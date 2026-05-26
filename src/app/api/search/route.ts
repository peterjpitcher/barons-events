import { NextResponse } from "next/server";

import { withAuth } from "@/lib/auth";
import { searchWorkspace } from "@/lib/global-search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withAuth(async (request, user) => {
  const url = new URL(request.url);
  const query = url.searchParams.get("q") ?? "";

  const results = await searchWorkspace(user, query);

  return NextResponse.json(
    { results },
    {
      headers: {
        "Cache-Control": "private, no-store",
      },
    },
  );
});
