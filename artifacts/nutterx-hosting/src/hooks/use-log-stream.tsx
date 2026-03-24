import { useState, useEffect, useRef } from "react";
import { fetchEventSource } from "@microsoft/fetch-event-source";
import { useGetAppLogs } from "@workspace/api-client-react";
import type { LogEntry } from "@workspace/api-client-react";

export function useLogStream(appId: string) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const { data: initialLogs } = useGetAppLogs(appId, { limit: 200 });

  // Initialize with fetched history
  useEffect(() => {
    if (initialLogs && logs.length === 0) {
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
            retryCount = 0; // reset
          } else if (res.status >= 400 && res.status < 500 && res.status !== 429) {
            // client error, don't retry
            throw new Error(`Fatal error: ${res.status}`);
          }
        },
        onmessage(ev) {
          try {
            const newLog = JSON.parse(ev.data) as LogEntry;
            setLogs((prev) => {
              // Ensure uniqueness if same event fires
              if (prev.some((l) => l.id === newLog.id)) return prev;
              return [...prev, newLog];
            });
          } catch (e) {
            console.error("Failed to parse SSE event", e);
          }
        },
        onerror(err) {
          if (retryCount >= 5) {
            throw err; // Stop retrying after 5 attempts
          }
          retryCount++;
          return 3000; // Retry after 3 seconds
        }
      });
    }

    connect();

    return () => {
      ctrl.abort();
    };
  }, [appId]);

  const clearLogs = () => setLogs([]);

  return { logs, clearLogs };
}
