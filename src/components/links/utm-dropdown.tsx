"use client";

import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import QRCode from "qrcode";
import { ChevronDown, Link2, Loader2, Printer } from "lucide-react";
import {
  DIGITAL_TOUCHPOINTS,
  PRINT_TOUCHPOINTS,
  type ShortLink,
  type Touchpoint,
} from "@/lib/links";
import { getOrCreateUtmVariantAction } from "@/actions/links";

const QR_OPTIONS: QRCode.QRCodeToDataURLOptions = {
  width: 512,
  margin: 2,
  errorCorrectionLevel: "M",
  // The qrcode library only accepts hex colours — CSS rgb()/rgba() strings
  // throw "Invalid hex color". #273640 is the brand slate (rgb 39,54,64).
  color: { dark: "#273640", light: "#ffffff" },
};

type UtmDropdownProps = {
  link:           ShortLink;
  mode:           "share" | "print";
  disabled?:      boolean;
  onNewVariant?:  (link: ShortLink) => void;
};

export function UtmDropdown({ link, mode, disabled, onNewVariant }: UtmDropdownProps) {
  const [open, setOpen]           = useState(false);
  const [menuRect, setMenuRect]   = useState<DOMRect | null>(null);
  const [mounted, setMounted]     = useState(false);
  const [loading, setLoading]     = useState<string | null>(null); // touchpoint value being fetched
  const buttonRef                 = useRef<HTMLButtonElement>(null);
  const menuRef                   = useRef<HTMLDivElement>(null);

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

  /** Runs the server action and surfaces its variant row; resolves with the short URL. */
  async function fetchVariantUrl(tp: Touchpoint): Promise<string> {
    const result = await getOrCreateUtmVariantAction(link.id, tp.value);
    if (!result.success || !result.url) {
      throw new Error(result.message ?? "Could not generate link.");
    }
    // Notify parent of the variant row (new or reused) so it can add it to state.
    if (result.link) onNewVariant?.(result.link);
    return result.url;
  }

  /**
   * Copies the (async) URL to the clipboard. Safari revokes the transient
   * user-activation once the awaited server action resolves, so writeText
   * after the await fails there. The ClipboardItem promise pattern starts the
   * clipboard write synchronously inside the gesture and lets the text arrive
   * later; writeText remains the fallback for browsers without ClipboardItem.
   */
  async function copyVariantUrl(urlPromise: Promise<string>, tp: Touchpoint): Promise<void> {
    try {
      if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
        const item = new ClipboardItem({
          "text/plain": urlPromise.then((url) => new Blob([url], { type: "text/plain" })),
        });
        await navigator.clipboard.write([item]);
      } else {
        await navigator.clipboard.writeText(await urlPromise);
      }
      toast.success(`${tp.label} URL copied.`);
    } catch (error) {
      // Distinguish "the action failed" from "the clipboard write failed".
      try {
        await urlPromise;
      } catch (actionError) {
        toast.error(actionError instanceof Error ? actionError.message : "Could not generate link.");
        return;
      }
      console.error("Clipboard write failed:", error);
      toast.error("Could not copy to clipboard.");
    }
  }

  function handleSelect(tp: Touchpoint) {
    setOpen(false);
    setLoading(tp.value);

    if (mode === "share") {
      // IMPORTANT: copyVariantUrl is called synchronously within the click
      // gesture (no await before it) so Safari keeps the clipboard permission.
      const urlPromise = fetchVariantUrl(tp);
      void copyVariantUrl(urlPromise, tp).finally(() => setLoading(null));
      return;
    }

    void handlePrint(tp);
  }

  async function handlePrint(tp: Touchpoint) {
    try {
      const url = await fetchVariantUrl(tp);

      // Print: generate and download QR code PNG.
      try {
        const dataUrl = await QRCode.toDataURL(url, QR_OPTIONS);
        const a = document.createElement("a");
        a.href     = dataUrl;
        a.download = `qr-${link.code}-${tp.value}.png`;
        a.click();
      } catch (error) {
        console.error("QR code generation failed:", error);
        toast.error("Could not generate QR code.");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not generate link.");
    } finally {
      setLoading(null);
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
            className="w-52 overflow-hidden rounded-[var(--radius-md)] border border-[var(--hair)] bg-[var(--paper)] py-1 shadow-lg"
          >
            <p className="px-3 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-widest text-subtle">
              {mode === "share" ? "Copy URL for…" : "Download QR for…"}
            </p>
            {touchpoints.map((tp) => (
              <button
                key={tp.value}
                type="button"
                onClick={() => handleSelect(tp)}
                className="w-full px-3 py-2 text-left text-sm text-[var(--ink)] hover:bg-[var(--color-canvas)] transition-colors"
              >
                {tp.label}
              </button>
            ))}
          </div>,
          document.body
        )
      : null;

  const isLoading = loading !== null;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={handleToggle}
        disabled={disabled || isLoading}
        className="flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-subtle hover:bg-[var(--canvas-2)] hover:text-[var(--ink)] transition-colors disabled:opacity-40"
      >
        {isLoading
          ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          : mode === "share"
            ? <Link2   className="h-3.5 w-3.5" aria-hidden="true" />
            : <Printer className="h-3.5 w-3.5" aria-hidden="true" />
        }
        {mode === "share" ? "Share" : "Print"}
        {!isLoading && <ChevronDown className="h-3 w-3" aria-hidden="true" />}
      </button>
      {menu}
    </>
  );
}
