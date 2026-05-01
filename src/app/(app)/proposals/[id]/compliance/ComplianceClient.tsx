"use client";

import { FormEvent, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Panel } from "@/components/ui/Panel";
import type {
  ComplianceCategory,
  ComplianceStatus,
} from "@/db/schema";
import {
  acceptComplianceAIAssessmentAction,
  bulkImportComplianceItemsAction,
  createComplianceItemAction,
  deleteComplianceItemAction,
  dismissComplianceAIAssessmentAction,
  runCompliancePreflightAction,
  updateComplianceItemAction,
} from "./actions";

type CategoryDef = {
  key: ComplianceCategory;
  label: string;
  color: string;
  description: string;
};
type StatusDef = { key: ComplianceStatus; label: string; color: string };
type SectionLite = { id: string; title: string; ordering: number };
type TeamMember = { id: string; name: string | null; email: string };

type AIAssessment = {
  suggestedStatus: ComplianceStatus;
  confidence: "high" | "medium" | "low";
  gap: string;
  suggestion: string;
  model: string;
} | null;

type ItemRow = {
  id: string;
  category: ComplianceCategory;
  number: string;
  requirementText: string;
  volume: string;
  rfpPageReference: string;
  proposalSectionId: string | null;
  proposalPageReference: string;
  status: ComplianceStatus;
  notes: string;
  ownerUserId: string | null;
  ownerName: string | null;
  ownerEmail: string | null;
  sectionTitle: string | null;
  sectionOrdering: number | null;
  aiAssessment: AIAssessment;
  aiAssessedAt: string | null;
};

