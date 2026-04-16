import { describe, it, expect } from "vitest";
import { classifyTodoUrgency } from "@/lib/dashboard";

describe("classifyTodoUrgency", () => {
  const today = "2026-04-16";

  it("should classify past due date as overdue", () => {
    expect(classifyTodoUrgency("2026-04-15", today)).toBe("overdue");
    expect(classifyTodoUrgency("2026-04-10", today)).toBe("overdue");
  });

  it("should classify due date within 7 days as due_soon", () => {
    expect(classifyTodoUrgency("2026-04-16", today)).toBe("due_soon");
    expect(classifyTodoUrgency("2026-04-22", today)).toBe("due_soon");
    expect(classifyTodoUrgency("2026-04-23", today)).toBe("due_soon");
  });

  it("should classify due date beyond 7 days as later", () => {
    expect(classifyTodoUrgency("2026-04-24", today)).toBe("later");
    expect(classifyTodoUrgency("2026-05-01", today)).toBe("later");
  });

  it("should classify null due date as later", () => {
    expect(classifyTodoUrgency(null, today)).toBe("later");
  });
});

describe("classifyDebriefUrgency", () => {
  const today = "2026-04-16";

  it("should classify event ended > 7 days ago as overdue", () => {
    expect(classifyTodoUrgency("2026-04-08", today, "debrief")).toBe("overdue");
  });

  it("should classify event ended within 7 days as due_soon", () => {
    expect(classifyTodoUrgency("2026-04-10", today, "debrief")).toBe("due_soon");
    expect(classifyTodoUrgency("2026-04-16", today, "debrief")).toBe("due_soon");
  });

  it("should classify event not yet ended as later", () => {
    expect(classifyTodoUrgency("2026-04-17", today, "debrief")).toBe("later");
  });
});
