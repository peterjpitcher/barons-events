// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProposeEventForm } from "@/components/events/propose-event-form";

vi.mock("@/actions/pre-event", () => ({
  proposeEventAction: vi.fn()
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() })
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn()
  }
}));

const venues = [
  { id: "550e8400-e29b-41d4-a716-446655440000", name: "Venue A", category: "pub" as const },
  { id: "550e8400-e29b-41d4-a716-446655440001", name: "Venue B", category: "pub" as const }
];

afterEach(() => {
  cleanup();
});

describe("ProposeEventForm idempotency keys", () => {
  it("keeps one key per mount and generates a fresh key after remount", () => {
    const first = render(<ProposeEventForm venues={venues} />);
    const firstOperationId = first.container.querySelector<HTMLInputElement>('input[name="operation_id"]')?.value;
    const firstSnakeKey = first.container.querySelector<HTMLInputElement>('input[name="idempotency_key"]')?.value;
    const firstLegacyKey = first.container.querySelector<HTMLInputElement>('input[name="idempotencyKey"]')?.value;

    expect(firstOperationId).toMatch(/[0-9a-f-]{36}/i);
    expect(firstSnakeKey).toMatch(/[0-9a-f-]{36}/i);
    expect(firstLegacyKey).toBe(firstSnakeKey);

    first.unmount();

    const second = render(<ProposeEventForm venues={venues} />);
    const secondSnakeKey = second.container.querySelector<HTMLInputElement>('input[name="idempotency_key"]')?.value;

    expect(secondSnakeKey).toMatch(/[0-9a-f-]{36}/i);
    expect(secondSnakeKey).not.toBe(firstSnakeKey);
  });
});
