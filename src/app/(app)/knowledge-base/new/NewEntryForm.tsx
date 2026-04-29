"use client";

import { FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { KnowledgeKind } from "@/db/schema";
import { createKnowledgeEntryAction } from "../actions";

const KINDS: { key: KnowledgeKind; label: string; description: string }[] = [
  {
    key: "capability",
    label: "Capability",
    description:
      "A core competency, technology, or service line — surfaces in technical-approach drafting.",
  },
  {
    key: "past_performance",
    label: "Past performance",
    description:
      "A contract reference — customer, period of performance, scope, value. Surfaces in past-performance volumes.",
  },
  {
    key: "personnel",
    label: "Personnel",
    description:
      "A named person — bio, clearance, certifications. Surfaces when management volumes need keyed personnel.",
  },
  {
    key: "boilerplate",
    label: "Boilerplate",
    description:
      "Reusable language — corporate intro, security posture, compliance attestations.",
  },
];

export function NewEntryForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<KnowledgeKind>("capability");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [tagsRaw, setTagsRaw] = useState("");

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const tags = tagsRaw
      .split(/[,\n]/)
      .map((t) => t.trim())
      .filter(Boolean);
    startTransition(async () => {
      const res = await createKnowledgeEntryAction({ kind, title, body, tags });
      if (!res.ok) return setError(res.error);
      router.push(`/knowledge-base/${res.id}`);
    });
  }

  const selected = KINDS.find((k) => k.key === kind);

  return (
    <form className="flex flex-col gap-4" onSubmit={onSubmit}>
      <div>
        <label className="aur-label">Kind</label>
        <div className="grid gap-2 md:grid-cols-2">
          {KINDS.map((k) => {
            const active = k.key === kind;
            return (
              <label
                key={k.key}
                className={`flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2 transition-colors ${
                  active
                    ? "border-teal/50 bg-teal/[0.06]"
                    : "border-white/10 bg-white/[0.02] hover:border-white/20"
                }`}
              >
                <input
                  type="radio"
                  name="kind"
                  className="mt-1 accent-teal-400"
                  checked={active}
                  onChange={() => setKind(k.key)}
                />
                <div className="min-w-0 flex-1">
                  <div className="font-display text-[13px] font-semibold text-text">
                    {k.label}
                  </div>
                  <div className="font-body text-[11px] leading-relaxed text-muted">
                    {k.description}
                  </div>
                </div>
              </label>
            );
          })}
        </div>
      </div>

      <div>
        <label className="aur-label" htmlFor="kb-title">
          Title
        </label>
        <input
          id="kb-title"
          required
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="aur-input"
          placeholder={
            selected?.key === "past_performance"
              ? "NAVSEA SeaPort-NxG ML/Ops"
              : selected?.key === "personnel"
                ? "Jane Doe, Lead Architect"
                : selected?.key === "boilerplate"
                  ? "Corporate intro paragraph"
                  : "Zero-Trust architecture for shipboard C5ISR"
          }
        />
      </div>

      <div>
        <label className="aur-label" htmlFor="kb-body">
          Body
        </label>
        <textarea
          id="kb-body"
          rows={10}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          className="aur-input min-h-[200px] resize-y font-body text-[13px] leading-relaxed"
          placeholder={
            selected?.key === "past_performance"
              ? "Customer · Contract # · Period of performance · Value · Scope · CPARS rating"
              : selected?.key === "personnel"
                ? "Role · Clearance · Years of experience · Certifications · Bio"
                : "The reusable text or supporting context."
          }
        />
      </div>

      <div>
        <label className="aur-label" htmlFor="kb-tags">
          Tags
        </label>
        <input
          id="kb-tags"
          type="text"
          value={tagsRaw}
          onChange={(e) => setTagsRaw(e.target.value)}
          className="aur-input"
          placeholder="comma- or newline-separated · e.g. NAVSEA, ZTA, AWS GovCloud"
        />
      </div>

      {error ? (
        <div className="rounded-md border border-rose/40 bg-rose/10 px-3 py-2 font-mono text-[11px] text-rose">
          {error}
        </div>
      ) : null}

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={pending || !title.trim()}
          className="aur-btn aur-btn-primary disabled:opacity-50"
        >
          {pending ? "Creating…" : "Create entry"}
        </button>
      </div>
    </form>
  );
}
