"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { cn } from "@/lib/utils";
import {
  Inbox,
  Filter,
  Send,
  Settings,
  PenSquare,
  Newspaper,
  Receipt,
  LogOut,
  Mail,
} from "lucide-react";
import { Button } from "@/components/ui/button";

const navigation = [
  { name: "Imbox", href: "/imbox", icon: Inbox },
  { name: "Screener", href: "/screener", icon: Filter, badge: true },
  { name: "The Feed", href: "/feed", icon: Newspaper },
  { name: "Paper Trail", href: "/paper-trail", icon: Receipt },
  { name: "Sent", href: "/sent", icon: Send },
];

interface SidebarProps {
  screenerCount?: number;
}

export function Sidebar({ screenerCount = 0 }: SidebarProps) {
  const pathname = usePathname();

  return (
    <div className="flex h-full w-64 flex-col border-r bg-card">
      {/* Logo */}
      <div className="flex h-16 items-center gap-2 border-b px-6">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
          <Mail className="h-4 w-4 text-primary-foreground" />
        </div>
        <span className="text-xl font-semibold">Kurir</span>
      </div>

      {/* Compose button */}
      <div className="p-4">
        <Button asChild className="w-full gap-2">
          <Link href="/compose">
            <PenSquare className="h-4 w-4" />
            Compose
          </Link>
        </Button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 px-3">
        {navigation.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.name}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              <item.icon className="h-5 w-5" />
              <span className="flex-1">{item.name}</span>
              {item.badge && screenerCount > 0 && (
                <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-xs font-medium text-primary-foreground">
                  {screenerCount > 99 ? "99+" : screenerCount}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="border-t p-3">
        <Link
          href="/settings"
          className={cn(
            "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
            pathname === "/settings"
              ? "bg-primary/10 text-primary"
              : "text-muted-foreground hover:bg-muted hover:text-foreground"
          )}
        >
          <Settings className="h-5 w-5" />
          Settings
        </Link>
        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <LogOut className="h-5 w-5" />
          Sign out
        </button>
      </div>
    </div>
  );
}
