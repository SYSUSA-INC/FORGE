import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { requireSuperadmin } from "@/lib/auth-helpers";
import { samNoticeOverview } from "@/lib/sam-notice-admin";
import { SamNoticeControls } from "./SamNoticeControls";

export const dynamic = "force-dynamic";
// "Run load now" downloads and loads SAM.gov's file (up to ~250 s).
export const maxDuration = 300;

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 16).replace("T", " ") : "—");

/**
 * BL-STAB-10b — FORGE's copy of SAM.gov's public notice descriptions:
 * how fresh it is, what it holds, its nightly runs, and the controls.
 */
export default async function SamNoticesPage() {
  await requireSuperadmin();
  const o = await samNoticeOverview();
  const total = Object.values(o.byState).reduce((a, b) => a + b, 0);
  const stale = o.fileUpdatedAt ? Date.now() - o.fileUpdatedAt.getTime() > 48 * 3_600_000 : true;
  return (
    <>
      <PageHeader
        eyebrow="Platform admin"
        title="SAM.gov notice copy"
        subtitle="Every active SAM.gov notice's description, from SAM.gov's public nightly file (no API key, no request limit). Searches start checking keywords against it in a later step (10b-3)."
        meta={[
          { label: "Notices", value: total.toLocaleString("en-US") },
          { label: "SAM.gov file of", value: o.fileUpdatedAt ? o.fileUpdatedAt.toISOString().slice(0, 10) : "never loaded", accent: stale ? "rose" : undefined },
          { label: "Newest notice", value: o.newestPostedAt ? o.newestPostedAt.toISOString().slice(0, 10) : "—" },
          { label: "Size", value: `${Math.round(o.bytes / 1_048_576)} MB` },
        ]}
      />
      <Panel title="Controls" eyebrow={`Nightly load ${o.switches.load ? "on" : "paused"} · searches ${o.switches.reads ? "will read" : "won't read"} the copy (10b-3)`} className="mb-4">
        <p className="mb-3 font-body text-[12px] text-muted">
          The load runs at 04:20, 06:20 and 08:20 UTC; an unchanged file costs one request to SAM.gov&apos;s file server and no writes. A run cut short
          is finished by the next one. The spot-check reads 13 stored notices live from SAM.gov (shared key) and counts how they compare.
        </p>
        <SamNoticeControls switches={o.switches} />
      </Panel>
      <Panel title="What the copy holds" className="mb-4">
        <p className="font-mono text-[11px] text-muted">
          {(["text", "truncated", "none", "link"] as const).map((s) => `${(o.byState[s] ?? 0).toLocaleString("en-US")} ${s === "text" ? "with a description" : s === "truncated" ? "cut at 32,000 characters" : s === "none" ? "with none" : "only a link"}`).join(" · ")}
          {o.gone > 0 ? ` · ${o.gone.toLocaleString("en-US")} no longer in SAM.gov's file (kept 30 days)` : ""}
        </p>
      </Panel>
      <Panel title={`Recent runs (${o.runs.length})`}>
        {o.runs.length === 0 ? (
          <p className="font-mono text-[11px] text-muted">No run yet. Use Run load now, or wait for 04:20 UTC.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {o.runs.map((r) => (
              <li key={r.id} className="font-mono text-[11px] text-muted">
                <span className={r.status === "ok" || r.status === "unchanged" ? "text-emerald" : r.status === "running" ? "text-text" : "text-rose"}>{r.status}</span>
                {" · "}
                {day(r.startedAt)} UTC · {r.rowsSeen.toLocaleString("en-US")} read · {r.rowsWritten.toLocaleString("en-US")} written · {r.rowsGone} gone · {r.rowsPurged} purged
                {r.error ? <span className="block text-rose">{r.error}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}
