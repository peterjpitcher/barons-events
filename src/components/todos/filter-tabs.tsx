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
            className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary-500)] ${
              isActive
                ? "bg-[var(--color-primary-700)] text-white"
                : "bg-[var(--color-muted-surface)] text-[var(--color-text)] hover:bg-[var(--color-border)]"
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
