// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { FormErrorSummary } from "@/components/ui/form-error-summary";

const SINGLE_HANDLED_ERROR_KEYS = ["title", "typeLabel", "targetDate", "venueId", "venueIds", "ownerId"];

afterEach(() => cleanup());

describe("FormErrorSummary", () => {
  it("renders nothing when every error has its own field on screen", () => {
    const { container } = render(
      <FormErrorSummary
        id="summary"
        errors={{ title: "Add a title", targetDate: "Choose a target date" }}
        handledKeys={SINGLE_HANDLED_ERROR_KEYS}
      />
    );
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing when there are no errors at all", () => {
    const { container } = render(
      <FormErrorSummary id="summary" errors={{}} handledKeys={SINGLE_HANDLED_ERROR_KEYS} />
    );
    expect(container.innerHTML).toBe("");
  });

  it("surfaces an indexed array error that matches no input, which is the reported bug", () => {
    render(
      <FormErrorSummary
        id="summary"
        errors={{ "sopNotRequiredTemplateIds.0": "Unrecognised SOP task" }}
        handledKeys={SINGLE_HANDLED_ERROR_KEYS}
      />
    );
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("This could not be saved");
    expect(alert.textContent).toContain("SOP items marked N/A: Unrecognised SOP task");
  });

  it("matches on the segment before the dot, so any index is caught", () => {
    render(
      <FormErrorSummary
        id="summary"
        errors={{ "sopNotRequiredTemplateIds.7": "Unrecognised SOP task" }}
        handledKeys={SINGLE_HANDLED_ERROR_KEYS}
      />
    );
    expect(screen.getByRole("alert").textContent).toContain("SOP items marked N/A");
  });

  it("does not repeat the same message once per failing array entry", () => {
    render(
      <FormErrorSummary
        id="summary"
        errors={{
          "sopNotRequiredTemplateIds.0": "Unrecognised SOP task",
          "sopNotRequiredTemplateIds.1": "Unrecognised SOP task",
          "sopNotRequiredTemplateIds.2": "Unrecognised SOP task"
        }}
        handledKeys={SINGLE_HANDLED_ERROR_KEYS}
      />
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });

  it("shows only the unmatched error when a handled one is present too", () => {
    render(
      <FormErrorSummary
        id="summary"
        errors={{ title: "Add a title", status: "Invalid option" }}
        handledKeys={SINGLE_HANDLED_ERROR_KEYS}
      />
    );
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(1);
    expect(items[0].textContent).toBe("Status: Invalid option");
  });

  it("falls back to the bare message for a key it has no label for", () => {
    render(
      <FormErrorSummary
        id="summary"
        errors={{ somethingNew: "That did not work" }}
        handledKeys={SINGLE_HANDLED_ERROR_KEYS}
      />
    );
    expect(screen.getByRole("listitem").textContent).toBe("That did not work");
  });

  it("announces itself and takes focus so the failure is not silent", () => {
    render(
      <FormErrorSummary
        id="summary"
        errors={{ "sopNotRequiredTemplateIds.0": "Unrecognised SOP task" }}
        handledKeys={SINGLE_HANDLED_ERROR_KEYS}
      />
    );
    const alert = screen.getByRole("alert");
    expect(alert.getAttribute("id")).toBe("summary");
    expect(alert.getAttribute("tabindex")).toBe("-1");
    expect(document.activeElement).toBe(alert);
  });

  it("conveys the failure with text, not colour alone", () => {
    render(
      <FormErrorSummary
        id="summary"
        errors={{ "sopNotRequiredTemplateIds.0": "Unrecognised SOP task" }}
        handledKeys={SINGLE_HANDLED_ERROR_KEYS}
      />
    );
    // A heading plus a per-field line, so the message survives without colour.
    expect(screen.getByRole("alert").textContent).toContain("This could not be saved");
    expect(screen.getAllByRole("listitem").length).toBeGreaterThan(0);
  });
});
