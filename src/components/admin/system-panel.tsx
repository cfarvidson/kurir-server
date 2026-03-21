"use client";

import { useEffect, useState } from "react";
import {
  Activity,
  Database,
  HardDrive,
  RefreshCw,
  Server,
  Wifi,
  WifiOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";

interface HealthData {
  status: string;
  uptime: number;
  sync: { active: number; waiting: number; delayed: number; failed: number };
  maintenance: {
    active: number;
    waiting: number;
    delayed: number;
    failed: number;
  };
  connections: { idle: number; cap: number };
  memory: { heapUsed: string; heapTotal: string; rss: string };
  redis: { connected: boolean };
}

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function SystemPanel() {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchHealth = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/health");
      if (!res.ok) throw new Error("Failed to fetch health");
      setHealth(await res.json());
      setError(null);
    } catch {
      setError("Failed to load system status");
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
        <h2 className="text-lg font-medium">System</h2>
        <div className="mt-4 rounded-lg border bg-card p-4 text-sm text-muted-foreground">
          Loading...
        </div>
      </section>
    );
  }

  if (error && !health) {
    return (
      <section>
        <h2 className="text-lg font-medium">System</h2>
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
        <h2 className="text-lg font-medium">System</h2>
        <Button
          variant="ghost"
          size="sm"
          onClick={fetchHealth}
          disabled={loading}
        >
          <RefreshCw
            className={`h-4 w-4 ${loading ? "animate-spin" : ""}`}
          />
        </Button>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
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

        {/* IDLE Connections */}
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Server className="h-4 w-4 text-muted-foreground" />
            IDLE Connections
          </div>
          <div className="mt-2">
            <p className="text-2xl font-semibold">
              {health.connections.idle}
              <span className="text-sm text-muted-foreground font-normal">
                {" "}
                / {health.connections.cap}
              </span>
            </p>
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
          <div className="mt-2">
            <p
              className={`text-sm font-medium ${health.redis.connected ? "text-green-600" : "text-destructive"}`}
            >
              {health.redis.connected ? "Connected" : "Disconnected"}
            </p>
          </div>
        </div>

        {/* Uptime */}
        <div className="rounded-lg border bg-card p-4 sm:col-span-2">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Database className="h-4 w-4 text-muted-foreground" />
            Server
          </div>
          <div className="mt-2 text-xs">
            <span className="text-muted-foreground">Uptime:</span>{" "}
            <span className="font-medium">{formatUptime(health.uptime)}</span>
          </div>
        </div>
      </div>
    </section>
  );
}
