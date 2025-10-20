import type { Metadata } from "next";
import Script from "next/script";
import { Geist, Geist_Mono, Playfair_Display } from "next/font/google";
import "./globals.css";
import { getCurrentUser } from "@/lib/auth";
import { AppShell } from "@/components/shell/app-shell";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"]
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"]
});

const playfair = Playfair_Display({
  variable: "--font-playfair",
  subsets: ["latin"],
  weight: ["400", "600", "700"]
});

const clientPolyfills = `
(() => {
  if (typeof globalThis !== "object") {
    return;
  }

  if (typeof globalThis.structuredClone !== "function") {
    const cloneValue = (value, seen) => {
      if (value === null || typeof value !== "object") {
        return value;
      }

      if (seen.has(value)) {
        return seen.get(value);
      }

      if (typeof Date !== "undefined" && value instanceof Date) {
        return new Date(value.getTime());
      }

      if (typeof RegExp !== "undefined" && value instanceof RegExp) {
        return new RegExp(value.source, value.flags);
      }

      if (typeof Blob !== "undefined" && value instanceof Blob) {
        return value.slice(0, value.size, value.type);
      }

      if (typeof File !== "undefined" && value instanceof File) {
        return new File([value], value.name, { type: value.type, lastModified: value.lastModified });
      }

      if (typeof ArrayBuffer !== "undefined" && value instanceof ArrayBuffer) {
        return value.slice(0);
      }

      if (typeof ArrayBuffer !== "undefined" && typeof ArrayBuffer.isView === "function" && ArrayBuffer.isView(value)) {
        return new value.constructor(value.buffer.slice(0));
      }

      if (typeof Map !== "undefined" && value instanceof Map) {
        const map = new Map();
        seen.set(value, map);
        value.forEach((entryValue, entryKey) => {
          map.set(cloneValue(entryKey, seen), cloneValue(entryValue, seen));
        });
        return map;
      }

      if (typeof Set !== "undefined" && value instanceof Set) {
        const set = new Set();
        seen.set(value, set);
        value.forEach((entry) => {
          set.add(cloneValue(entry, seen));
        });
        return set;
      }

      if (typeof FormData !== "undefined" && value instanceof FormData) {
        const form = new FormData();
        value.forEach((entryValue, entryKey) => {
          const clonedValue = typeof entryValue === "object" ? cloneValue(entryValue, seen) : entryValue;
          form.append(entryKey, clonedValue);
        });
        return form;
      }

      const isArray = Array.isArray(value);
      const copied = isArray ? [] : {};
      seen.set(value, copied);

      const keys = Object.keys(value);
      for (let i = 0; i < keys.length; i += 1) {
        copied[keys[i]] = cloneValue(value[keys[i]], seen);
      }

      if (typeof Object.getOwnPropertySymbols === "function") {
        const symbols = Object.getOwnPropertySymbols(value);
        for (let i = 0; i < symbols.length; i += 1) {
          copied[symbols[i]] = cloneValue(value[symbols[i]], seen);
        }
      }

      return copied;
    };

    globalThis.structuredClone = (value) => cloneValue(value, new WeakMap());
  }

  if (typeof globalThis.Storage === "function" && typeof globalThis.localStorage === "object") {
    const originalSetItem = globalThis.Storage.prototype.setItem;

    if (typeof originalSetItem === "function") {
      let needsPatch = false;

      try {
        const testKey = "__next_polyfill__";
        const testResult = originalSetItem.call(globalThis.localStorage, testKey, testKey);
        globalThis.localStorage.removeItem(testKey);

        if (!testResult || typeof testResult.then !== "function") {
          needsPatch = true;
        }
      } catch {
        needsPatch = false;
      }

      if (needsPatch) {
        globalThis.Storage.prototype.setItem = function () {
          originalSetItem.apply(this, arguments);
          return Promise.resolve();
        };
      }
    }
  }
})();
`;

export const metadata: Metadata = {
  title: "Barons Events Workspace",
  description: "Plan, review, and learn from events in one shared workspace."
};

export default async function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  const user = await getCurrentUser();

  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${playfair.variable} bg-[var(--color-canvas)] text-[var(--color-text)] antialiased`}
      >
        <Script id="client-polyfills" strategy="beforeInteractive">
          {clientPolyfills}
        </Script>
        <Toaster />
        {user ? <AppShell user={user}>{children}</AppShell> : children}
      </body>
    </html>
  );
}
