import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { solicitations, users } from "@/db/schema";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { SolicitationActions } from "./SolicitationActions";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  uploaded: "Uploaded",
  parsing: "Parsing",
  parsed: "Parsed",
  failed: "Failed",
};

const STATUS_COLOR: Record<string, string> = {
  uploaded: "#9BC9D9",
  parsing: "#A78BFA",
  parsed: "#10B981",
  failed: "#EF4444",
};

const KIND_COLOR: Record<string, string> = {
  shall: "#EF4444",
  should: "#F59E0B",
  may: "#9BC9D9",
};

export default async function SolicitationDetail({
  params,
}: {
  params: { id: string };
}) {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  const [row] = await db
    .select({
      s: solicitations,
      uploaderName: users.name,
      uploaderEmail: users.email,
    })
    .from(solicitations)
    .leftJoin(users, eq(users.id, solicitations.uploadedByUserId))
    .where(
      and(
        eq(solicitations.id, params.id),
        eq(solicitations.organizationId, organizationId),
      ),
    )
    .limit(1);

  if (!row) notFound();
  const s = row.s;
  const statusColor = STATUS_COLOR[s.parseStatus] ?? "#9BC9D9";

  return (
    <>
      <PageHeader
        eyebrow={`Solicitation${s.solicitationNumber ? ` · ${s.solicitationNumber}` : ""}`}
        title={s.title || s.fileName || "Untitled solicitation"}
        subtitle={
          s.agency || s.naicsCode
            ? [s.agency, s.naicsCode ? `NAICS ${s.naicsCode}` : ""]
                .filter(Boolean)
                .join(" · ")
            : undefined
        }
        actions={
          <>
            <Link href="/solicitations" className="aur-btn aur-btn-ghost">
              Back
            </Link>
            <SolicitationActions
              id={s.id}
              parseStatus={s.parseStatus}
              opportunityId={s.opportunityId}
              hasStorage={!!s.storagePath}
            />
          </>
        }
        meta={[
          {
            label: "Parse",
            value: STATUS_LABEL[s.parseStatus] ?? s.parseStatus,
          },
          {
            label: "Type",
            value: s.type === "other" ? "—" : s.type.toUpperCase().replace("_", " "),
          },
          {
            label: "Due",
            value: s.responseDueDate
              ? s.responseDueDate.toISOString().slice(0, 10)
              : "—",
            accent: s.responseDueDate ? "rose" : undefined,
          },
          {
            label: "Set-aside",
            value: s.setAside || "—",
          },
        ]}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 font-mono text-[11px]">
        <span
          className="rounded px-1.5 py-0.5 uppercase tracking-widest"
          style={{
            color: statusColor,
            backgroundColor: `${statusColor}1A`,
            border: `1px solid ${statusColor}50`,
          }}
        >
          {STATUS_LABEL[s.parseStatus] ?? s.parseStatus}
        </span>
        <span className="text-muted">
          {s.fileName} · {Math.max(1, Math.round(s.fileSize / 1024))} KB
        </span>
        <span className="text-subtle">
          uploaded {s.createdAt.toISOString().slice(0, 10)}
          {row.uploaderName || row.uploaderEmail
            ? ` by ${row.uploaderName ?? row.uploaderEmail}`
            : ""}
        </span>
        {s.opportunityId ? (
          <Link
            href={`/opportunities/${s.opportunityId}`}
            className="ml-auto text-teal underline"
          >
            View linked opportunity →
          </Link>
        ) : null}
      </div>

      {s.parseStatus === "failed" && s.parseError ? (
        <Panel title="Parse error">
          <pre className="whitespace-pre-wrap rounded-md border border-rose/40 bg-rose/[0.06] p-3 font-mono text-[12px] leading-relaxed text-rose">
            {s.parseError}
          </pre>
          <p className="mt-3 font-body text-[12px] leading-relaxed text-muted">
            If this is a scanned-image PDF, FORGE doesn't yet OCR — re-upload
            a text-layer version. Otherwise click <strong>Re-parse</strong>{" "}
            once the cause is fixed.
          </p>
        </Panel>
      ) : null}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[2fr_1fr]">
        <div className="flex flex-col gap-4">
          {s.sectionLSummary ? (
            <Panel
              title="Section L · Instructions to offerors"
              eyebrow="AI summary"
            >
              <p className="whitespace-pre-wrap font-body text-[13px] leading-relaxed text-text">
                {s.sectionLSummary}
              </p>
            </Panel>
          ) : null}

          {s.sectionMSummary ? (
            <Panel
              title="Section M · Evaluation criteria"
              eyebrow="AI summary"
            >
              <p className="whitespace-pre-wrap font-body text-[13px] leading-relaxed text-text">
                {s.sectionMSummary}
              </p>
            </Panel>
          ) : null}

          <Panel
            title="Requirements"
            eyebrow={`${s.extractedRequirements.length} extracted`}
          >
            {s.extractedRequirements.length === 0 ? (
              <p className="font-body text-[13px] text-muted">
                {s.parseStatus === "parsed"
                  ? "No requirements extracted. The document may not have explicit shall/should/may language."
                  : s.parseStatus === "failed"
                    ? "Parsing failed — see error above."
                    : "Parsing in progress…"}
              </p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {s.extractedRequirements.map((r, i) => {
                  const color = KIND_COLOR[r.kind] ?? "#9BC9D9";
                  return (
                    <li
                      key={i}
                      className="flex items-start gap-3 rounded-md border border-white/10 bg-white/[0.02] px-3 py-2"
                    >
                      <span
                        className="mt-0.5 shrink-0 rounded px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest"
                        style={{
                          color,
                          backgroundColor: `${color}1A`,
                          border: `1px solid ${color}50`,
                        }}
                      >
                        {r.kind}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="font-body text-[13px] leading-relaxed text-text">
                          {r.text}
                        </p>
                        {r.ref ? (
                          <div className="mt-0.5 font-mono text-[10px] uppercase tracking-widest text-subtle">
                            {r.ref}
                          </div>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
        </div>

        <div className="flex flex-col gap-4">
          <Panel title="Extracted facts">
            <dl className="flex flex-col gap-1.5 font-mono text-[11px]">
              <Row label="Title" value={s.title} />
              <Row label="Solicitation #" value={s.solicitationNumber} />
              <Row label="Agency" value={s.agency} />
              <Row label="Office" value={s.office} />
              <Row label="NAICS" value={s.naicsCode} />
              <Row label="Set-aside" value={s.setAside} />
              <Row
                label="Type"
                value={
                  s.type === "other" ? "" : s.type.toUpperCase().replace("_", " ")
                }
              />
              <Row
                label="Due date"
                value={
                  s.responseDueDate
                    ? s.responseDueDate.toISOString().slice(0, 10)
                    : ""
                }
              />
            </dl>
          </Panel>

          {s.rawText ? (
            <Panel title="Raw text" eyebrow="First 2000 chars" dense>
              <pre className="max-h-[420px] overflow-y-auto whitespace-pre-wrap font-mono text-[10px] leading-relaxed text-muted">
                {s.rawText.slice(0, 2000)}
                {s.rawText.length > 2000 ? "\n…" : ""}
              </pre>
            </Panel>
          ) : null}
        </div>
      </div>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-white/5 pb-1.5 last:border-b-0">
      <dt className="text-[10px] uppercase tracking-[0.22em] text-subtle">
        {label}
      </dt>
      <dd className="text-right text-text">{value || "—"}</dd>
    </div>
  );
}
