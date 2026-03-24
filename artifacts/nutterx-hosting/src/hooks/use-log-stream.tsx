import { useState, useEffect, useRef } from "react";
import { fetchEventSource } from "@microsoft/fetch-event-source";
import { useGetAppLogs } from "@workspace/api-client-react";
import type { LogEntry } from "@workspace/api-client-react";

export function useLogStream(appId: string) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  // Track whether the user manually cleared so we don't re-seed from cache
  const clearedRef = useRef(false);
  const seededRef = useRef(false);

  const { data: initialLogs } = useGetAppLogs(appId, { limit: 200 });

  // Seed with historical logs once on mount (not after manual clear)
  useEffect(() => {
    if (initialLogs && !seededRef.current && !clearedRef.current) {
      seededRef.current = true;
      setLogs(initialLogs);
    }
  }, [initialLogs]);

  useEffect(() => {
    if (!appId) return;

    let retryCount = 0;
    const ctrl = new AbortController();
    const token = localStorage.getItem("access_token");

    function connect() {
      fetchEventSource(`/api/apps/${appId}/logs/stream`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        signal: ctrl.signal,
        async onopen(res) {
          if (res.ok && res.status === 200) {
            retryCount = 0;
          } else if (res.status >= 400 && res.status < 500 && res.status !== 429) {
            throw new Error(`Fatal error: ${res.status}`);
          }
        },
        onmessage(ev) {
          try {
            const newLog = JSON.parse(ev.data) as LogEntry;
            setLogs((prev) => {
              if (prev.some((l) => l.id === newLog.id)) return prev;
              return [...prev, newLog];
            });
          } catch (e) {
            console.error("Failed to parse SSE event", e);
          }
        },
        onerror(err) {
          if (retryCount >= 5) {
            throw err;
          }
          retryCount++;
          return 3000;
        }
      });
    }

    connect();

    return () => {
      ctrl.abort();
    };
  }, [appId]);

  const clearLogs = () => {
    clearedRef.current = true;
    setLogs([]);
  };

  return { logs, clearLogs };
}
