"use client";

import React from "react";
import { cn } from "@/lib/utils";

export type SyncStatus = "synced" | "syncing" | "offline" | "error";
export type EmailCategory = "imbox" | "feed" | "screener" | "paper-trail";

interface CategoryConfig {
  name: string;
  icon: string;
  description: string;
  color: string;
}

interface CategoryNavigationProps {
  activeCategory: EmailCategory;
  onCategoryChange: (category: EmailCategory) => void;
  counts: Record<EmailCategory, number>;
  syncStatus: SyncStatus;
  className?: string;
}

const categoryConfigs: Record<EmailCategory, CategoryConfig> = {
  imbox: {
    name: "Imbox",
    icon: "📥",
    description: "Important emails from people",
    color: "#7c3aed",
  },
  feed: {
    name: "Feed",
    icon: "📰",
    description: "Newsletters and updates",
    color: "#059669",
  },
  screener: {
    name: "Screener",
    icon: "🛡️",
    description: "New senders awaiting approval",
    color: "#dc2626",
  },
  "paper-trail": {
    name: "Paper Trail",
    icon: "📄",
    description: "Receipts and documents",
    color: "#ea580c",
  },
};

const syncStatusConfig = {
  synced: { label: "Synced", color: "text-green-600", bgColor: "bg-green-50" },
  syncing: {
    label: "Syncing...",
    color: "text-blue-600",
    bgColor: "bg-blue-50",
  },
  offline: {
    label: "Offline",
    color: "text-slate-500",
    bgColor: "bg-slate-50",
  },
  error: { label: "Error", color: "text-red-600", bgColor: "bg-red-50" },
};

export function CategoryNavigation({
  activeCategory,
  onCategoryChange,
  counts,
  syncStatus,
  className,
}: CategoryNavigationProps) {
  const statusConfig = syncStatusConfig[syncStatus];

  return (
    <nav
      role="navigation"
      aria-label="Email categories"
      className={cn(
        "flex flex-col space-y-3 p-4 bg-paper border-r border-slate-200",
        className,
      )}
    >
      <h2 id="categories-heading" className="sr-only">
        Email Categories
      </h2>

      {/* Sync Status Indicator */}
      <div
        className={cn(
          "flex items-center gap-3 px-3 py-2 rounded-lg",
          statusConfig.bgColor,
        )}
      >
        <div className="relative">
          <div
            className={cn(
              "w-2 h-2 rounded-full",
              syncStatus === "synced" && "bg-green-500",
              syncStatus === "syncing" && "bg-blue-500 animate-pulse",
              syncStatus === "offline" && "bg-slate-400",
              syncStatus === "error" && "bg-red-500",
            )}
          />
          {syncStatus === "syncing" && (
            <div className="absolute inset-0 w-2 h-2 rounded-full bg-blue-400 animate-ping opacity-75" />
          )}
        </div>
        <span className={cn("text-sm font-medium", statusConfig.color)}>
          {statusConfig.label}
        </span>
      </div>

      {/* Category List */}
      <ul
        role="list"
        aria-labelledby="categories-heading"
        className="space-y-1"
      >
        {(Object.keys(categoryConfigs) as EmailCategory[]).map((categoryId) => {
          const category = categoryConfigs[categoryId];
          const count = counts[categoryId] || 0;
          const isActive = activeCategory === categoryId;

          return (
            <li key={categoryId} role="listitem">
              <button
                role="tab"
                aria-selected={isActive}
                aria-controls={`${categoryId}-panel`}
                onClick={() => onCategoryChange(categoryId)}
                className={cn(
                  "w-full flex items-center justify-between px-3 py-3 rounded-lg transition-all duration-200 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 group",
                  isActive ? "bg-slate-100 shadow-xs" : "hover:bg-slate-50",
                )}
              >
                <div className="flex items-center gap-3">
                  <span
                    aria-hidden="true"
                    className="text-lg"
                    style={{ color: category.color }}
                  >
                    {category.icon}
                  </span>
                  <div className="text-left">
                    <div
                      className={cn(
                        "font-medium",
                        isActive ? "text-ink" : "text-slate-700",
                      )}
                    >
                      {category.name}
                    </div>
                    <div className="text-xs text-slate-500 hidden group-hover:block">
                      {category.description}
                    </div>
                  </div>
                </div>

                {count > 0 && (
                  <span
                    className={cn(
                      "inline-flex items-center justify-center min-w-[20px] h-5 px-2 text-xs font-semibold rounded-full",
                      isActive
                        ? "bg-primary text-primary-foreground"
                        : "bg-slate-200 text-slate-700",
                    )}
                    aria-label={`${count} emails in ${category.name}`}
                  >
                    {count > 99 ? "99+" : count}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>

      {/* Additional Actions */}
      <div className="pt-3 border-t border-slate-200">
        <button className="w-full text-left px-3 py-2 text-sm text-slate-600 hover:text-slate-800 hover:bg-slate-50 rounded-lg transition-colors duration-200">
          ⚙️ Settings
        </button>
      </div>
    </nav>
  );
}
