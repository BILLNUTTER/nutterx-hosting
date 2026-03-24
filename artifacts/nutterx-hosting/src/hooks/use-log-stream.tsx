import { useState, useEffect, useRef } from "react";
import { useGetAppLogs } from "@workspace/api-client-react";
import type { LogEntry } from "@workspace/api-client-react";

export function useLogStream(appId: string) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const seededRef = useRef(false);
  // sinceRef: ISO timestamp passed to SSE as ?since= so reconnects don't resend old history
  const sinceRef = useRef<string | null>(null);
  // Increment to force the SSE useEffect to reconnect with the latest sinceRef
  const [connectionKey, setConnectionKey] = useState(0);

  const { data: initialLogs } = useGetAppLogs(appId, { limit: 200 });

  // Seed with historical logs once on mount; record timestamp of last log for gap-fill
  useEffect(() => {
    if (initialLogs && !seededRef.current) {
      seededRef.current = true;
      setLogs(initialLogs);
      if (initialLogs.length > 0) {
        sinceRef.current = initialLogs[initialLogs.length - 1].timestamp;
      }
    }
  }, [initialLogs]);

  useEffect(() => {
    if (!appId) return;

    let destroyed = false;
    let source: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let retryCount = 0;

    const since = sinceRef.current;

    function buildUrl() {
      const token = localStorage.getItem("access_token") ?? "";
      const params = new URLSearchParams({ token });
      if (since) params.set("since", since);
      return `/api/apps/${appId}/logs/stream?${params.toString()}`;
    }

    function addLog(newLog: LogEntry) {
      setLogs((prev) => {
        // Deduplicate by timestamp+line (SSE logs have no id)
        if (prev.some((l) => l.timestamp === newLog.timestamp && l.line === newLog.line)) return prev;
        return [...prev, newLog];
      });
    }

    function connect() {
      if (destroyed) return;
      source = new EventSource(buildUrl());

      source.onmessage = (ev) => {
        try {
          addLog(JSON.parse(ev.data) as LogEntry);
        } catch {
          // ignore malformed events
        }
      };

      source.onerror = () => {
        source?.close();
        source = null;
        if (destroyed) return;
        // Back-off retry: 2s → 4s → 8s (cap at 30s, max 8 retries)
        if (retryCount >= 8) return;
        const delay = Math.min(2000 * Math.pow(2, retryCount), 30000);
        retryCount++;
        retryTimer = setTimeout(connect, delay);
      };
    }

    connect();

    return () => {
      destroyed = true;
      if (retryTimer) clearTimeout(retryTimer);
      source?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appId, connectionKey]);

  const clearLogs = () => {
    // Record NOW as the new "since" — SSE will reconnect and only deliver logs after this moment
    sinceRef.current = new Date().toISOString();
    setLogs([]);
    setConnectionKey((k) => k + 1);
  };

  return { logs, clearLogs };
}
