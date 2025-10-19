"use client";

import { useState, type ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

type CollapsibleCardProps = {
  title: string;
  defaultOpen?: boolean;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
};

export function CollapsibleCard({
  title,
  defaultOpen = false,
  description,
  actions,
  children,
  className,
}: CollapsibleCardProps) {
  const [open, setOpen] = useState(defaultOpen);

  const toggle = () => setOpen((prev) => !prev);

  return (
    <Card className={className}>
      <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="space-y-2">
          <CardTitle>{title}</CardTitle>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {actions}
          <Button
            type="button"
            variant="subtle"
            size="sm"
            aria-expanded={open}
            aria-controls={`${title}-collapsible-content`}
            onClick={toggle}
          >
            {open ? "Hide" : "Show"}
          </Button>
        </div>
      </CardHeader>
      {open ? (
        <CardContent id={`${title}-collapsible-content`} className="space-y-4">
          {children}
        </CardContent>
      ) : null}
    </Card>
  );
}
