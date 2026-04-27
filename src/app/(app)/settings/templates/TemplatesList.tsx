"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Panel } from "@/components/ui/Panel";
import {
  archiveTemplateAction,
  setDefaultTemplateAction,
  unarchiveTemplateAction,
  type TemplateRow,
} from "./actions";

export function TemplatesList({ templates }: { templates: TemplateRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function setDefault(id: string) {
    startTransition(async () => {
      const res = await setDefaultTemplateAction(id);
      if (res.ok) router.refresh();
    });
  }

  function archive(id: string, name: string) {
    if (!window.confirm(`Archive template "${name}"? Authors won't see it on /proposals/new.`)) return;
    startTransition(async () => {
      const res = await archiveTemplateAction(id);
      if (res.ok) router.refresh();
    });
  }

  function unarchive(id: string) {
    startTransition(async () => {
      const res = await unarchiveTemplateAction(id);
      if (res.ok) router.refresh();
    });
  }

  const active = templates.filter((t) => !t.archivedAt);
  const archived = templates.filter((t) => t.archivedAt);

  return (
    <div className="flex flex-col gap-4">
      <Panel
        title="Active templates"
        eyebrow={`${active.length} of ${templates.length}`}
      >
        {active.length === 0 ? (
          <div className="font-mono text-[11px] text-muted">
            No active templates.
          </div>
        ) : (
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {active.map((t) => (
              <li
                key={t.id}
                className="aur-card flex flex-col gap-3 p-4"
                style={{
                  borderColor: t.isDefault
                    ? `${t.brandPrimary}80`
                    : undefined,
                  background: t.isDefault
                    ? `${t.brandPrimary}0D`
                    : undefined,
                }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/settings/templates/${t.id}`}
                        className="font-display text-[15px] font-semibold text-text hover:underline"
                      >
                        {t.name}
                      </Link>
                      {t.isDefault ? (
                        <span
                          className="rounded px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest"
                          style={{
                            color: t.brandPrimary,
                            backgroundColor: `${t.brandPrimary}1A`,
                            border: `1px solid ${t.brandPrimary}50`,
                          }}
                        >
                          Default
                        </span>
                      ) : null}
                    </div>
                    {t.description ? (
                      <p className="mt-1 line-clamp-2 font-body text-[12px] text-muted">
                        {t.description}
                      </p>
                    ) : null}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 font-mono text-[10px] text-subtle">
                  <span
                    className="inline-block h-3 w-3 rounded-full"
                    style={{ background: t.brandPrimary }}
                    aria-hidden
                  />
                  <span
                    className="inline-block h-3 w-3 rounded-full"
                    style={{ background: t.brandAccent }}
                    aria-hidden
                  />
                  <span>{t.fontDisplay}</span>
                  <span>·</span>
                  <span>{t.sectionCount} sections</span>
                </div>

                <div className="mt-auto flex items-center justify-between gap-2 border-t border-white/10 pt-3 font-mono text-[10px] text-muted">
                  <span>
                    Updated{" "}
                    {new Date(t.updatedAt).toISOString().slice(0, 10)}
                  </span>
                  <div className="flex items-center gap-2">
                    {!t.isDefault ? (
                      <button
                        type="button"
                        onClick={() => setDefault(t.id)}
                        disabled={pending}
                        className="uppercase tracking-widest hover:text-teal disabled:opacity-50"
                      >
                        Set default
                      </button>
                    ) : null}
                    <Link
                      href={`/settings/templates/${t.id}`}
                      className="uppercase tracking-widest hover:text-text"
                    >
                      Edit
                    </Link>
                    <button
                      type="button"
                      onClick={() => archive(t.id, t.name)}
                      disabled={pending}
                      className="uppercase tracking-widest hover:text-rose disabled:opacity-50"
                    >
                      Archive
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {archived.length > 0 ? (
        <Panel
          title="Archived"
          eyebrow={`${archived.length}`}
        >
          <ul className="flex flex-col gap-1.5">
            {archived.map((t) => (
              <li
                key={t.id}
                className="flex items-center justify-between gap-3 rounded-md border border-white/10 bg-white/[0.02] px-3 py-2 text-muted"
              >
                <div className="min-w-0 flex-1">
                  <span className="font-display text-[13px]">{t.name}</span>
                  <span className="ml-2 font-mono text-[10px] text-subtle">
                    archived{" "}
                    {t.archivedAt
                      ? new Date(t.archivedAt).toISOString().slice(0, 10)
                      : ""}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => unarchive(t.id)}
                  disabled={pending}
                  className="font-mono text-[10px] uppercase tracking-widest text-muted hover:text-text disabled:opacity-50"
                >
                  Restore
                </button>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
    </div>
  );
}
