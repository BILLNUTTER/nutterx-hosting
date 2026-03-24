import { useState, useEffect, useRef } from "react";
import { fetchEventSource } from "@microsoft/fetch-event-source";
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

    let retryCount = 0;
    const ctrl = new AbortController();
    const token = localStorage.getItem("access_token");
    const since = sinceRef.current;
    const url = `/api/apps/${appId}/logs/stream${since ? `?since=${encodeURIComponent(since)}` : ""}`;

    function connect() {
      fetchEventSource(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        signal: ctrl.signal,
        async onopen(res) {
          if (res.ok && res.status === 200) {
            retryCount = 0;
          } else if (res.status === 401) {
            // Auth error — stop retrying silently; auth hook handles redirect
            ctrl.abort();
          } else if (res.status >= 400 && res.status < 500 && res.status !== 429) {
            throw new Error(`Fatal SSE error: ${res.status}`);
          }
        },
        onmessage(ev) {
          try {
            const newLog = JSON.parse(ev.data) as LogEntry;
            setLogs((prev) => {
              // Deduplicate: SSE logs have no id so match on timestamp+line
              if (prev.some((l) => l.timestamp === newLog.timestamp && l.line === newLog.line)) return prev;
              return [...prev, newLog];
            });
          } catch {
            // ignore parse errors (ping comments etc.)
          }
        },
        onerror(err) {
          if (ctrl.signal.aborted) throw err; // don't retry if we aborted
          if (retryCount >= 5) throw err;
          retryCount++;
          return 3000;
        },
      }).catch(() => {
        // Swallow — auth errors and abort are handled above
      });
    }

    connect();

    return () => {
      ctrl.abort();
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
