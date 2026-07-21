// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Sheet, SheetContent } from "@/components/ui/sheet";

afterEach(cleanup);

describe("ConfirmDialog", () => {
  it("confirms when the confirm button is clicked", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        open
        title="Delete this note?"
        confirmLabel="Delete note"
        cancelLabel="Keep note"
        variant="danger"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Delete note" }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("stays clickable when rendered inside an open Sheet, and does not close the Sheet", () => {
    const onConfirm = vi.fn();
    const onSheetOpenChange = vi.fn();

    render(
      <Sheet open onOpenChange={onSheetOpenChange}>
        <SheetContent side="right">
          <p>Edit calendar note</p>
        </SheetContent>
        <ConfirmDialog
          open
          title="Delete this note?"
          confirmLabel="Delete note"
          cancelLabel="Keep note"
          variant="danger"
          onConfirm={onConfirm}
          onCancel={vi.fn()}
        />
      </Sheet>
    );

    fireEvent.click(screen.getByRole("button", { name: "Delete note" }));

    // The confirm must win the click; the Sheet must not be closed by it.
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onSheetOpenChange).not.toHaveBeenCalled();
  });

  it("renders above a Sheet in the stacking order", () => {
    render(
      <Sheet open onOpenChange={vi.fn()}>
        <SheetContent side="right">
          <p>Edit calendar note</p>
        </SheetContent>
        <ConfirmDialog open title="Delete this note?" onConfirm={vi.fn()} onCancel={vi.fn()} />
      </Sheet>
    );

    const confirmOverlay = screen.getByRole("dialog", { name: "Delete this note?" })
      .parentElement as HTMLElement;

    // z-[60] beats the Sheet overlay's z-50 regardless of DOM order.
    expect(confirmOverlay.className).toContain("z-[60]");

    // Portaled to body rather than nested inside the Sheet subtree, so the
    // Sheet's backdrop can never paint over it.
    expect(confirmOverlay.parentElement).toBe(document.body);
  });

  it("cancels on Escape without letting the Sheet also handle the key", () => {
    const onCancel = vi.fn();
    const onSheetOpenChange = vi.fn();

    render(
      <Sheet open onOpenChange={onSheetOpenChange}>
        <SheetContent side="right">
          <p>Edit calendar note</p>
        </SheetContent>
        <ConfirmDialog
          open
          title="Delete this note?"
          onConfirm={vi.fn()}
          onCancel={onCancel}
        />
      </Sheet>
    );

    fireEvent.keyDown(document, { key: "Escape" });

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSheetOpenChange).not.toHaveBeenCalled();
  });
});
