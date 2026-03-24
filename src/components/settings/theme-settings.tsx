"use client";

import { useTheme } from "next-themes";
import { useTransition } from "react";
import { toast } from "sonner";
import { updateTheme } from "@/actions/user";
import { Monitor, Moon, Sun } from "lucide-react";

const themes = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
] as const;

export function ThemeSettings() {
  const { theme, setTheme } = useTheme();
  const [isPending, startTransition] = useTransition();

  const handleChange = (value: string) => {
    const previous = theme;
    setTheme(value);
    startTransition(async () => {
      try {
        await updateTheme(value);
      } catch {
        if (previous) setTheme(previous);
        toast.error("Failed to update theme");
      }
    });
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Choose how Kurir looks to you.
      </p>
      <div className="grid grid-cols-3 gap-2">
        {themes.map(({ value, label, icon: Icon }) => (
          <button
            key={value}
            type="button"
            disabled={isPending}
            onClick={() => handleChange(value)}
            className={`flex flex-col items-center gap-2 rounded-lg border p-3 text-sm font-medium transition-colors ${
              theme === value
                ? "border-primary bg-primary/5 text-primary"
                : "border-border text-muted-foreground hover:border-foreground/20 hover:text-foreground"
            } disabled:opacity-50`}
          >
            <Icon className="h-5 w-5" />
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
