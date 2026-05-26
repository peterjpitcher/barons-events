"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

type TabsContextValue = {
  activeTab: string;
  setActiveTab: (tab: string) => void;
};

const TabsContext = createContext<TabsContextValue | null>(null);

function useTabsContext() {
  const ctx = useContext(TabsContext);
  if (!ctx) throw new Error("Tab components must be used within <Tabs>");
  return ctx;
}

type TabsProps = {
  defaultTab: string;
  value?: string;
  onValueChange?: (value: string) => void;
  children: ReactNode;
  className?: string;
};

export function Tabs({ defaultTab, value, onValueChange, children, className }: TabsProps) {
  const [internalTab, setInternalTab] = useState(defaultTab);
  const activeTab = value ?? internalTab;
  const setActiveTab = (tab: string) => {
    setInternalTab(tab);
    onValueChange?.(tab);
  };
  return (
    <TabsContext.Provider value={{ activeTab, setActiveTab }}>
      <div className={className}>{children}</div>
    </TabsContext.Provider>
  );
}

type TabsListProps = {
  children: ReactNode;
  className?: string;
};

export function TabsList({ children, className }: TabsListProps) {
  return (
    <div role="tablist" className={cn("inline-flex rounded-[7px] border border-[var(--hair)] bg-[var(--paper)] p-1", className)}>
      {children}
    </div>
  );
}

type TabsTriggerProps = {
  value: string;
  children: ReactNode;
  className?: string;
  indicator?: ReactNode;
};

export function TabsTrigger({ value, children, className, indicator }: TabsTriggerProps) {
  const { activeTab, setActiveTab } = useTabsContext();
  const isActive = activeTab === value;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={isActive}
      onClick={() => setActiveTab(value)}
      className={cn(
        "relative flex items-center gap-1.5 rounded-[5px] px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--mustard)] focus-visible:ring-inset",
        isActive
          ? "bg-[var(--navy)] text-white"
          : "text-[var(--ink-muted)] hover:text-[var(--ink)]",
        className
      )}
    >
      {children}
      {indicator}
    </button>
  );
}

type TabsContentProps = {
  value: string;
  children: ReactNode;
  className?: string;
};

export function TabsContent({ value, children, className }: TabsContentProps) {
  const { activeTab } = useTabsContext();
  return (
    <div role="tabpanel" hidden={activeTab !== value} className={cn(className)}>
      {children}
    </div>
  );
}
