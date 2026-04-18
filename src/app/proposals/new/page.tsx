"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Proposal } from "@/lib/mock";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import {
  proposalsStore,
  makeProposalCode,
  daysUntil,
} from "@/lib/proposalsStore";

export default function NewProposalPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    code: "",
    title: "",
    solicitation: "",
    agency: "",
    captureManager: "",
    proposalManager: "",
    dueAt: "",
    pagesLimit: 200,
  });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const suggestedCode = useMemo(() => makeProposalCode(), []);

  const update = (k: keyof typeof form) => (v: string | number) =>
    setForm((f) => ({ ...f, [k]: v }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) {
      setError("A title is required.");
      return;
    }
    setSubmitting(true);
    const code = form.code.trim() || suggestedCode;
    const proposal: Proposal = {
      id: code,
      code,
      title: form.title.trim(),
      solicitation: form.solicitation.trim(),
      agency: form.agency.trim(),
      status: "PLANNING",
      captureManager: form.captureManager.trim(),
      proposalManager: form.proposalManager.trim(),
      dueAt: form.dueAt,
      daysLeft: daysUntil(form.dueAt),
      progress: 0,
      aiPct: 0,
      pagesEstimated: 0,
      pagesLimit: Number(form.pagesLimit) || 200,
      compliancePct: 0,
    };
    proposalsStore.add(proposal);
    router.push("/proposals");
  };

  return (
    <>
      <PageHeader
        eyebrow="Proposals — Initiate"
        title="New proposal"
        subtitle="Create a proposal record. It will appear on the Kanban board and Proposal register; drag to change phase."
        actions={
          <Link href="/proposals" className="aur-btn">
            Cancel
          </Link>
        }
      />

      <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_1fr]">
        <Panel title="Proposal configuration">
          <div className="grid grid-cols-2 gap-3">
            <Field
              label="Proposal code"
              value={form.code}
              onChange={update("code")}
              placeholder={suggestedCode}
            />
            <Field
              label="Page limit"
              value={String(form.pagesLimit)}
              onChange={(v) => update("pagesLimit")(Number(v) || 0)}
              placeholder="200"
            />
            <Field
              label="Title"
              value={form.title}
              onChange={update("title")}
              placeholder="Short, memorable proposal name"
              full
              required
            />
            <Field
              label="Solicitation"
              value={form.solicitation}
              onChange={update("solicitation")}
              placeholder="SOL number (optional)"
            />
            <Field
              label="Agency"
              value={form.agency}
              onChange={update("agency")}
              placeholder="Dept. / bureau"
            />
            <Field
              label="Capture manager"
              value={form.captureManager}
              onChange={update("captureManager")}
              placeholder="Owner"
            />
            <Field
              label="Proposal manager"
              value={form.proposalManager}
              onChange={update("proposalManager")}
              placeholder="Owner"
            />
            <Field
              label="Due date"
              value={form.dueAt}
              onChange={update("dueAt")}
              placeholder="YYYY-MM-DD"
              type="date"
            />
          </div>

          {error ? (
            <div className="mt-3 rounded-md border border-rose/40 bg-rose/10 px-3 py-2 font-mono text-[11px] text-rose">
              {error}
            </div>
          ) : null}

          <div className="mt-5 flex items-center justify-end gap-2">
            <Link href="/proposals" className="aur-btn">
              Cancel
            </Link>
            <button
              type="submit"
              disabled={submitting}
              className="aur-btn-primary"
            >
              {submitting ? "Creating…" : "Create proposal"}
            </button>
          </div>
        </Panel>

        <Panel title="What happens next">
          <ol className="flex flex-col gap-3 pl-5 text-[13px] leading-relaxed text-muted">
            <li className="list-decimal">
              The proposal lands in the <span className="text-text">Planning</span> column of
              the Kanban board.
            </li>
            <li className="list-decimal">
              Drag it across columns to advance it through the 10 phases (Planning →
              Submitted).
            </li>
            <li className="list-decimal">
              Every move is recorded for the intelligence layer to learn win / loss
              patterns by phase duration and progression.
            </li>
            <li className="list-decimal">
              Open the proposal to draft sections, run compliance, and kick off review
              cycles.
            </li>
          </ol>
          <div className="mt-4 rounded-md border border-dashed border-white/10 px-3 py-2 font-mono text-[11px] text-subtle">
            Stored locally in your browser. Backend persistence ships with the Postgres
            migration.
          </div>
        </Panel>
      </form>
    </>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  full,
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  full?: boolean;
  required?: boolean;
}) {
  return (
    <label className={full ? "col-span-2" : ""}>
      <div className="aur-label">
        {label}
        {required ? <span className="text-rose"> *</span> : null}
      </div>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="aur-input"
      />
    </label>
  );
}
