"use client";

import type { TodoSource } from "./todo-item-types";

type FilterTab = {
  key: TodoSource | "all";
  label: string;
  count: number;
};

type FilterTabsProps = {
  tabs: FilterTab[];
  activeTab: TodoSource | "all";
  onTabChange: (tab: TodoSource | "all") => void;
};

export type { FilterTab };

export function FilterTabs({
  tabs,
  activeTab,
  onTabChange,
}: FilterTabsProps): React.ReactNode {
  // Hide zero-count tabs except "all"
  const visibleTabs = tabs.filter((tab) => tab.key === "all" || tab.count > 0);

  return (
    <div role="tablist" className="flex flex-wrap gap-1.5">
      {visibleTabs.map((tab) => {
        const isActive = activeTab === tab.key;
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onTabChange(tab.key)}
            className={`rounded-full px-3 py-1 font-brand-mono text-[0.625rem] font-semibold uppercase tracking-[0.04em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--mustard-tint)] ${
              isActive
                ? "bg-[var(--navy)] text-white"
                : "bg-[var(--paper-tint)] text-[var(--ink)] hover:bg-[var(--canvas-2)]"
            }`}
          >
            {tab.label}
            <span className="ml-1 opacity-80">{tab.count}</span>
          </button>
        );
      })}
    </div>
  );
}
