import { Panel } from "@/components/ui/Panel";
import { apiAccessRefusal, listApiTokens } from "@/lib/api-tokens";
import { TenantApiTokensPanel } from "./TenantApiTokensPanel";

/**
 * BL-16 API Slice 2a — the tenant's API tokens on /admin/orgs/[id]: who
 * made each, when it was last used, and a revoke (one or all) with a
 * reason. Rendered by the page under requireSuperadmin(); the reads are
 * scoped to the tenant whose page this is. The token itself is never
 * stored, so nothing here can reveal one.
 */
export async function TenantApiTokensSection({ organizationId }: { organizationId: string }) {
  const [tokens, refusal] = await Promise.all([listApiTokens(organizationId), apiAccessRefusal(organizationId)]);
  const active = tokens.filter((t) => t.state === "active").length;
  return (
    <Panel title="API tokens" eyebrow={`${active} active · ${refusal ? "not in plan" : "in plan"}`}>
      {refusal && active > 0 ? (
        <p className="mb-3 font-mono text-[11px] text-gold">
          API access isn&apos;t in this tenant&apos;s plan, so these tokens are refused until it is.
        </p>
      ) : null}
      <TenantApiTokensPanel organizationId={organizationId} tokens={tokens} />
    </Panel>
  );
}
