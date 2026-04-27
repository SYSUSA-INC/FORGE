"use client";

import { FormEvent, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Panel } from "@/components/ui/Panel";
import type { ProposalSectionKind, TemplateSectionSeed } from "@/db/schema";
import { SECTION_KIND_LABELS } from "@/lib/proposal-types";
import { setDefaultTemplateAction, updateTemplateAction } from "../actions";

const SECTION_KINDS: ProposalSectionKind[] = [
  "executive_summary",
  "technical",
  "management",
  "past_performance",
  "pricing",
  "compliance",
];

type Initial = {
  name: string;
  description: string;
  coverHtml: string;
  headerHtml: string;
  footerHtml: string;
  pageCss: string;
  sectionSeed: TemplateSectionSeed[];
  brandPrimary: string;
  brandAccent: string;
  fontDisplay: string;
  fontBody: string;
  logoUrl: string;
  isDefault: boolean;
  archivedAt: string | null;
};

export function EditTemplateClient({
  id,
  initial,
}: {
  id: string;
  initial: Initial;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [brandPrimary, setBrandPrimary] = useState(initial.brandPrimary);
  const [brandAccent, setBrandAccent] = useState(initial.brandAccent);
  const [fontDisplay, setFontDisplay] = useState(initial.fontDisplay);
  const [fontBody, setFontBody] = useState(initial.fontBody);
  const [logoUrl, setLogoUrl] = useState(initial.logoUrl);
  const [coverHtml, setCoverHtml] = useState(initial.coverHtml);
  const [headerHtml, setHeaderHtml] = useState(initial.headerHtml);
  const [footerHtml, setFooterHtml] = useState(initial.footerHtml);
  const [pageCss, setPageCss] = useState(initial.pageCss);
  const [seed, setSeed] = useState<TemplateSectionSeed[]>(initial.sectionSeed);

  function updateSeedItem(idx: number, patch: Partial<TemplateSectionSeed>) {
    setSeed((prev) =>
      prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)),
    );
  }
  function moveSeedItem(idx: number, dir: -1 | 1) {
    setSeed((prev) => {
      const target = idx + dir;
      if (target < 0 || target >= prev.length) return prev;
      const copy = [...prev];
      [copy[idx], copy[target]] = [copy[target]!, copy[idx]!];
      return copy.map((s, i) => ({ ...s, ordering: i + 1 }));
    });
  }
  function removeSeedItem(idx: number) {
    setSeed((prev) =>
      prev.filter((_, i) => i !== idx).map((s, i) => ({ ...s, ordering: i + 1 })),
    );
  }
  function addSeedItem() {
    setSeed((prev) => [
      ...prev,
      {
        kind: "technical",
        title: "New section",
        ordering: prev.length + 1,
        pageLimit: null,
      },
    ]);
  }

  function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await updateTemplateAction(id, {
        name,
        description,
        brandPrimary,
        brandAccent,
        fontDisplay,
        fontBody,
        logoUrl,
        coverHtml,
        headerHtml,
        footerHtml,
        pageCss,
        sectionSeed: seed,
      });
      if (!res.ok) return setError(res.error);
      setNotice("Saved.");
      router.refresh();
    });
  }

  function makeDefault() {
    startTransition(async () => {
      const res = await setDefaultTemplateAction(id);
      if (!res.ok) return setError(res.error);
      router.refresh();
    });
  }

  return (
    <form className="grid gap-4 xl:grid-cols-[1.6fr_1fr]" onSubmit={save}>
      <div className="flex flex-col gap-4">
        <Panel
          title="Identity"
          eyebrow="Authors see this on /proposals/new"
          actions={
            initial.isDefault ? (
              <span
                className="rounded px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-widest"
                style={{
                  color: brandPrimary,
                  backgroundColor: `${brandPrimary}1A`,
                  border: `1px solid ${brandPrimary}50`,
                }}
              >
                Default
              </span>
            ) : (
              <button
                type="button"
                disabled={pending}
                onClick={makeDefault}
                className="aur-btn aur-btn-ghost text-[11px]"
              >
                Set as default
              </button>
            )
          }
        >
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="aur-label" htmlFor="t-name">
                Name
              </label>
              <input
                id="t-name"
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="aur-input"
              />
            </div>
            <div>
              <label className="aur-label" htmlFor="t-logo">
                Logo URL
              </label>
              <input
                id="t-logo"
                type="text"
                value={logoUrl}
                onChange={(e) => setLogoUrl(e.target.value)}
                className="aur-input"
                placeholder="https://…"
              />
            </div>
          </div>
          <div className="mt-3">
            <label className="aur-label" htmlFor="t-desc">
              Description
            </label>
            <textarea
              id="t-desc"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="aur-input min-h-[60px] resize-y"
            />
          </div>
        </Panel>

        <Panel title="Section seed" eyebrow="Default sections seeded for new proposals">
          <ul className="flex flex-col gap-2">
            {seed.map((s, i) => (
              <li
                key={i}
                className="flex flex-wrap items-end gap-2 rounded-md border border-white/10 bg-white/[0.02] px-3 py-2"
              >
                <span className="font-mono text-[10px] uppercase tracking-widest text-subtle">
                  §{s.ordering}
                </span>
                <div className="min-w-[140px] flex-1">
                  <label className="aur-label">Kind</label>
                  <select
                    className="aur-input text-[12px]"
                    value={s.kind}
                    onChange={(e) =>
                      updateSeedItem(i, {
                        kind: e.target.value as ProposalSectionKind,
                      })
                    }
                  >
                    {SECTION_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {SECTION_KIND_LABELS[k]}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="min-w-[200px] flex-[2]">
                  <label className="aur-label">Title</label>
                  <input
                    type="text"
                    className="aur-input text-[12px]"
                    value={s.title}
                    onChange={(e) =>
                      updateSeedItem(i, { title: e.target.value })
                    }
                  />
                </div>
                <div className="w-20">
                  <label className="aur-label">Page cap</label>
                  <input
                    type="number"
                    min={0}
                    className="aur-input text-[12px]"
                    value={s.pageLimit ?? ""}
                    onChange={(e) =>
                      updateSeedItem(i, {
                        pageLimit:
                          e.target.value === ""
                            ? null
                            : Number(e.target.value),
                      })
                    }
                  />
                </div>
                <div className="flex items-end gap-1 font-mono text-[10px] uppercase tracking-widest text-muted">
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => moveSeedItem(i, -1)}
                    className="rounded px-2 py-1 hover:bg-white/[0.05] hover:text-text disabled:opacity-30"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => moveSeedItem(i, 1)}
                    className="rounded px-2 py-1 hover:bg-white/[0.05] hover:text-text disabled:opacity-30"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => removeSeedItem(i)}
                    className="rounded px-2 py-1 hover:bg-rose/10 hover:text-rose disabled:opacity-30"
                  >
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
          <div className="mt-3">
            <button
              type="button"
              onClick={addSeedItem}
              disabled={pending}
              className="aur-btn aur-btn-ghost text-[11px]"
            >
              + Add section
            </button>
          </div>
        </Panel>

        <Panel title="HTML / CSS" eyebrow="Used by the PDF renderer (PR-7c)">
          <div className="flex flex-col gap-3">
            <div>
              <label className="aur-label" htmlFor="t-cover">
                Cover HTML
              </label>
              <textarea
                id="t-cover"
                rows={6}
                value={coverHtml}
                onChange={(e) => setCoverHtml(e.target.value)}
                className="aur-input min-h-[120px] resize-y font-mono text-[12px]"
              />
              <p className="mt-1 font-mono text-[10px] text-subtle">
                Variables: <code>{`{{organizationName}}`}</code>, <code>{`{{proposalTitle}}`}</code>, <code>{`{{solicitationNumber}}`}</code>, <code>{`{{agency}}`}</code>, <code>{`{{submittedDate}}`}</code>, <code>{`{{logoUrl}}`}</code>.
              </p>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <label className="aur-label" htmlFor="t-header">
                  Page header HTML
                </label>
                <textarea
                  id="t-header"
                  rows={3}
                  value={headerHtml}
                  onChange={(e) => setHeaderHtml(e.target.value)}
                  className="aur-input min-h-[80px] resize-y font-mono text-[12px]"
                />
              </div>
              <div>
                <label className="aur-label" htmlFor="t-footer">
                  Page footer HTML
                </label>
                <textarea
                  id="t-footer"
                  rows={3}
                  value={footerHtml}
                  onChange={(e) => setFooterHtml(e.target.value)}
                  className="aur-input min-h-[80px] resize-y font-mono text-[12px]"
                />
              </div>
            </div>
            <div>
              <label className="aur-label" htmlFor="t-css">
                Page CSS
              </label>
              <textarea
                id="t-css"
                rows={10}
                value={pageCss}
                onChange={(e) => setPageCss(e.target.value)}
                className="aur-input min-h-[200px] resize-y font-mono text-[12px]"
              />
            </div>
          </div>
        </Panel>
      </div>

      <div className="flex flex-col gap-4">
        <Panel title="Branding">
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="aur-label" htmlFor="t-brand-primary">
                Primary
              </label>
              <div className="flex items-center gap-2">
                <input
                  id="t-brand-primary"
                  type="color"
                  className="h-9 w-12 cursor-pointer rounded border border-white/10 bg-transparent"
                  value={brandPrimary}
                  onChange={(e) => setBrandPrimary(e.target.value)}
                />
                <input
                  type="text"
                  className="aur-input flex-1 font-mono text-[12px]"
                  value={brandPrimary}
                  onChange={(e) => setBrandPrimary(e.target.value)}
                />
              </div>
            </div>
            <div>
              <label className="aur-label" htmlFor="t-brand-accent">
                Accent
              </label>
              <div className="flex items-center gap-2">
                <input
                  id="t-brand-accent"
                  type="color"
                  className="h-9 w-12 cursor-pointer rounded border border-white/10 bg-transparent"
                  value={brandAccent}
                  onChange={(e) => setBrandAccent(e.target.value)}
                />
                <input
                  type="text"
                  className="aur-input flex-1 font-mono text-[12px]"
                  value={brandAccent}
                  onChange={(e) => setBrandAccent(e.target.value)}
                />
              </div>
            </div>
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <div>
              <label className="aur-label" htmlFor="t-font-display">
                Display font
              </label>
              <input
                id="t-font-display"
                type="text"
                className="aur-input"
                value={fontDisplay}
                onChange={(e) => setFontDisplay(e.target.value)}
              />
            </div>
            <div>
              <label className="aur-label" htmlFor="t-font-body">
                Body font
              </label>
              <input
                id="t-font-body"
                type="text"
                className="aur-input"
                value={fontBody}
                onChange={(e) => setFontBody(e.target.value)}
              />
            </div>
          </div>
        </Panel>

        <Panel title="Preview" eyebrow="Static placeholder" dense>
          <div
            className="rounded-md border p-4"
            style={{
              borderColor: `${brandPrimary}40`,
              background: `${brandPrimary}06`,
            }}
          >
            <div
              className="mb-2 font-mono text-[10px] uppercase tracking-widest"
              style={{ color: brandPrimary }}
            >
              {fontDisplay}
            </div>
            <div
              className="font-display text-[18px] font-semibold"
              style={{ color: brandPrimary, fontFamily: fontDisplay }}
            >
              {name || "Untitled template"}
            </div>
            <p
              className="mt-2 font-body text-[12px] leading-relaxed text-muted"
              style={{ fontFamily: fontBody }}
            >
              {description || "Description shows here for the team picking this template on /proposals/new."}
            </p>
            <div className="mt-3 flex flex-wrap gap-1">
              {seed.map((s, i) => (
                <span
                  key={i}
                  className="rounded px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest"
                  style={{
                    color: brandAccent,
                    backgroundColor: `${brandAccent}14`,
                    border: `1px solid ${brandAccent}40`,
                  }}
                >
                  §{s.ordering} {s.title}
                </span>
              ))}
            </div>
          </div>
        </Panel>

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

        <div className="flex flex-wrap items-center justify-between gap-2">
          <Link
            href="/settings/templates"
            className="aur-btn aur-btn-ghost text-[11px]"
          >
            Back
          </Link>
          <button
            type="submit"
            disabled={pending}
            className="aur-btn aur-btn-primary"
          >
            {pending ? "Saving…" : "Save template"}
          </button>
        </div>
      </div>
    </form>
  );
}
