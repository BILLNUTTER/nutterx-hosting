import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, X, CheckCircle2, CreditCard } from "lucide-react";

interface PaymentModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  title?: string;
}

type Stage = "initiating" | "paying" | "polling" | "success" | "error";

export function PaymentModal({ open, onClose, onSuccess, title }: PaymentModalProps) {
  const [stage, setStage] = useState<Stage>("initiating");
  const [errorMsg, setErrorMsg] = useState("");
  const [redirectUrl, setRedirectUrl] = useState("");
  const [trackingId, setTrackingId] = useState("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const initiated = useRef(false);

  const getToken = () => localStorage.getItem("access_token") ?? "";

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const startPolling = useCallback((tid: string) => {
    stopPolling();
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/billing/check/${encodeURIComponent(tid)}`, {
          headers: { Authorization: `Bearer ${getToken()}` },
        });
        if (!res.ok) return;
        const data = await res.json() as { status: string };
        if (data.status === "completed") {
          stopPolling();
          setStage("success");
          setTimeout(() => {
            onSuccess();
            onClose();
          }, 1800);
        } else if (data.status === "failed" || data.status === "invalid") {
          stopPolling();
          setErrorMsg("Payment was not completed. Please try again.");
          setStage("error");
        }
      } catch {}
    }, 3000);
  }, [onClose, onSuccess]);

  useEffect(() => {
    if (!open) {
      stopPolling();
      initiated.current = false;
      setStage("initiating");
      setRedirectUrl("");
      setTrackingId("");
      setErrorMsg("");
      return;
    }

    if (initiated.current) return;
    initiated.current = true;

    (async () => {
      try {
        const res = await fetch("/api/billing/initiate", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${getToken()}`,
          },
          body: JSON.stringify({}),
        });
        const data = await res.json() as {
          redirectUrl?: string;
          orderTrackingId?: string;
          error?: string;
        };
        if (!res.ok || !data.redirectUrl) {
          throw new Error(data.error ?? "Failed to initiate payment");
        }
        setRedirectUrl(data.redirectUrl);
        setTrackingId(data.orderTrackingId ?? "");
        setStage("paying");
        startPolling(data.orderTrackingId ?? "");
      } catch (err: any) {
        setErrorMsg(err.message ?? "Payment initiation failed");
        setStage("error");
      }
    })();

    return () => stopPolling();
  }, [open, startPolling]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-card border border-border rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-muted/20">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center">
              <CreditCard className="w-4 h-4 text-primary" />
            </div>
            <div>
              <p className="font-semibold text-sm">{title ?? "Complete Payment"}</p>
              <p className="text-xs text-muted-foreground">KSH 150 · 1 Month Subscription</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 text-muted-foreground transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-[440px] flex items-center justify-center">
          {stage === "initiating" && (
            <div className="text-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">Preparing your payment…</p>
            </div>
          )}

          {stage === "paying" && redirectUrl && (
            <div className="w-full h-[440px] relative">
              <iframe
                src={redirectUrl}
                className="w-full h-full border-0"
                title="PesaPal Payment"
                allow="payment"
              />
              <div className="absolute bottom-0 left-0 right-0 bg-card/80 backdrop-blur-sm border-t border-border px-4 py-2 flex items-center gap-2">
                <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Waiting for payment confirmation…</span>
              </div>
            </div>
          )}

          {stage === "polling" && (
            <div className="text-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto mb-3" />
              <p className="text-sm font-medium">Confirming your payment…</p>
              <p className="text-xs text-muted-foreground mt-1">This may take a few seconds.</p>
            </div>
          )}

          {stage === "success" && (
            <div className="text-center py-12">
              <div className="w-14 h-14 rounded-full bg-green-500/15 border border-green-500/30 flex items-center justify-center mx-auto mb-4">
                <CheckCircle2 className="w-7 h-7 text-green-500" />
              </div>
              <p className="font-semibold text-base">Payment successful!</p>
              <p className="text-sm text-muted-foreground mt-1">Your subscription is now active for 30 days.</p>
            </div>
          )}

          {stage === "error" && (
            <div className="text-center py-12 px-6">
              <p className="text-destructive font-medium mb-2">Payment failed</p>
              <p className="text-sm text-muted-foreground mb-5">{errorMsg}</p>
              <Button variant="outline" onClick={onClose}>Close</Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
