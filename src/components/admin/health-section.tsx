"use client";

import { useEffect, useState } from "react";
import {
  Activity,
  Database,
  HardDrive,
  Info,
  RefreshCw,
  Server,
  Wifi,
  WifiOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";

interface HealthData {
  status: string;
  uptime: number;
  postgres: { connected: boolean; version: string | null; size: string | null };
  redis: { connected: boolean; memoryUsed: string | null };
  memory: { heapUsed: string; heapTotal: string; rss: string };
  system: { freeMemory: string; totalMemory: string };
  sync: { active: number; waiting: number; delayed: number; failed: number };
  maintenance: {
    active: number;
    waiting: number;
    delayed: number;
    failed: number;
  };
  connections: { idle: number; cap: number };
}

interface HealthSectionProps {
  versionInfo: {
    version: string;
    node: string;
    env: string;
    domain: string;
  };
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span
      className={`inline-block h-2 w-2 rounded-full ${ok ? "bg-green-500" : "bg-destructive"}`}
    />
  );
}

export function HealthSection({ versionInfo }: HealthSectionProps) {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchHealth = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/health");
      if (!res.ok) throw new Error("Failed to fetch health");
      setHealth(await res.json());
      setError(null);
    } catch {
      setError("Failed to load system health");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHealth();
    const interval = setInterval(fetchHealth, 30_000);
    return () => clearInterval(interval);
  }, []);

  if (loading && !health) {
    return (
      <section>
        <h2 className="text-lg font-medium">Health</h2>
        <div className="mt-4 rounded-lg border bg-card p-4 text-sm text-muted-foreground">
          Loading...
        </div>
      </section>
    );
  }

  if (error && !health) {
    return (
      <section>
        <h2 className="text-lg font-medium">Health</h2>
        <div className="mt-4 rounded-lg border bg-card p-4 text-sm text-destructive">
          {error}
        </div>
      </section>
    );
  }

  if (!health) return null;

  return (
    <section>
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">Health</h2>
        <Button
          variant="ghost"
          size="sm"
          onClick={fetchHealth}
          disabled={loading}
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {/* Postgres */}
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Database className="h-4 w-4 text-muted-foreground" />
            Postgres
          </div>
          <div className="mt-2 space-y-1 text-xs">
            <div className="flex items-center gap-1.5">
              <StatusDot ok={health.postgres.connected} />
              <span className="font-medium">
                {health.postgres.connected ? "Connected" : "Disconnected"}
              </span>
            </div>
            {health.postgres.version && (
              <div>
                <span className="text-muted-foreground">Version:</span>{" "}
                <span className="font-medium">
                  {health.postgres.version.split(",")[0]}
                </span>
              </div>
            )}
            {health.postgres.size && (
              <div>
                <span className="text-muted-foreground">DB size:</span>{" "}
                <span className="font-medium">{health.postgres.size}</span>
              </div>
            )}
          </div>
        </div>

        {/* Redis */}
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-center gap-2 text-sm font-medium">
            {health.redis.connected ? (
              <Wifi className="h-4 w-4 text-green-500" />
            ) : (
              <WifiOff className="h-4 w-4 text-destructive" />
            )}
            Redis
          </div>
          <div className="mt-2 space-y-1 text-xs">
            <div className="flex items-center gap-1.5">
              <StatusDot ok={health.redis.connected} />
              <span className="font-medium">
                {health.redis.connected ? "Connected" : "Disconnected"}
              </span>
            </div>
            {health.redis.memoryUsed && (
              <div>
                <span className="text-muted-foreground">Memory:</span>{" "}
                <span className="font-medium">{health.redis.memoryUsed}</span>
              </div>
            )}
          </div>
        </div>

        {/* Memory */}
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-center gap-2 text-sm font-medium">
            <HardDrive className="h-4 w-4 text-muted-foreground" />
            Memory
          </div>
          <div className="mt-2 space-y-1 text-xs">
            <div>
              <span className="text-muted-foreground">Heap:</span>{" "}
              <span className="font-medium">
                {health.memory.heapUsed} / {health.memory.heapTotal}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">RSS:</span>{" "}
              <span className="font-medium">{health.memory.rss}</span>
            </div>
          </div>
        </div>

        {/* System */}
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Server className="h-4 w-4 text-muted-foreground" />
            System
          </div>
          <div className="mt-2 space-y-1 text-xs">
            <div>
              <span className="text-muted-foreground">OS Memory:</span>{" "}
              <span className="font-medium">
                {health.system.freeMemory} free / {health.system.totalMemory}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">Uptime:</span>{" "}
              <span className="font-medium">{formatUptime(health.uptime)}</span>
            </div>
          </div>
        </div>

        {/* Sync Queue */}
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Activity className="h-4 w-4 text-muted-foreground" />
            Sync Queue
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
            <div>
              <span className="text-muted-foreground">Active:</span>{" "}
              <span className="font-medium">{health.sync.active}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Waiting:</span>{" "}
              <span className="font-medium">{health.sync.waiting}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Delayed:</span>{" "}
              <span className="font-medium">{health.sync.delayed}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Failed:</span>{" "}
              <span
                className={`font-medium ${health.sync.failed > 0 ? "text-destructive" : ""}`}
              >
                {health.sync.failed}
              </span>
            </div>
          </div>
        </div>

        {/* IMAP Pool */}
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Server className="h-4 w-4 text-muted-foreground" />
            IMAP Pool
          </div>
          <div className="mt-2">
            <p className="text-2xl font-semibold">
              {health.connections.idle}
              <span className="text-sm text-muted-foreground font-normal">
                {" "}
                / {health.connections.cap}
              </span>
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              idle / capacity
            </p>
          </div>
        </div>
      </div>

      {/* Version Info */}
      <div className="mt-3 rounded-lg border bg-card p-4">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Info className="h-4 w-4 text-muted-foreground" />
          Version Info
        </div>
        <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-xs">
          <div>
            <span className="text-muted-foreground">App:</span>{" "}
            <span className="font-medium">{versionInfo.version}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Node:</span>{" "}
            <span className="font-medium">{versionInfo.node}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Env:</span>{" "}
            <span className="font-medium">{versionInfo.env}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Domain:</span>{" "}
            <span className="font-medium">{versionInfo.domain}</span>
          </div>
        </div>
      </div>
    </section>
  );
}