export function ComplianceClient({
  proposalId,
  categories,
  statuses,
  categoryLabels,
  categoryColors,
  statusLabels,
  statusColors,
  sections,
  team,
  byCategory,
  items,
}: {
  proposalId: string;
  categories: CategoryDef[];
  statuses: StatusDef[];
  categoryLabels: Record<ComplianceCategory, string>;
  categoryColors: Record<ComplianceCategory, string>;
  statusLabels: Record<ComplianceStatus, string>;
  statusColors: Record<ComplianceStatus, string>;
  sections: SectionLite[];
  team: TeamMember[];
  byCategory: Record<string, number>;
  items: ItemRow[];
}) {
  const [catFilter, setCatFilter] = useState<ComplianceCategory | "all">("all");
  const [statusFilter, setStatusFilter] = useState<ComplianceStatus | "all">(
    "all",
  );
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((i) => {
      if (catFilter !== "all" && i.category !== catFilter) return false;
      if (statusFilter !== "all" && i.status !== statusFilter) return false;
      if (!q) return true;
      return (
        i.number.toLowerCase().includes(q) ||
        i.requirementText.toLowerCase().includes(q) ||
        (i.sectionTitle ?? "").toLowerCase().includes(q) ||
        (i.notes ?? "").toLowerCase().includes(q)
      );
    });
  }, [items, catFilter, statusFilter, search]);

  return (
    <div className="flex flex-col gap-4">
      <PreflightBar
        proposalId={proposalId}
        items={items}
      />
      <BulkImport proposalId={proposalId} categories={categories} />
      <AddItem
        proposalId={proposalId}
        categories={categories}
        statuses={statuses}
        sections={sections}
        team={team}
      />

      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => setCatFilter("all")}
          className={`rounded-md border px-3 py-1 font-mono text-[11px] uppercase tracking-[0.2em] transition-colors ${
            catFilter === "all"
              ? "border-teal-400 bg-teal-400/10 text-text"
              : "border-white/10 bg-white/[0.02] text-muted hover:border-white/20"
          }`}
        >
          All {items.length}
        </button>
        {categories.map((c) => {
          const n = byCategory[c.key] ?? 0;
          if (n === 0 && catFilter !== c.key) return null;
          const active = catFilter === c.key;
          return (
            <button
              key={c.key}
              onClick={() => setCatFilter(c.key)}
              className={`flex items-center gap-2 rounded-md border px-3 py-1 font-mono text-[11px] uppercase tracking-[0.2em] transition-colors ${
                active
                  ? "border-teal-400 bg-teal-400/10 text-text"
                  : "border-white/10 bg-white/[0.02] text-muted hover:border-white/20"
              }`}
            >
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: c.color }}
              />
              {c.label} · {n}
            </button>
          );
        })}
        <select
          className="aur-input ml-auto w-44 text-[12px]"
          value={statusFilter}
          onChange={(e) =>
            setStatusFilter(e.target.value as ComplianceStatus | "all")
          }
        >
          <option value="all">All statuses</option>
          {statuses.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
        <input
          className="aur-input w-60 text-[12px]"
          placeholder="Search requirement…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <Panel title="Compliance items" eyebrow={`${filtered.length} of ${items.length}`}>
        {filtered.length === 0 ? (
          <div className="font-mono text-[11px] text-muted">
            No items match the current filters.
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {filtered.map((i) => (
              <ItemRowCard
                key={i.id}
                proposalId={proposalId}
                item={i}
                categories={categories}
                statuses={statuses}
                categoryLabels={categoryLabels}
                categoryColors={categoryColors}
                statusLabels={statusLabels}
                statusColors={statusColors}
                sections={sections}
                team={team}
              />
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

function AddItem({
  proposalId,
  categories,
  statuses,
  sections,
  team,
}: {
  proposalId: string;
  categories: CategoryDef[];
  statuses: StatusDef[];
  sections: SectionLite[];
  team: TeamMember[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [category, setCategory] = useState<ComplianceCategory>("section_l");
  const [number, setNumber] = useState("");
  const [requirementText, setRequirementText] = useState("");
  const [volume, setVolume] = useState("");
  const [rfpPageReference, setRfpPageReference] = useState("");
  const [proposalSectionId, setProposalSectionId] = useState<string>("");
  const [proposalPageReference, setProposalPageReference] = useState("");
  const [status, setStatus] = useState<ComplianceStatus>("not_addressed");
  const [notes, setNotes] = useState("");
  const [ownerUserId, setOwnerUserId] = useState<string>("");

  function reset() {
    setNumber("");
    setRequirementText("");
    setVolume("");
    setRfpPageReference("");
    setProposalSectionId("");
    setProposalPageReference("");
    setStatus("not_addressed");
    setNotes("");
    setOwnerUserId("");
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await createComplianceItemAction(proposalId, {
        category,
        number,
        requirementText,
        volume,
        rfpPageReference,
        proposalSectionId: proposalSectionId || null,
        proposalPageReference,
        status,
        notes,
        ownerUserId: ownerUserId || null,
      });
      if (!res.ok) return setError(res.error);
      reset();
      router.refresh();
    });
  }

  if (!open) {
    return (
      <div>
        <button
          type="button"
          className="aur-btn aur-btn-primary py-2 text-[12px]"
          onClick={() => setOpen(true)}
        >
          + Add compliance item
        </button>
      </div>
    );
  }

  return (
    <Panel title="New compliance item">
      <form className="grid grid-cols-1 gap-3 md:grid-cols-2" onSubmit={onSubmit}>
        <div>
          <label className="aur-label">Category</label>
          <select
            className="aur-input"
            value={category}
            onChange={(e) => setCategory(e.target.value as ComplianceCategory)}
          >
            {categories.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label} — {c.description}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="aur-label">RFP reference number</label>
          <input
            className="aur-input"
            value={number}
            onChange={(e) => setNumber(e.target.value)}
            placeholder="L.3.2"
          />
        </div>
        <div className="md:col-span-2">
          <label className="aur-label">Requirement text</label>
          <textarea
            className="aur-input min-h-[80px] resize-y"
            value={requirementText}
            onChange={(e) => setRequirementText(e.target.value)}
            placeholder="The contractor shall…"
            required
          />
        </div>
        <div>
          <label className="aur-label">Volume</label>
          <input
            className="aur-input"
            value={volume}
            onChange={(e) => setVolume(e.target.value)}
            placeholder="Vol I · Technical"
          />
        </div>
        <div>
          <label className="aur-label">RFP page reference</label>
          <input
            className="aur-input"
            value={rfpPageReference}
            onChange={(e) => setRfpPageReference(e.target.value)}
            placeholder="p. 42"
          />
        </div>
        <div>
          <label className="aur-label">Addressed in section</label>
          <select
            className="aur-input"
            value={proposalSectionId}
            onChange={(e) => setProposalSectionId(e.target.value)}
          >
            <option value="">—</option>
            {sections.map((s) => (
              <option key={s.id} value={s.id}>
                {s.ordering}. {s.title}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="aur-label">Proposal page reference</label>
          <input
            className="aur-input"
            value={proposalPageReference}
            onChange={(e) => setProposalPageReference(e.target.value)}
            placeholder="§3.1 / p. 15"
          />
        </div>
        <div>
          <label className="aur-label">Status</label>
          <select
            className="aur-input"
            value={status}
            onChange={(e) => setStatus(e.target.value as ComplianceStatus)}
          >
            {statuses.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="aur-label">Owner</label>
          <select
            className="aur-input"
            value={ownerUserId}
            onChange={(e) => setOwnerUserId(e.target.value)}
          >
            <option value="">—</option>
            {team.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name ?? m.email}
              </option>
            ))}
          </select>
        </div>
        <div className="md:col-span-2">
          <label className="aur-label">Notes</label>
          <textarea
            className="aur-input min-h-[60px] resize-y"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>

        {error ? (
          <div className="md:col-span-2 rounded-md border border-rose/40 bg-rose/10 px-3 py-2 font-mono text-[11px] text-rose">
            {error}
          </div>
        ) : null}

        <div className="md:col-span-2 flex gap-2">
          <button
            type="submit"
            className="aur-btn aur-btn-primary text-[12px] disabled:opacity-60"
            disabled={pending || !requirementText.trim()}
          >
            {pending ? "Adding…" : "Add item"}
          </button>
          <button
            type="button"
            className="aur-btn aur-btn-ghost text-[12px]"
            onClick={() => {
              setOpen(false);
              reset();
            }}
          >
            Cancel
          </button>
        </div>
      </form>
    </Panel>
  );
}

function BulkImport({
  proposalId,
  categories,
}: {
  proposalId: string;
  categories: CategoryDef[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<ComplianceCategory>("section_l");
  const [text, setText] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const lines = text
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
      const res = await bulkImportComplianceItemsAction(proposalId, {
        category,
        lines,
      });
      if (!res.ok) return setError(res.error);
      setNotice(`Imported ${res.imported} item${res.imported === 1 ? "" : "s"}.`);
      setText("");
      router.refresh();
    });
  }

  if (!open) {
    return (
      <div>
        <button
          type="button"
          className="aur-btn aur-btn-ghost py-2 text-[12px]"
          onClick={() => setOpen(true)}
        >
          Bulk paste shall statements
        </button>
      </div>
    );
  }

  return (
    <Panel title="Bulk paste" eyebrow="One shall statement per line">
      <form className="flex flex-col gap-3" onSubmit={onSubmit}>
        <div>
          <label className="aur-label">Category for all pasted items</label>
          <select
            className="aur-input md:w-64"
            value={category}
            onChange={(e) => setCategory(e.target.value as ComplianceCategory)}
          >
            {categories.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="aur-label">Paste shall statements</label>
          <textarea
            className="aur-input min-h-[160px] resize-y font-mono text-[12px]"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={`L.3.1 The contractor shall provide a staffing plan.\nL.3.2 The offeror shall identify key personnel.`}
          />
          <div className="mt-1 font-mono text-[10px] text-muted">
            Best-effort parse: first token (e.g., <code>L.3.1</code>) becomes
            the RFP number; the rest is the requirement text. You can clean up
            individual rows afterwards.
          </div>
        </div>
        {error ? (
          <div className="rounded-md border border-rose/40 bg-rose/10 px-3 py-2 font-mono text-[11px] text-rose">
            {error}
          </div>
        ) : null}
        {notice ? (
          <div className="rounded-md border border-emerald/40 bg-emerald/10 px-3 py-2 font-mono text-[11px] text-emerald">
            {notice}
          </div>
        ) : null}
        <div className="flex gap-2">
          <button
            type="submit"
            className="aur-btn aur-btn-primary text-[12px] disabled:opacity-60"
            disabled={pending || !text.trim()}
          >
            {pending ? "Importing…" : "Import"}
          </button>
          <button
            type="button"
            className="aur-btn aur-btn-ghost text-[12px]"
            onClick={() => {
              setOpen(false);
              setText("");
            }}
          >
            Close
          </button>
        </div>
      </form>
    </Panel>
  );
}

function ItemRowCard({
  proposalId,
  item,
  categories,
  statuses,
  categoryLabels,
  categoryColors,
  statusLabels,
  statusColors,
  sections,
  team,
}: {
  proposalId: string;
  item: ItemRow;
  categories: CategoryDef[];
  statuses: StatusDef[];
  categoryLabels: Record<ComplianceCategory, string>;
  categoryColors: Record<ComplianceCategory, string>;
  statusLabels: Record<ComplianceStatus, string>;
  statusColors: Record<ComplianceStatus, string>;
  sections: SectionLite[];
  team: TeamMember[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [number, setNumber] = useState(item.number);
  const [category, setCategory] = useState(item.category);
  const [requirementText, setRequirementText] = useState(item.requirementText);
  const [volume, setVolume] = useState(item.volume);
  const [rfpPageReference, setRfpPageReference] = useState(item.rfpPageReference);
  const [proposalSectionId, setProposalSectionId] = useState(
    item.proposalSectionId ?? "",
  );
  const [proposalPageReference, setProposalPageReference] = useState(
    item.proposalPageReference,
  );
  const [status, setStatus] = useState(item.status);
  const [notes, setNotes] = useState(item.notes);
  const [ownerUserId, setOwnerUserId] = useState(item.ownerUserId ?? "");

  function save() {
    setError(null);
    startTransition(async () => {
      const res = await updateComplianceItemAction(proposalId, item.id, {
        category,
        number,
        requirementText,
        volume,
        rfpPageReference,
        proposalSectionId: proposalSectionId || null,
        proposalPageReference,
        status,
        notes,
        ownerUserId: ownerUserId || null,
      });
      if (!res.ok) return setError(res.error);
      setEditing(false);
      router.refresh();
    });
  }

  function remove() {
    if (!window.confirm("Delete this compliance item?")) return;
    setError(null);
    startTransition(async () => {
      const res = await deleteComplianceItemAction(proposalId, item.id);
      if (!res.ok) return setError(res.error);
      router.refresh();
    });
  }

  function quickStatus(next: ComplianceStatus) {
    setError(null);
    startTransition(async () => {
      const res = await updateComplianceItemAction(proposalId, item.id, {
        status: next,
      });
      if (!res.ok) return setError(res.error);
      router.refresh();
    });
  }

  if (!editing) {
    const catColor = categoryColors[item.category];
    const stColor = statusColors[item.status];
    return (
      <li className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[auto_1fr_auto]">
          <div className="flex flex-col gap-1 md:w-32">
            <span
              className="rounded-md px-2 py-0.5 text-center font-mono text-[10px] uppercase tracking-[0.22em]"
              style={{
                color: catColor,
                backgroundColor: `${catColor}1A`,
                border: `1px solid ${catColor}40`,
              }}
            >
              {categoryLabels[item.category]}
            </span>
            {item.number ? (
              <span className="text-center font-mono text-[12px] font-semibold text-text">
                {item.number}
              </span>
            ) : null}
          </div>

          <div className="min-w-0">
            <div className="whitespace-pre-wrap font-body text-[13px] text-text">
              {item.requirementText}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] text-muted">
              {item.volume ? <span>Vol: {item.volume}</span> : null}
              {item.rfpPageReference ? (
                <span>RFP {item.rfpPageReference}</span>
              ) : null}
              {item.sectionTitle ? (
                <span>
                  §{item.sectionOrdering ?? "?"} {item.sectionTitle}
                </span>
              ) : null}
              {item.proposalPageReference ? (
                <span>Our {item.proposalPageReference}</span>
              ) : null}
              {item.ownerName || item.ownerEmail ? (
                <span>Owner: {item.ownerName ?? item.ownerEmail}</span>
              ) : null}
            </div>
            {item.notes ? (
              <div className="mt-1 whitespace-pre-wrap font-mono text-[11px] text-muted">
                {item.notes}
              </div>
            ) : null}
            {item.aiAssessment ? (
              <AIAssessmentRow
                proposalId={proposalId}
                itemId={item.id}
                assessment={item.aiAssessment}
                statusLabels={statusLabels}
                statusColors={statusColors}
              />
            ) : null}
          </div>

          <div className="flex flex-col items-end gap-2">
            <span
              className="rounded px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest"
              style={{
                color: stColor,
                backgroundColor: `${stColor}1A`,
                border: `1px solid ${stColor}40`,
              }}
            >
              {statusLabels[item.status]}
            </span>
            <div className="flex flex-wrap justify-end gap-1">
              {statuses.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  className="rounded border border-white/10 bg-white/[0.03] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest text-muted transition-colors hover:border-white/30 hover:text-text"
                  disabled={pending || s.key === item.status}
                  onClick={() => quickStatus(s.key)}
                  style={
                    s.key === item.status
                      ? {
                          color: s.color,
                          borderColor: `${s.color}60`,
                          backgroundColor: `${s.color}1A`,
                        }
                      : undefined
                  }
                >
                  {s.label}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                className="aur-btn aur-btn-ghost text-[10px]"
                onClick={() => setEditing(true)}
              >
                Edit
              </button>
              <button
                type="button"
                className="aur-btn aur-btn-danger text-[10px]"
                onClick={remove}
                disabled={pending}
              >
                Delete
              </button>
            </div>
          </div>
        </div>

        {error ? (
          <div className="mt-2 rounded-md border border-rose/40 bg-rose/10 px-3 py-2 font-mono text-[11px] text-rose">
            {error}
          </div>
        ) : null}
      </li>
    );
  }

  return (
    <li className="rounded-lg border border-teal-400/40 bg-white/[0.02] p-3">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div>
          <label className="aur-label">Category</label>
          <select
            className="aur-input"
            value={category}
            onChange={(e) => setCategory(e.target.value as ComplianceCategory)}
          >
            {categories.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="aur-label">RFP number</label>
          <input
            className="aur-input"
            value={number}
            onChange={(e) => setNumber(e.target.value)}
          />
        </div>
        <div className="md:col-span-2">
          <label className="aur-label">Requirement text</label>
          <textarea
            className="aur-input min-h-[80px] resize-y"
            value={requirementText}
            onChange={(e) => setRequirementText(e.target.value)}
          />
        </div>
        <div>
          <label className="aur-label">Volume</label>
          <input
            className="aur-input"
            value={volume}
            onChange={(e) => setVolume(e.target.value)}
          />
        </div>
        <div>
          <label className="aur-label">RFP page</label>
          <input
            className="aur-input"
            value={rfpPageReference}
            onChange={(e) => setRfpPageReference(e.target.value)}
          />
        </div>
        <div>
          <label className="aur-label">Addressed in section</label>
          <select
            className="aur-input"
            value={proposalSectionId}
            onChange={(e) => setProposalSectionId(e.target.value)}
          >
            <option value="">—</option>
            {sections.map((s) => (
              <option key={s.id} value={s.id}>
                {s.ordering}. {s.title}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="aur-label">Proposal page</label>
          <input
            className="aur-input"
            value={proposalPageReference}
            onChange={(e) => setProposalPageReference(e.target.value)}
          />
        </div>
        <div>
          <label className="aur-label">Status</label>
          <select
            className="aur-input"
            value={status}
            onChange={(e) => setStatus(e.target.value as ComplianceStatus)}
          >
            {statuses.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="aur-label">Owner</label>
          <select
            className="aur-input"
            value={ownerUserId}
            onChange={(e) => setOwnerUserId(e.target.value)}
          >
            <option value="">—</option>
            {team.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name ?? m.email}
              </option>
            ))}
          </select>
        </div>
        <div className="md:col-span-2">
          <label className="aur-label">Notes</label>
          <textarea
            className="aur-input min-h-[60px] resize-y"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
      </div>
      {error ? (
        <div className="mt-2 rounded-md border border-rose/40 bg-rose/10 px-3 py-2 font-mono text-[11px] text-rose">
          {error}
        </div>
      ) : null}
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          className="aur-btn aur-btn-primary text-[12px]"
          disabled={pending}
          onClick={save}
        >
          {pending ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          className="aur-btn aur-btn-ghost text-[12px]"
          onClick={() => setEditing(false)}
        >
          Cancel
        </button>
      </div>
    </li>
  );
}

// ─────────────────────────────────────────────────────────────────
// Phase 14c — pre-flight bar + per-row AI chip
// ─────────────────────────────────────────────────────────────────

function PreflightBar({
  proposalId,
  items,
}: {
  proposalId: string;
  items: ItemRow[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const mapped = items.filter((i) => !!i.proposalSectionId).length;
  const unmapped = items.length - mapped;
  const assessed = items.filter((i) => !!i.aiAssessment).length;

  function runPreflight() {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await runCompliancePreflightAction(proposalId);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      const stubNote = res.stubbed ? " (stub mode)" : "";
      const unmappedNote =
        res.unmapped > 0
          ? ` ${res.unmapped} item${res.unmapped === 1 ? "" : "s"} skipped (no section mapped).`
          : "";
      setNotice(
        `Pre-flight complete. Assessed ${res.assessed} item${res.assessed === 1 ? "" : "s"}.${unmappedNote}${stubNote}`,
      );
      router.refresh();
    });
  }

  return (
    <Panel
      title="Pre-flight (Phase 14c)"
      eyebrow="AI scans your draft against each requirement"
      actions={
        <button
          type="button"
          onClick={runPreflight}
          disabled={pending || mapped === 0}
          className="aur-btn aur-btn-primary text-[11px] disabled:opacity-60"
          title={
            mapped === 0
              ? "Map at least one compliance item to a section first."
              : "Run the AI pre-flight against every mapped item."
          }
        >
          {pending ? "Scanning…" : "Run pre-flight"}
        </button>
      }
    >
      <p className="font-body text-[13px] leading-relaxed text-muted">
        For each item that&apos;s mapped to a section, the AI reads the
        section&apos;s draft and judges whether it actually addresses the
        requirement. Verdicts appear inline on each row with a one-click
        Accept. Items without a mapped section are skipped — map them
        first, then re-run.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3 font-mono text-[11px]">
        <span className="text-muted">
          Mapped <span className="text-foreground">{mapped}</span>
        </span>
        <span className="text-muted">
          Unmapped <span className="text-amber-200">{unmapped}</span>
        </span>
        <span className="text-muted">
          Pre-flight verdicts pending review{" "}
          <span className="text-teal-300">{assessed}</span>
        </span>
      </div>
      {error ? (
        <div className="mt-3 rounded-md border border-rose/40 bg-rose/10 px-3 py-2 font-mono text-[11px] text-rose">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="mt-3 rounded-md border border-emerald-400/40 bg-emerald-400/10 px-3 py-2 font-mono text-[11px] text-emerald">
          {notice}
        </div>
      ) : null}
    </Panel>
  );
}

const CONFIDENCE_TONES = {
  high: "bg-emerald-400/10 text-emerald-300 border-emerald-400/30",
  medium: "bg-amber-400/10 text-amber-200 border-amber-400/30",
  low: "bg-white/5 text-muted border-white/10",
} as const;

function AIAssessmentRow({
  proposalId,
  itemId,
  assessment,
  statusLabels,
  statusColors,
}: {
  proposalId: string;
  itemId: string;
  assessment: NonNullable<ItemRow["aiAssessment"]>;
  statusLabels: Record<ComplianceStatus, string>;
  statusColors: Record<ComplianceStatus, string>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const sColor = statusColors[assessment.suggestedStatus];

  function accept() {
    setError(null);
    startTransition(async () => {
      const res = await acceptComplianceAIAssessmentAction(proposalId, itemId);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  function dismiss() {
    setError(null);
    startTransition(async () => {
      const res = await dismissComplianceAIAssessmentAction(
        proposalId,
        itemId,
      );
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="mt-2 rounded-md border border-teal-400/30 bg-teal-400/[0.04] px-3 py-2">
      <div className="flex flex-wrap items-center gap-2 font-mono text-[10px] uppercase tracking-widest">
        <span className="text-teal-300">Pre-flight</span>
        <span
          className="rounded px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest"
          style={{
            color: sColor,
            backgroundColor: `${sColor}1A`,
            border: `1px solid ${sColor}40`,
          }}
        >
          {statusLabels[assessment.suggestedStatus]}
        </span>
        <span
          className={`rounded border px-1.5 py-0.5 font-mono text-[9px] ${CONFIDENCE_TONES[assessment.confidence]}`}
        >
          {assessment.confidence} confidence
        </span>
      </div>
      {assessment.gap ? (
        <div className="mt-1 font-body text-[12px] leading-relaxed text-foreground">
          <span className="font-mono text-[10px] uppercase tracking-wider text-subtle">
            Gap:{" "}
          </span>
          {assessment.gap}
        </div>
      ) : null}
      {assessment.suggestion ? (
        <div className="mt-1 font-body text-[12px] leading-relaxed text-muted">
          <span className="font-mono text-[10px] uppercase tracking-wider text-subtle">
            Suggestion:{" "}
          </span>
          {assessment.suggestion}
        </div>
      ) : null}
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={accept}
          disabled={pending}
          className="aur-btn aur-btn-ghost text-[11px] disabled:opacity-60"
          title="Apply the AI's suggested status to this item."
        >
          Accept
        </button>
        <button
          type="button"
          onClick={dismiss}
          disabled={pending}
          className="aur-btn aur-btn-ghost text-[11px] disabled:opacity-60"
          title="Dismiss this AI suggestion without changing the human-set status."
        >
          Dismiss
        </button>
      </div>
      {error ? (
        <div className="mt-2 font-mono text-[11px] text-rose">{error}</div>
      ) : null}
    </div>
  );
}
