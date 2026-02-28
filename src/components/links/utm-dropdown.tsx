"use client";

import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import QRCode from "qrcode";
import { ChevronDown, Link2, Printer } from "lucide-react";
import {
  DIGITAL_TOUCHPOINTS,
  PRINT_TOUCHPOINTS,
  buildUtmShortUrl,
  type ShortLink,
  type Touchpoint,
} from "@/lib/links";

const QR_OPTIONS: QRCode.QRCodeToDataURLOptions = {
  width: 512,
  margin: 2,
  errorCorrectionLevel: "M",
  color: { dark: "#273640", light: "#ffffff" },
};

type UtmDropdownProps = {
  link:    ShortLink;
  mode:    "share" | "print";
  disabled?: boolean;
};

export function UtmDropdown({ link, mode, disabled }: UtmDropdownProps) {
  const [open, setOpen]       = useState(false);
  const [menuRect, setMenuRect] = useState<DOMRect | null>(null);
  const [mounted, setMounted] = useState(false);
  const buttonRef             = useRef<HTMLButtonElement>(null);
  const menuRef               = useRef<HTMLDivElement>(null);

  useEffect(() => { setMounted(true); }, []);

  const touchpoints = mode === "share" ? DIGITAL_TOUCHPOINTS : PRINT_TOUCHPOINTS;

  function handleToggle() {
    if (disabled) return;
    if (!open && buttonRef.current) {
      setMenuRect(buttonRef.current.getBoundingClientRect());
    }
    setOpen((v) => !v);
  }

  // Close on outside click or scroll.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (
        !menuRef.current?.contains(e.target as Node) &&
        !buttonRef.current?.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    function onScroll() { setOpen(false); }
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("scroll", onScroll);
    };
  }, [open]);

  async function handleSelect(tp: Touchpoint) {
    setOpen(false);
    const url = buildUtmShortUrl(link.code, tp, link.name);

    if (mode === "share") {
      try {
        await navigator.clipboard.writeText(url);
        toast.success(`${tp.label} URL copied.`);
      } catch {
        toast.error("Could not copy to clipboard.");
      }
      return;
    }

    // Print: generate and download QR code PNG.
    try {
      const dataUrl = await QRCode.toDataURL(url, QR_OPTIONS);
      const a = document.createElement("a");
      a.href     = dataUrl;
      a.download = `qr-${link.code}-${tp.value}.png`;
      a.click();
    } catch {
      toast.error("Could not generate QR code.");
    }
  }

  // Flip the menu left if it would overflow the viewport.
  const menuWidth = 208; // w-52 = 13rem = 208px
  const menuLeft  = menuRect
    ? menuRect.left + menuWidth > window.innerWidth
      ? menuRect.right - menuWidth
      : menuRect.left
    : 0;

  const menu =
    open && menuRect && mounted
      ? createPortal(
          <div
            ref={menuRef}
            style={{
              position: "fixed",
              top:      menuRect.bottom + 4,
              left:     menuLeft,
              zIndex:   9999,
            }}
            className="w-52 overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-white py-1 shadow-lg"
          >
            <p className="px-3 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-widest text-subtle">
              {mode === "share" ? "Copy URL for…" : "Download QR for…"}
            </p>
            {touchpoints.map((tp) => (
              <button
                key={tp.value}
                type="button"
                onClick={() => handleSelect(tp)}
                className="w-full px-3 py-2 text-left text-sm text-[var(--color-text)] hover:bg-[var(--color-canvas)] transition-colors"
              >
                {tp.label}
              </button>
            ))}
          </div>,
          document.body
        )
      : null;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={handleToggle}
        disabled={disabled}
        className="flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-subtle hover:bg-[var(--color-muted-surface)] hover:text-[var(--color-text)] transition-colors disabled:opacity-40"
      >
        {mode === "share"
          ? <Link2    className="h-3.5 w-3.5" aria-hidden="true" />
          : <Printer  className="h-3.5 w-3.5" aria-hidden="true" />
        }
        {mode === "share" ? "Share" : "Print"}
        <ChevronDown className="h-3 w-3" aria-hidden="true" />
      </button>
      {menu}
    </>
  );
}
