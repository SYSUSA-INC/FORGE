import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { requireSuperadmin } from "@/lib/auth-helpers";
import { listCompanySamKeys } from "@/lib/samgov-key-admin";
import { ReencryptButton, RemoveKeyButton } from "./SamgovKeyControls";

export const dynamic = "force-dynamic";

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "—");
const STATUS: Record<string, string> = { ok: "Accepted", invalid: "Rejected", forbidden: "Refused", rate_limited: "At its limit" };

/**
 * BL-STAB-7e — every company's own SAM.gov key, as platform admins may see
 * it: never the key, only its last four characters, what SAM.gov last said,
 * who set it and which FORGE_SECRET_KEYS entry holds it. Remove one, or
 * re-encrypt them all after a keyring rotation.
 */
export default async function SamgovKeysPage() {
  await requireSuperadmin();
  const { keyring, rows } = await listCompanySamKeys();
  const old = rows.filter((r) => !r.current);
  const unreadable = rows.filter((r) => !r.readable);
  const wrongEntry = [...new Set(rows.filter((r) => r.decrypts === "wrong_entry").map((r) => r.keyId))];
  return (
    <>
      <PageHeader
        eyebrow="Platform admin"
        title="Company SAM.gov keys"
        subtitle="Companies that use their own SAM.gov API key instead of FORGE's shared key. Keys are stored encrypted and never shown — not here, not to the company."
        meta={[
          { label: "Companies", value: String(rows.length) },
          { label: "On an older key", value: String(old.length), accent: old.length ? "gold" : undefined },
          { label: "Unreadable here", value: String(unreadable.length), accent: unreadable.length ? "rose" : undefined },
          { label: "Keyring", value: keyring.available ? `${keyring.primaryKeyId} first` : "unavailable", accent: keyring.available ? undefined : "rose" },
        ]}
      />
      <Panel title="Encryption keys" eyebrow={keyring.available ? `FORGE_SECRET_KEYS: ${keyring.keyIds.join(", ")}` : "FORGE_SECRET_KEYS unavailable"} className="mb-4">
        <div className="flex flex-col gap-3 font-body text-[12px] text-muted">
          {keyring.available ? (
            <p>
              New and re-encrypted keys use <span className="font-mono text-text">{keyring.primaryKeyId}</span>, the first entry. To rotate: put a new
              entry first in FORGE_SECRET_KEYS and keep the old ones, redeploy, click <b>Re-encrypt</b> here, and remove an old entry only once no
              company is on it.
            </p>
          ) : (
            <p className="text-rose">Company keys can&apos;t be saved or read here: {keyring.problem}.</p>
          )}
          {wrongEntry.length > 0 ? (
            <p className="text-rose">
              Keys under {wrongEntry.join(", ")} don&apos;t decrypt with that entry&apos;s value here: FORGE_SECRET_KEYS probably holds a mistyped
              value for it. Restore the original value from where it&apos;s kept; don&apos;t remove these keys or the entry.
            </p>
          ) : null}
          <ReencryptButton pending={old.filter((r) => r.readable).length} disabled={!keyring.available || !old.some((r) => r.readable)} />
        </div>
      </Panel>
      <Panel title="Keys" eyebrow={`${rows.length} compan${rows.length === 1 ? "y" : "ies"}`}>
        {rows.length === 0 ? (
          <p className="font-body text-[13px] text-muted">No company has saved its own SAM.gov key; every company uses FORGE&apos;s shared key.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="aur-table">
              <thead>
                <tr>
                  <th>Company</th>
                  <th>Key</th>
                  <th>SAM.gov said</th>
                  <th>Set</th>
                  <th>Encrypted with</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.organizationId} className="align-top">
                    <td className="text-text">{r.organizationName}</td>
                    <td className="font-mono text-[12px] text-text">••••{r.last4}</td>
                    <td className={r.status === "ok" ? "text-text" : "text-rose"}>
                      {STATUS[r.status] ?? r.status} · {day(r.statusAt)}
                      {r.verifiedAt ? <span className="block text-muted">accepted {day(r.verifiedAt)}</span> : null}
                    </td>
                    <td className="text-muted">
                      {day(r.setAt)}
                      {r.setBy ? <span className="block">{r.setBy}</span> : null}
                    </td>
                    <td className={`font-mono text-[12px] ${!r.readable ? "text-rose" : r.current ? "text-muted" : "text-gold"}`}>
                      {r.keyId}
                      {r.decrypts === "missing_entry"
                        ? " · not in this keyring"
                        : r.decrypts === "wrong_entry"
                          ? " · doesn't decrypt with this entry (check its value)"
                          : r.decrypts === "damaged"
                            ? " · damaged"
                            : r.current
                              ? ""
                              : " · older entry"}
                    </td>
                    <td className="text-right">
                      <RemoveKeyButton organizationId={r.organizationId} organizationName={r.organizationName} last4={r.last4} setAt={r.setAt.toISOString()} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}
