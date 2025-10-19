"use client";

import { useMemo, useState } from "react";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";

type ChannelOption = "email_in_app" | "in_app" | "off";

export type NotificationPreference = {
  id: string;
  label: string;
  helper: string;
  defaultValue: ChannelOption;
  runbookHref?: string;
  critical?: boolean;
};

type NotificationPreferencesProps = {
  items: NotificationPreference[];
};

const selectOptions: Array<{ value: ChannelOption; label: string }> = [
  { value: "email_in_app", label: "Email + in-app" },
  { value: "in_app", label: "In-app only" },
  { value: "off", label: "Disabled" },
];

export function NotificationPreferences({ items }: NotificationPreferencesProps) {
  const initialState = useMemo(() => {
    return items.reduce<Record<string, ChannelOption>>((acc, item) => {
      acc[item.id] = item.defaultValue;
      return acc;
    }, {});
  }, [items]);

  const [state, setState] = useState<Record<string, ChannelOption>>(initialState);
  const [toast, setToast] = useState<{ id: string; message: string } | null>(null);

  const handleChange = (id: string, value: string) => {
    if (value !== "email_in_app" && value !== "in_app" && value !== "off") {
      return;
    }
    setState((prev) => ({
      ...prev,
      [id]: value,
    }));
  };

  const handleTest = (id: string) => {
    const preference = items.find((item) => item.id === id);
    if (!preference) return;
    const selected = state[id];
    if (selected === "off") {
      setToast({
        id,
        message: `${preference.label} is disabled — enable it to receive test alerts.`,
      });
      return;
    }
    setToast({
      id,
      message: `We’ll send a ${selected === "email_in_app" ? "combined email + in-app" : "in-app"} test alert. Reach out to Peter Pitcher if you don’t receive it.`,
    });
    setTimeout(() => setToast(null), 3200);
  };

  return (
    <div className="space-y-4">
      {toast ? (
        <Alert variant="info" title="Notification test queued">
          <p className="mt-1 text-[0.95rem] text-[var(--color-primary-800)]">{toast.message}</p>
        </Alert>
      ) : null}
      <div className="space-y-3">
        {items.map((item) => {
          const currentValue = state[item.id] ?? "off";
          const runbookLink = item.runbookHref ? (
            <a
              href={item.runbookHref}
              target="_blank"
              rel="noreferrer"
              className="text-xs font-semibold text-[var(--color-primary-700)] underline decoration-dotted underline-offset-2 hover:text-[var(--color-primary-900)]"
            >
              View runbook guidance
            </a>
          ) : null;

          return (
            <div
              key={item.id}
              className="flex flex-col gap-3 rounded-[var(--radius-lg)] border border-[rgba(42,79,168,0.15)] bg-white/95 p-4 shadow-soft sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="max-w-lg space-y-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-[var(--color-primary-900)]">
                    {item.label}
                  </p>
                  {item.critical ? <Badge variant="danger">Critical</Badge> : null}
                </div>
                <p className="text-xs text-muted leading-relaxed">{item.helper}</p>
                {runbookLink}
              </div>
              <div className="flex flex-col items-stretch gap-2 sm:w-56">
                <Select
                  name={item.id}
                  value={currentValue}
                  onChange={(event) => handleChange(item.id, event.target.value)}
                >
                  {selectOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => handleTest(item.id)}
                >
                  Send test alert
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
