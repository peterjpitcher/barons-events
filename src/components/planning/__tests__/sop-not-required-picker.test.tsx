// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SopNotRequiredPicker } from "@/components/planning/sop-not-required-picker";
import type { SopTemplateTree } from "@/lib/planning/sop-types";

afterEach(() => cleanup());

/** Mirrors the live Food Development chain: three tasks wait on Food specs. */
function template(): SopTemplateTree {
  const task = (id: string, title: string, dependsOn: string[] = []) => ({
    id,
    sectionId: "section-1",
    title,
    sortOrder: 0,
    defaultAssigneeIds: [],
    tMinusDays: 14,
    expansionStrategy: "single" as never,
    venueFilter: null,
    createdAt: "",
    updatedAt: "",
    dependencies: dependsOn.map((dependsOnTemplateId) => ({ dependsOnTemplateId }))
  });

  return {
    sections: [
      {
        id: "section-1",
        label: "Food Development",
        sortOrder: 1,
        defaultAssigneeIds: [],
        createdAt: "",
        updatedAt: "",
        tasks: [
          task("food-specs", "Food specs"),
          task("allergens", "Allergens", ["food-specs"]),
          task("shopping-list", "Shopping list", ["food-specs"])
        ]
      }
    ]
  } as unknown as SopTemplateTree;
}

describe("SopNotRequiredPicker dependency warning", () => {
  it("says nothing when no prerequisite is marked N/A", () => {
    render(<SopNotRequiredPicker template={template()} value={[]} onChange={vi.fn()} />);
    expect(screen.queryByText(/left waiting/i)).toBeNull();
  });

  it("warns when a prerequisite is marked N/A but its dependants are not", () => {
    // Ticking Food specs strands Allergens and Shopping list: they stay blocked
    // for the life of the event with nothing left to release them.
    render(<SopNotRequiredPicker template={template()} value={["food-specs"]} onChange={vi.fn()} />);

    const warning = screen.getByRole("status");
    expect(warning.textContent).toContain("Some tasks are left waiting");
    expect(warning.textContent).toContain("Allergens waits on Food specs");
    expect(warning.textContent).toContain("Shopping list waits on Food specs");
  });

  it("stops warning once the dependants are marked N/A too", () => {
    render(
      <SopNotRequiredPicker
        template={template()}
        value={["food-specs", "allergens", "shopping-list"]}
        onChange={vi.fn()}
      />
    );
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("does not warn when only a dependant is marked N/A", () => {
    // Skipping Allergens on its own is fine. The trigger is a tick on the
    // prerequisite, not on the thing waiting.
    render(<SopNotRequiredPicker template={template()} value={["allergens"]} onChange={vi.fn()} />);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("names each stranded task once, not once per prerequisite", () => {
    render(<SopNotRequiredPicker template={template()} value={["food-specs"]} onChange={vi.fn()} />);
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
  });

  it("conveys the warning in words, not by colour", () => {
    render(<SopNotRequiredPicker template={template()} value={["food-specs"]} onChange={vi.fn()} />);
    const warning = screen.getByRole("status");
    expect(warning.textContent).toMatch(/will stay\s+blocked unless you mark it N\/A too/i);
  });
});
