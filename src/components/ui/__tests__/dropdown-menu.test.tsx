/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DropdownMenu, DropdownMenuItem } from "@/components/ui/dropdown-menu";

afterEach(cleanup);

function NestedConfirmation({ onConfirm }: { onConfirm: () => void }) {
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <>
      <DropdownMenuItem onClick={() => setConfirmOpen(true)}>
        Delete event
      </DropdownMenuItem>
      <ConfirmDialog
        open={confirmOpen}
        title="Delete this event?"
        confirmLabel="Delete"
        onConfirm={onConfirm}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  );
}

describe("DropdownMenu", () => {
  it("does not unmount a portalled confirmation before its click runs", () => {
    const onConfirm = vi.fn();

    render(
      <DropdownMenu trigger={<span>More actions</span>}>
        <NestedConfirmation onConfirm={onConfirm} />
      </DropdownMenu>
    );

    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete event" }));

    const confirmButton = screen.getByRole("button", { name: "Delete" });
    fireEvent.mouseDown(confirmButton);

    expect(screen.getByRole("dialog", { name: "Delete this event?" })).not.toBeNull();

    fireEvent.click(confirmButton);

    expect(onConfirm).toHaveBeenCalledOnce();
  });
});
