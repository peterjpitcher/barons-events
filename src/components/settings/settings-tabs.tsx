"use client";

import type { ReactNode } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

interface SettingsTab {
  value: string;
  label: string;
  description: string;
  content: ReactNode;
}

export function SettingsTabs({ tabs }: { tabs: SettingsTab[] }) {
  return (
    <Tabs defaultTab={tabs[0]?.value ?? ""}>
      <TabsList className="border-b border-[var(--color-border)] mb-6">
        {tabs.map((tab) => (
          <TabsTrigger key={tab.value} value={tab.value}>
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {tabs.map((tab) => (
        <TabsContent key={tab.value} value={tab.value}>
          <p className="text-sm text-subtle mb-6">{tab.description}</p>
          {tab.content}
        </TabsContent>
      ))}
    </Tabs>
  );
}
