"use client";

import { FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Panel } from "@/components/ui/Panel";
import { createTemplateAction } from "../actions";

type StarterPreview = {
  index: number;
  name: string;
  description: string;
  sectionCount: number;
  brandPrimary: string;
  brandAccent: string;
};

export function NewTemplateForm({ starters }: { starters: StarterPreview[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [starterIndex, setStarterIndex] = useState(0);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await createTemplateAction({ name, description, starterIndex });
      if (!res.ok) return setError(res.error);
      router.push(`/settings/templates/${res.id}`);
    });
  }

  return (
    <form className="grid gap-4 xl:grid-cols-[2fr_1fr]" onSubmit={onSubmit}>
      <Panel title="Pick a starter" eyebrow="Built-in baseline">
        <div className="flex flex-col gap-2">
          {starters.map((s) => {
            const selected = s.index === starterIndex;
            return (
              <label
                key={s.index}
                className={`flex cursor-pointer items-start gap-3 rounded-md border px-3 py-3 transition-colors ${
                  selected
                    ? "border-teal/50 bg-teal/5"
                    : "border-white/10 bg-white/[0.02] hover:border-white/20"
                }`}
              >
                <input
                  type="radio"
                  name="starter"
                  className="mt-1 accent-teal-400"
                  checked={selected}
                  onChange={() => setStarterIndex(s.index)}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-display text-[14px] font-semibold text-text">
                      {s.name}
                    </span>
                    <span
                      className="inline-block h-3 w-3 rounded-full"
                      style={{ background: s.brandPrimary }}
                      aria-hidden
                    />
                    <span
                      className="inline-block h-3 w-3 rounded-full"
                      style={{ background: s.brandAccent }}
                      aria-hidden
                    />
                    <span className="ml-auto rounded bg-white/5 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest text-muted">
                      {s.sectionCount} sections
                    </span>
                  </div>
                  <p className="mt-1 font-body text-[12px] leading-relaxed text-muted">
                    {s.description}
                  </p>
                </div>
              </label>
            );
          })}
        </div>
      </Panel>

      <Panel title="Name + description">
        <div className="flex flex-col gap-3">
          <div>
            <label className="aur-label" htmlFor="template-name">
              Name
            </label>
            <input
              id="template-name"
              required
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="aur-input"
              placeholder="e.g. Default · DoD response"
            />
          </div>
          <div>
            <label className="aur-label" htmlFor="template-desc">
              Description
            </label>
            <textarea
              id="template-desc"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="aur-input min-h-[72px] resize-y"
              placeholder="One-liner the team will see when picking on /proposals/new."
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
              disabled={pending || !name.trim()}
              className="aur-btn aur-btn-primary disabled:opacity-50"
            >
              {pending ? "Creating…" : "Create template"}
            </button>
          </div>
        </div>
      </Panel>
    </form>
  );
}
