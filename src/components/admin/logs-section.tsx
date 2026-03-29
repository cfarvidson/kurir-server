"use client";

import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { RefreshCw, AlertCircle } from "lucide-react";

interface LogEntry {
  type: "sync" | "error";
  email: string;
  timestamp: string | null;
  message: string;
}

export function LogsSection() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "errors">("all");

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/logs");
      if (!res.ok) throw new Error("Failed to fetch logs");
      const data = await res.json();
      setLogs(data.logs);
      setError(null);
    } catch {
      setError("Failed to load logs");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const filteredLogs =
    filter === "errors" ? logs.filter((l) => l.type === "error") : logs;

  const formatTimestamp = (ts: string | null) => {
    if (!ts) return "\u2014";
    const d = new Date(ts);
    return d.toLocaleString();
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Button
            variant={filter === "all" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setFilter("all")}
          >
            All
          </Button>
          <Button
            variant={filter === "errors" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setFilter("errors")}
          >
            <AlertCircle className="mr-1.5 h-3.5 w-3.5" />
            Errors only
          </Button>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={fetchLogs}
          disabled={loading}
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {error && !logs.length ? (
        <div className="rounded-lg border bg-card p-4 text-sm text-destructive">
          {error}
        </div>
      ) : filteredLogs.length === 0 ? (
        <div className="rounded-lg border bg-card p-8 text-center text-sm text-muted-foreground">
          {loading ? "Loading logs..." : "No log entries found"}
        </div>
      ) : (
        <div className="rounded-lg border bg-card overflow-hidden">
          <div className="max-h-[500px] overflow-auto p-4">
            <div className="space-y-1 font-mono text-xs">
              {filteredLogs.map((log, i) => (
                <div
                  key={i}
                  className={`flex gap-2 rounded px-2 py-1 ${
                    log.type === "error"
                      ? "bg-destructive/5 text-destructive"
                      : "text-foreground"
                  }`}
                >
                  <span className="shrink-0 text-muted-foreground">
                    {formatTimestamp(log.timestamp)}
                  </span>
                  <span className="shrink-0 font-medium">[{log.email}]</span>
                  <span className="break-all">{log.message}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
