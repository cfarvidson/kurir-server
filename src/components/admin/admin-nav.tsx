"use client";

import Link from "next/link";
import { ArrowLeft, Shield } from "lucide-react";
import { KurirLogo } from "@/components/logo";

export function AdminNav() {
  return (
    <header className="flex h-14 items-center gap-3 border-b bg-card px-4 md:px-6">
      <Link
        href="/imbox"
        className="flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        <span className="hidden sm:inline">Back to Imbox</span>
      </Link>

      <div className="mx-auto flex items-center gap-2">
        <KurirLogo className="h-6 w-6" />
        <div className="flex items-center gap-1.5">
          <Shield className="h-4 w-4 text-primary" />
          <h1 className="text-lg font-semibold">Admin</h1>
        </div>
      </div>

      {/* Spacer for centering */}
      <div className="w-[120px] hidden sm:block" />
    </header>
  );
}
