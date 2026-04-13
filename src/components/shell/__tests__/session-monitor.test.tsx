// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { SessionMonitor } from "../session-monitor";

// ── Mock window.location ──────────────────────────────────────────────────────

const locationAssignMock = vi.fn();
let originalLocation: Location;

function createMockLocation(): Location {
  const mock = { ...originalLocation, pathname: "/events", search: "" } as Location;
  Object.defineProperty(mock, "href", {
    get() {
      return "http://localhost/events";
    },
    set(url: string) {
      locationAssignMock(url);
    },
    configurable: true,
  });
  return mock;
}

beforeEach(() => {
  originalLocation = window.location;
  Object.defineProperty(window, "location", {
    value: createMockLocation(),
    writable: true,
    configurable: true,
  });
});

afterEach(() => {
  Object.defineProperty(window, "location", {
    value: originalLocation,
    writable: true,
    configurable: true,
  });
  vi.restoreAllMocks();
  locationAssignMock.mockClear();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("SessionMonitor", () => {
  it("should render nothing when idle (no visibility change)", () => {
    const { container } = render(<SessionMonitor />);
    expect(container.innerHTML).toBe("");
  });

  it("should call /api/auth/session-check on visibilitychange to visible", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ valid: true }), { status: 200 })
    );

    render(<SessionMonitor />);

    // Simulate tab becoming visible
    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      writable: true,
      configurable: true,
    });

    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/auth/session-check", {
      credentials: "same-origin",
    });
  });

  it("should redirect to /login on 401 response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ valid: false }), { status: 401 })
    );

    render(<SessionMonitor />);

    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      writable: true,
      configurable: true,
    });

    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(locationAssignMock).toHaveBeenCalledWith(
      "/login?reason=session_expired&redirectedFrom=%2Fevents"
    );
  });

  it("should NOT redirect on 200 response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ valid: true }), { status: 200 })
    );

    render(<SessionMonitor />);

    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      writable: true,
      configurable: true,
    });

    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(locationAssignMock).not.toHaveBeenCalled();
    // Overlay should disappear after successful check
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("should NOT redirect on network error (fail open)", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network error"));

    render(<SessionMonitor />);

    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      writable: true,
      configurable: true,
    });

    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(locationAssignMock).not.toHaveBeenCalled();
    // Overlay should disappear after error (fail open)
    expect(screen.queryByRole("status")).toBeNull();
  });
});
