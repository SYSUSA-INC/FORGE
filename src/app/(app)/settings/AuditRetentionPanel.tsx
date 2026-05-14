"use client";

import { useState, useTransition } from "react";
import { Panel } from "@/components/ui/Panel";
import {
  AUDIT_RETENTION_MAX_DAYS,
  AUDIT_RETENTION_MIN_DAYS,
  setAuditRetentionDaysAction,
} from "./actions";

type Props = {
  initialDays: number;
  canEdit: boolean;
  className?: string;
};

export function AuditRetentionPanel({
  initialDays,
  canEdit,
  className,
}: Props) {
  const [days, setDays] = useState<number>(initialDays);
  const [savedDays, setSavedDays] = useState<number>(initialDays);
  const [status, setStatus] = useState<
    { kind: "idle" } | { kind: "ok" } | { kind: "err"; message: string }
  >({ kind: "idle" });
  const [pending, startTransition] = useTransition();

  const onSave = () => {
    setStatus({ kind: "idle" });
    startTransition(async () => {
      const res = await setAuditRetentionDaysAction(days);
      if (res.ok) {
        setSavedDays(days);
        setStatus({ kind: "ok" });
      } else {
        setStatus({ kind: "err", message: res.error });
      }
    });
  };

  return (
    <Panel title="Audit log retention" className={className}>
      <p className="mb-3 text-sm opacity-80">
        The audit log records every action your team takes in FORGE. A
        nightly job prunes rows older than your retention window.
        Defaults to 365 days; set {AUDIT_RETENTION_MIN_DAYS}–
        {AUDIT_RETENTION_MAX_DAYS} days based on your compliance needs.
      </p>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div>
          <label className="aur-label">Retention window (days)</label>
          <input
            className="aur-input"
            type="number"
            min={AUDIT_RETENTION_MIN_DAYS}
            max={AUDIT_RETENTION_MAX_DAYS}
            step={1}
            inputMode="numeric"
            value={days}
            onChange={(e) => {
              const n = Number(e.target.value);
              setDays(Number.isFinite(n) ? Math.round(n) : days);
            }}
            disabled={!canEdit || pending}
          />
        </div>
        {canEdit ? (
          <div className="flex items-end">
            <button
              type="button"
              onClick={onSave}
              disabled={pending || days === savedDays}
              className="aur-btn aur-btn-primary"
            >
              {pending ? "Saving…" : "Save"}
            </button>
          </div>
        ) : null}
      </div>
      {status.kind === "ok" ? (
        <div className="mt-2 font-mono text-[11px] opacity-70">
          Updated. The next prune runs tonight at 03:30 UTC.
        </div>
      ) : null}
      {status.kind === "err" ? (
        <div className="mt-2 font-mono text-[11px] text-rose">
          {status.message}
        </div>
      ) : null}
      {!canEdit ? (
        <div className="mt-2 font-mono text-[11px] opacity-70">
          Only org admins can change retention.
        </div>
      ) : null}
    </Panel>
  );
}
