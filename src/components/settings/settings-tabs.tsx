"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

interface SettingsTab {
  value: string;
  label: string;
  description: string;
  content: ReactNode;
}

export function SettingsTabs({ tabs, initialTab }: { tabs: SettingsTab[]; initialTab?: string }) {
  const firstTab = tabs[0]?.value ?? "";
  const mobileDefaultTab = tabs.find((tab) => tab.value === "event-types")?.value ?? firstTab;
  const requestedTab = useMemo(
    () => (initialTab && tabs.some((tab) => tab.value === initialTab) ? initialTab : null),
    [initialTab, tabs],
  );
  const [activeTab, setActiveTab] = useState(requestedTab ?? firstTab);

  useEffect(() => {
    if (requestedTab) {
      setActiveTab(requestedTab);
      return;
    }

    const media = window.matchMedia("(max-width: 767px)");
    const applyDefault = () => setActiveTab(media.matches ? mobileDefaultTab : firstTab);
    applyDefault();
    media.addEventListener("change", applyDefault);
    return () => media.removeEventListener("change", applyDefault);
  }, [firstTab, mobileDefaultTab, requestedTab]);

  return (
    <Tabs defaultTab={activeTab} value={activeTab} onValueChange={setActiveTab}>
      <TabsList className="mb-6 flex w-full max-w-full gap-2 overflow-x-auto border-0 bg-transparent p-0 md:inline-flex md:w-auto md:rounded-[7px] md:border md:border-[var(--hair)] md:bg-[var(--paper)] md:p-1">
        {tabs.map((tab) => (
          <TabsTrigger key={tab.value} value={tab.value} className="h-11 shrink-0 rounded-full px-4 md:h-auto md:rounded-[5px] md:px-3">
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {tabs.map((tab) => (
        <TabsContent key={tab.value} value={tab.value}>
          <p className="text-sm text-subtle mb-6">{tab.description}</p>
          <div key={`${tab.value}-content`}>{tab.content}</div>
        </TabsContent>
      ))}
    </Tabs>
  );
}
