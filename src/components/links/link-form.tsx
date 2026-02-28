"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field-error";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { LINK_TYPES, type LinkType, type ShortLink } from "@/lib/links";

export type LinkFormValues = {
  name:        string;
  destination: string;
  link_type:   LinkType;
  expires_at:  string; // empty = no expiry
};

type LinkFormProps = {
  mode:           "create" | "edit";
  initialValues?: Partial<ShortLink>;
  fieldErrors?:   Record<string, string>;
  onSubmit:       (values: LinkFormValues) => void;
  onCancel:       () => void;
  isPending:      boolean;
};

export function LinkForm({ mode, initialValues, fieldErrors = {}, onSubmit, onCancel, isPending }: LinkFormProps) {
  const [values, setValues] = useState<LinkFormValues>({
    name:        initialValues?.name        ?? "",
    destination: initialValues?.destination ?? "",
    link_type:   (initialValues?.link_type  ?? "general") as LinkType,
    expires_at:  initialValues?.expires_at  ? initialValues.expires_at.slice(0, 10) : "",
  });

  function set(field: keyof LinkFormValues, value: string) {
    setValues((prev) => ({ ...prev, [field]: value }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSubmit(values);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <label htmlFor="link-name" className="text-sm font-medium text-[var(--color-text)]">
            Name
          </label>
          <Input
            id="link-name"
            value={values.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="Summer cocktail menu"
            maxLength={120}
            disabled={isPending}
            aria-describedby={fieldErrors.name ? "link-name-error" : undefined}
          />
          <FieldError id="link-name-error" message={fieldErrors.name} />
        </div>

        <div className="space-y-1">
          <label htmlFor="link-type" className="text-sm font-medium text-[var(--color-text)]">
            Type
          </label>
          <Select
            id="link-type"
            value={values.link_type}
            onChange={(e) => set("link_type", e.target.value)}
            disabled={isPending}
          >
            {LINK_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>
          <FieldError id="link-type-error" message={fieldErrors.link_type} />
        </div>

        <div className="space-y-1 sm:col-span-2">
          <label htmlFor="link-destination" className="text-sm font-medium text-[var(--color-text)]">
            Destination URL
          </label>
          <Input
            id="link-destination"
            type="url"
            value={values.destination}
            onChange={(e) => set("destination", e.target.value)}
            placeholder="https://baronspubs.com/events/..."
            maxLength={2048}
            disabled={isPending}
            aria-describedby={fieldErrors.destination ? "link-destination-error" : undefined}
          />
          <FieldError id="link-destination-error" message={fieldErrors.destination} />
        </div>

        <div className="space-y-1">
          <label htmlFor="link-expires" className="text-sm font-medium text-[var(--color-text)]">
            Expiry date{" "}
            <span className="font-normal text-subtle">(optional)</span>
          </label>
          <Input
            id="link-expires"
            type="date"
            value={values.expires_at}
            onChange={(e) => set("expires_at", e.target.value)}
            disabled={isPending}
            aria-describedby={fieldErrors.expires_at ? "link-expires-error" : undefined}
          />
          <FieldError id="link-expires-error" message={fieldErrors.expires_at} />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" variant="primary" disabled={isPending}>
          {isPending ? "Saving…" : mode === "create" ? "Create link" : "Save changes"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel} disabled={isPending}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
