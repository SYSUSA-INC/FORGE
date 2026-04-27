import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { solicitations } from "@/db/schema";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";

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

export default async function SolicitationsListPage() {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  const rows = await db
    .select({
      id: solicitations.id,
      title: solicitations.title,
      fileName: solicitations.fileName,
      fileSize: solicitations.fileSize,
      type: solicitations.type,
      agency: solicitations.agency,
      solicitationNumber: solicitations.solicitationNumber,
      naicsCode: solicitations.naicsCode,
      setAside: solicitations.setAside,
      responseDueDate: solicitations.responseDueDate,
      parseStatus: solicitations.parseStatus,
      opportunityId: solicitations.opportunityId,
      createdAt: solicitations.createdAt,
    })
    .from(solicitations)
    .where(eq(solicitations.organizationId, organizationId))
    .orderBy(desc(solicitations.createdAt));

  const total = rows.length;
  const parsed = rows.filter((r) => r.parseStatus === "parsed").length;
  const failed = rows.filter((r) => r.parseStatus === "failed").length;
  const linked = rows.filter((r) => r.opportunityId).length;

  return (
    <>
      <PageHeader
        eyebrow="Solicitations · Intake"
        title="Solicitations"
        subtitle="Raw PDF uploads, with text extraction + AI-extracted Section L / M summaries and shall / should / may statements. Convert to an opportunity in one click when you're ready to pursue."
        actions={
          <>
            <Link href="/opportunities/import" className="aur-btn aur-btn-ghost">
              Import from SAM.gov
            </Link>
            <Link href="/solicitations/new" className="aur-btn aur-btn-primary">
              + Upload solicitation
            </Link>
          </>
        }
        meta={[
          { label: "Total", value: String(total).padStart(2, "0") },
          {
            label: "Parsed",
            value: String(parsed).padStart(2, "0"),
            accent: parsed > 0 ? "emerald" : undefined,
          },
          {
            label: "Linked to opp",
            value: String(linked).padStart(2, "0"),
            accent: linked > 0 ? "magenta" : undefined,
          },
          {
            label: "Parse errors",
            value: String(failed).padStart(2, "0"),
            accent: failed > 0 ? "rose" : undefined,
          },
        ]}
      />

      {total === 0 ? (
        <Panel title="Empty intake">
          <p className="font-body text-[14px] leading-relaxed text-muted">
            No solicitations yet. Upload a PDF (RFP / RFI / RFQ / Sources
            Sought) and FORGE will extract the text, summarize Section L
            and Section M, and pull the top shall / should / may
            statements.
          </p>
          <div className="mt-3 flex gap-2">
            <Link
              href="/solicitations/new"
              className="aur-btn aur-btn-primary"
            >
              + Upload your first solicitation
            </Link>
            <Link href="/opportunities/import" className="aur-btn">
              Or import from SAM.gov
            </Link>
          </div>
        </Panel>
      ) : (
        <Panel title="All uploads">
          <ul className="flex flex-col gap-1.5">
            {rows.map((r) => {
              const color = STATUS_COLOR[r.parseStatus] ?? "#9BC9D9";
              return (
                <li key={r.id}>
                  <Link
                    href={`/solicitations/${r.id}`}
                    className="flex items-center justify-between gap-3 rounded-md border border-white/10 bg-white/[0.02] px-3 py-2.5 hover:border-white/20"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate font-display text-[14px] font-semibold text-text">
                          {r.title || r.fileName || "Untitled"}
                        </span>
                        <span
                          className="rounded px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest"
                          style={{
                            color,
                            backgroundColor: `${color}1A`,
                            border: `1px solid ${color}50`,
                          }}
                        >
                          {STATUS_LABEL[r.parseStatus] ?? r.parseStatus}
                        </span>
                        {r.opportunityId ? (
                          <span className="rounded px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest text-magenta border border-magenta/40 bg-magenta/10">
                            opp linked
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-[10px] text-muted">
                        {r.solicitationNumber ? (
                          <span>{r.solicitationNumber}</span>
                        ) : null}
                        {r.agency ? <span>{r.agency}</span> : null}
                        {r.type && r.type !== "other" ? (
                          <span>{r.type.toUpperCase().replace("_", " ")}</span>
                        ) : null}
                        {r.naicsCode ? <span>NAICS {r.naicsCode}</span> : null}
                        {r.responseDueDate ? (
                          <span>
                            due {r.responseDueDate.toISOString().slice(0, 10)}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <div className="shrink-0 text-right font-mono text-[10px] text-subtle">
                      <div>
                        {r.createdAt.toISOString().slice(0, 10)}
                      </div>
                      <div>
                        {Math.max(1, Math.round(r.fileSize / 1024))} KB
                      </div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Panel>
      )}
    </>
  );
}
