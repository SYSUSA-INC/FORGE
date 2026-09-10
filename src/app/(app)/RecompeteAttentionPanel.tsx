import Link from "next/link";
import { Panel } from "@/components/ui/Panel";
import { confidenceLabel } from "@/lib/recompete-match";
import { getRecompeteAttention, type RecompeteAttentionItem } from "@/lib/recompete-radar";

/**
 * BL-FB-WIN-RECOMPETE — Command Center "needs attention" strip: open
 * opportunities and fresh solicitations that look like a recompete of a
 * pursuit the org already decided. Renders nothing when clear.
 */
export async function RecompeteAttentionPanel({ organizationId }: { organizationId: string }) {
  const items = await getRecompeteAttention(organizationId).catch(
    () => [] as RecompeteAttentionItem[],
  );
  if (items.length === 0) return null;

  const losses = items.filter((i) => i.flag.outcome === "lost").length;

  return (
    <section className="mb-6">
      <Panel
        title="Needs attention"
        eyebrow={`Recompete radar · ${items.length} flagged${losses ? ` · ${losses} past loss${losses === 1 ? "" : "es"}` : ""}`}
        accent={losses > 0 ? "rose" : "emerald"}
        actions={
          <Link
            href="/intelligence/losses"
            className="font-mono text-[10px] uppercase tracking-widest text-muted hover:text-text"
          >
            Loss intelligence →
          </Link>
        }
      >
        <ul className="flex flex-col gap-1.5">
          {items.map((it) => {
            const f = it.flag;
            const lost = f.outcome === "lost";
            const year = f.decidedAt ? f.decidedAt.slice(0, 4) : null;
            return (
              <li key={`${it.kind}-${it.id}`}>
                <Link
                  href={it.kind === "opportunity" ? `/opportunities/${it.id}` : `/solicitations/${it.id}`}
                  className="block rounded-md border border-white/10 bg-white/[0.02] px-3 py-2 hover:border-white/20"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest ${
                        lost
                          ? "border-rose/40 bg-rose/10 text-rose"
                          : "border-emerald-400/40 bg-emerald-400/10 text-emerald-300"
                      }`}
                    >
                      {lost
                        ? `Lost${f.awardedTo ? ` to ${f.awardedTo}` : ""}${year ? ` · ${year}` : ""}`
                        : `Won${year ? ` · ${year}` : ""}`}
                    </span>
                    <span className="min-w-0 truncate font-display text-[13px] text-text">{it.title}</span>
                    <span className="ml-auto shrink-0 font-mono text-[10px] uppercase tracking-widest text-muted">
                      {confidenceLabel(f.confidence)} · {Math.round(f.score * 100)}%
                    </span>
                  </div>
                  <div className="mt-1 truncate font-mono text-[10px] uppercase tracking-[0.18em] text-muted">
                    {it.agency || "—"} · bid before as “{f.title}”
                  </div>
                  {f.lessons ? (
                    <p className="mt-1 line-clamp-2 font-body text-[12px] leading-relaxed text-muted">
                      {f.lessons}
                    </p>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      </Panel>
    </section>
  );
}
