import { Panel } from "@/components/ui/Panel";
import { requireCurrentOrg } from "@/lib/auth-helpers";
import { listInboundEmails, type InboundEmailView } from "@/lib/inbound-email";
import { safeQuery } from "@/lib/schema-resilience";
import { ReadBidsButton } from "./ReadBidsButton";

const KIND: Record<InboundEmailView["kind"], { label: string; cls: string }> = {
  bid_alert: { label: "Bid alert", cls: "border-cobalt/40 bg-cobalt/10 text-text" },
  account: { label: "Account", cls: "border-gold/40 bg-gold/10 text-text" },
  other: { label: "Other", cls: "border-layer/15 bg-layer/[0.04] text-muted" },
  unknown: { label: "Unread", cls: "border-layer/15 bg-layer/[0.04] text-muted" },
};

/**
 * BL-SCOUT-INBOX — every email the portals sent to the company's bid
 * address, newest first: who sent it (and whether their domain vouched
 * for it), the subject, what kind of email it is and, opened, its text
 * and links. Account emails (registration, verification, password) carry
 * the links an admin needs to finish signing up on a portal, so the inbox
 * is for org admins.
 */
export async function BidInbox({ isAdmin }: { isAdmin: boolean }) {
  const { organizationId } = await requireCurrentOrg();
  if (!isAdmin) {
    return (
      <Panel title="Bid inbox" eyebrow="Org admins">
        <p className="font-body text-[13px] text-muted">The emails portals send to your bid address are listed here for org admins; the bids in them come to the All tab as finds.</p>
      </Panel>
    );
  }
  const emails = await safeQuery(() => listInboundEmails(organizationId, 50), [], { tag: "scout.inbox" });
  const accounts = emails.filter((e) => e.kind === "account").length;
  return (
    <Panel title="Bid inbox" eyebrow={emails.length === 0 ? "Nothing received yet" : `${emails.length} latest${accounts ? ` · ${accounts} portal account email${accounts === 1 ? "" : "s"}` : ""}`}>
      {emails.length === 0 ? (
        <p className="font-body text-[13px] text-muted">When a portal sends a bid alert or an account email to your bid address, it appears here within a minute.</p>
      ) : (
        <ul>
          {emails.map((e) => (
            <li key={e.id} className="border-b border-layer/10 py-2 last:border-b-0">
              <details>
                <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1">
                  <span className={`inline-block w-[5.5rem] rounded border px-1.5 py-0.5 text-center font-mono text-[10px] uppercase tracking-widest ${KIND[e.kind].cls}`}>{KIND[e.kind].label}</span>
                  <span className="min-w-0 flex-1 truncate font-display text-[14px] text-text">{e.subject || "(no subject)"}</span>
                  <span className="font-mono text-[11px] text-muted" title={e.authenticated ? "The sender's domain vouched for this email (SPF or DKIM passed)" : "The sender's domain did not vouch for this email: check it before acting on it"}>
                    {e.fromName || e.fromAddress}
                    {e.authenticated ? "" : " · unverified sender"}
                  </span>
                  <span className="font-mono text-[11px] text-muted">{statusLine(e)}</span>
                  <span className="font-mono text-[11px] text-muted">{new Date(e.receivedAt).toLocaleString()}</span>
                </summary>
                <div className="mt-2 pl-0 md:pl-[6.5rem]">
                  <p className="font-mono text-[11px] text-muted">
                    From {e.fromAddress}
                    {e.attachments ? ` · ${e.attachments} attachment${e.attachments === 1 ? "" : "s"}` : ""}
                  </p>
                  {e.error ? <p className="mt-1 font-body text-[12px] text-gold">{e.error}</p> : null}
                  {e.status !== "parsed" || e.kind === "account" ? (
                    <div className="mt-2">
                      <ReadBidsButton emailId={e.id} label={e.status === "failed" ? "Read it again" : "Read the bids"} />
                    </div>
                  ) : null}
                  {e.preview ? <p className="mt-1 whitespace-pre-line font-body text-[12px] leading-[1.5] text-muted">{e.preview}</p> : null}
                  {e.links.length > 0 ? (
                    <ul className="mt-2 flex flex-col gap-0.5">
                      {e.links.slice(0, 10).map((l) => (
                        <li key={l} className="truncate font-mono text-[11px]">
                          <a href={l} target="_blank" rel="noopener noreferrer nofollow" className="text-cobalt hover:underline">
                            {l}
                          </a>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              </details>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/** What became of the email: its bids read, held for an admin, failed or still being read. */
function statusLine(e: InboundEmailView): string {
  if (e.status === "parsed") return e.kind === "bid_alert" ? `${e.bidsFound} bid${e.bidsFound === 1 ? "" : "s"} read` : "nothing to read";
  if (e.status === "failed") return "not read";
  if (e.kind === "account") return "for an admin";
  return e.error ? "held" : "being read";
}
