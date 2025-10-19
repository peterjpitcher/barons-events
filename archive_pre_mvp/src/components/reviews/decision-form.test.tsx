import React from "react";
import { beforeAll, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const loadModule = async () =>
  await import("@/components/reviews/decision-form");

beforeAll(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "public-anon-key";
});

describe("DecisionForm", () => {
  it("exposes predefined templates for decision notes", async () => {
    const { DECISION_TEMPLATES } = await loadModule();
    const labels = DECISION_TEMPLATES.map((template) => template.label);
    expect(labels).toContain("Approved – ready to publish");
    expect(labels).toContain("Needs revisions – add more detail");
    expect(labels).toContain("Rejected – conflicting event");
  });

  it("renders a trigger button for the modal", async () => {
    const { DecisionForm } = await loadModule();
    const markup = renderToStaticMarkup(<DecisionForm eventId="event-123" />);
    expect(markup).toContain("Record decision");
  });
});
