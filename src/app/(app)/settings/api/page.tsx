import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { appBaseUrl } from "@/lib/app-url";
import { requireAuth, requireCurrentOrg, requireOrgAdmin } from "@/lib/auth-helpers";
import { apiAccessRefusal, listApiTokens } from "@/lib/api-tokens";
import { API_PAGE_MAX, API_RATE_LIMIT } from "@/lib/api-tokens-logic";
import { ApiTokensClient } from "./ApiTokensClient";

export const dynamic = "force-dynamic";

const ENDPOINTS: { path: string; what: string }[] = [
  { path: "GET /api/v1/me", what: "The workspace and token you are calling with." },
  { path: "GET /api/v1/opportunities", what: "Pipeline opportunities, newest change first." },
  { path: "GET /api/v1/opportunities/{id}", what: "One opportunity, with its description." },
  { path: "GET /api/v1/proposals", what: "Proposals, newest change first." },
  { path: "GET /api/v1/proposals/{id}", what: "One proposal with its section outline (titles, status, word counts)." },
  { path: "GET /api/v1/proposals/{id}/sections/{sectionId}", what: "One section with its text, as plain text and HTML (the final view, as exports show it)." },
  { path: "GET /api/v1/openapi.json", what: "The OpenAPI 3.1 description of all of the above. No token needed." },
];

/**
 * BL-16 apiAccess — Settings → API access. Org admins create and revoke
 * the workspace's read-only API tokens; the page also carries the quick
 * reference an integrator needs.
 */
export default async function ApiAccessPage() {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  await requireOrgAdmin(organizationId);

  const [refusal, tokens] = await Promise.all([apiAccessRefusal(organizationId), listApiTokens(organizationId)]);
  const active = tokens.filter((t) => t.state === "active").length;
  const base = appBaseUrl();

  return (
    <>
      <PageHeader
        eyebrow="Settings · API access"
        title="API access"
        subtitle="Read-only API tokens for connecting FORGE to your CRM, BI dashboards or internal tools."
        meta={[
          { label: "Plan", value: refusal ? "Not included" : "Included", accent: refusal ? "rose" : "emerald" },
          { label: "Active tokens", value: String(active) },
        ]}
      />
      {refusal ? (
        <Panel title="Not in your plan" eyebrow="API access">
          <p className="font-body text-[14px] leading-relaxed text-muted">
            {refusal} Tokens you already made stay listed, but they are refused until API access is back on.
          </p>
          <Link href="/settings/billing" className="aur-btn aur-btn-primary mt-3 inline-block">
            Open billing
          </Link>
        </Panel>
      ) : null}
      <ApiTokensClient tokens={tokens} canCreate={!refusal} />
      <Panel title="Quick reference" eyebrow="Read-only · JSON" className="mt-4">
        <p className="font-body text-[13px] leading-relaxed text-muted">
          Send the token on every request. Responses are JSON; lists come back newest change first with a{" "}
          <code className="font-mono text-text">nextCursor</code> to fetch the next page.
        </p>
        <pre className="mt-3 overflow-x-auto rounded-md border border-layer/10 bg-layer/[0.03] p-3 font-mono text-[12px] text-text">
          {`curl -H "Authorization: Bearer forge_…" \\\n  "${base}/api/v1/opportunities?limit=50&updated_since=2026-10-01T00:00:00Z"`}
        </pre>
        <table className="mt-3 w-full text-left font-body text-[13px]">
          <tbody>
            {ENDPOINTS.map((e) => (
              <tr key={e.path} className="border-t border-layer/10">
                <td className="py-2 pr-4 font-mono text-[12px] text-text">{e.path}</td>
                <td className="py-2 text-muted">{e.what}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-3 font-mono text-[11px] text-muted">
          List parameters: limit (1–{API_PAGE_MAX}, default 50) · cursor · updated_since (ISO 8601) · stage. Rate limit:{" "}
          {API_RATE_LIMIT.limit} requests a minute per token. Every answered request is recorded in the audit log.
        </p>
        <p className="mt-2 font-body text-[13px] text-muted">
          Import the{" "}
          <a href="/api/v1/openapi.json" target="_blank" rel="noreferrer" className="text-text underline-offset-2 hover:underline">
            OpenAPI document
          </a>{" "}
          into Postman, Insomnia or a client generator to get every endpoint, parameter and field.
        </p>
      </Panel>
    </>
  );
}
