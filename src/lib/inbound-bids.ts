/**
 * BL-SCOUT-INBOX phase 2 — the bids in an email a portal sent the company
 * become Scout finds, read by a durable job (`inbound_email_parse`).
 *
 * An email whose sender's domain did not vouch for it (no SPF or DKIM
 * pass) is held: an org admin reads it from the Bid inbox if it is real.
 * The AI reading counts against the plan's AI switch and monthly requests
 * like the scout's review; in stub mode a bid alert is read as one bid
 * named by its subject. Each bid becomes a find (source `portal_email`)
 * scored like a SAM.gov find; the nightly scout's AI review takes it with
 * the rest. A bid already found or in the pipeline (same solicitation
 * number) is skipped, and reading an email again adds nothing. Every query
 * carries organizationId; callers own auth. Server-only.
 */
import "server-only";

import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { inboundEmails, opportunities, organizations, scoutCandidates, scoutProfiles, solicitations } from "@/db/schema";
import { completeStructuredForTenant, getAIProviderStatus } from "@/lib/ai";
import { recordAudit } from "@/lib/audit-log";
import { bidNoticeId, buildInboundBidsPrompt, cleanBids, inboundBidsSchema, stubBids, type InboundBids } from "@/lib/inbound-bids-logic";
import { classifyInbound, emailLinks, emailText, postmarkInboundSchema, type PostmarkInbound } from "@/lib/inbound-email-logic";
import { enqueueJob, runDurable } from "@/lib/jobs";
import { log } from "@/lib/log";
import { naicsCodeOf, scoutCodes, scoutFit, solicitationKey } from "@/lib/scout-logic";
import { getStorageProvider } from "@/lib/storage";
import { enforceQuota, ensureFeature, FeatureGateError, QuotaExceededError, refundQuota, enforceStorageQuota } from "@/lib/subscription-gates";

type Actor = { userId: string | null; email?: string | null };

export type ReadResult = { ok: true; bids: number; created: number } | { ok: false; error: string; held?: true };

const HELD = "Held: the sender's domain did not vouch for this email (no SPF or DKIM pass). Read it here if it is real.";

/** The raw payload of a stored email, from the company's storage. */
async function loadPayload(organizationId: string, storagePath: string): Promise<PostmarkInbound | null> {
  if (!storagePath.startsWith(`org/${organizationId}/inbound/`)) return null;
  const obj = await getStorageProvider().get(storagePath);
  if (!obj) return null;
  const parsed = postmarkInboundSchema.safeParse(JSON.parse(new TextDecoder().decode(obj.bytes)));
  return parsed.success ? parsed.data : null;
}

/**
 * Read one email's bids into Scout finds. `force` is an org admin's
 * "Read the bids" in the Bid inbox: an unverified or account email is
 * read anyway, and a failed one again. Throws on an AI failure the job
 * may retry.
 */
export async function readInboundEmail(input: { organizationId: string; emailId: string; actor?: Actor; force?: boolean }): Promise<ReadResult> {
  const { organizationId } = input;
  const [email] = await db
    .select()
    .from(inboundEmails)
    .where(and(eq(inboundEmails.id, input.emailId), eq(inboundEmails.organizationId, organizationId)))
    .limit(1);
  if (!email) return { ok: false, error: "Email not found." };
  if (email.status === "parsed" && !input.force) return { ok: true, bids: email.bidsFound, created: 0 };
  const mark = (set: Partial<typeof inboundEmails.$inferInsert>) =>
    db.update(inboundEmails).set(set).where(and(eq(inboundEmails.id, email.id), eq(inboundEmails.organizationId, organizationId)));
  if (!email.authenticated && !input.force) {
    await mark({ error: HELD });
    return { ok: false, error: HELD, held: true };
  }
  const p = await loadPayload(organizationId, email.storagePath);
  if (!p) {
    await mark({ status: "failed", error: "The stored email could not be read." });
    return { ok: false, error: "The stored email could not be read." };
  }
  const text = emailText(p);
  const links = emailLinks(p);

  let read: InboundBids;
  if (getAIProviderStatus().active.name === "stub") {
    read = stubBids({ subject: p.Subject, kind: classifyInbound(p.Subject, text), links });
  } else {
    try {
      await ensureFeature(organizationId, "aiAutoDraft");
      await enforceQuota(organizationId, "aiRequestsPerMonth");
    } catch (err) {
      if (err instanceof FeatureGateError || err instanceof QuotaExceededError) {
        await mark({ status: "failed", error: `Not read: ${err.message}` });
        return { ok: false, error: err.message };
      }
      throw err;
    }
    const prompt = buildInboundBidsPrompt({ from: email.fromAddress, subject: p.Subject, text, links });
    const ai = await completeStructuredForTenant({
      organizationId,
      feature: "inbound_bids",
      schema: inboundBidsSchema,
      toolName: "record_inbound_bids",
      toolDescription: "Record what the email is and the bids it announces.",
      system: prompt.system,
      messages: prompt.messages,
      maxTokens: 4000,
      temperature: 0,
      cacheSystem: true,
    }).catch(async (err) => {
      await refundQuota(organizationId, "aiRequestsPerMonth").catch(() => undefined);
      throw err;
    });
    if (!ai.data) {
      await refundQuota(organizationId, "aiRequestsPerMonth").catch(() => undefined);
      throw new Error(`The AI's reading could not be used: ${String(ai.parseError ?? "no data").slice(0, 300)}`);
    }
    read = ai.data;
  }

  const bids = read.kind === "bid_alert" ? cleanBids(read.bids) : [];
  const created = await createFinds({ organizationId, emailId: email.id, receivedAt: email.receivedAt, bids });
  await mark({ status: "parsed", kind: read.kind, bidsFound: bids.length, error: "" });
  await recordAudit({
    organizationId,
    actor: input.actor ?? { userId: null },
    action: "inbound_email.read",
    resourceType: "inbound_email",
    resourceId: email.id,
    metadata: { kind: read.kind, bids: bids.length, created, forced: !!input.force },
  });
  return { ok: true, bids: bids.length, created };
}

const keyOf = (col: typeof scoutCandidates.solicitationNumber | typeof opportunities.solicitationNumber): SQL<string> =>
  sql<string>`upper(regexp_replace(${col}, '[^A-Za-z0-9]', '', 'g'))`;

/** The bids as Scout finds, scored like the scout's; one already found or in the pipeline is skipped. */
async function createFinds(input: { organizationId: string; emailId: string; receivedAt: Date; bids: ReturnType<typeof cleanBids> }): Promise<number> {
  const { organizationId } = input;
  if (input.bids.length === 0) return 0;
  const keys = [...new Set(input.bids.map((b) => solicitationKey(b.solicitationNumber)).filter((k): k is string => !!k))];
  const known = new Set<string>();
  if (keys.length > 0) {
    const [c, o] = await Promise.all([
      db.select({ k: keyOf(scoutCandidates.solicitationNumber) }).from(scoutCandidates).where(and(eq(scoutCandidates.organizationId, organizationId), inArray(keyOf(scoutCandidates.solicitationNumber), keys))),
      db.select({ k: keyOf(opportunities.solicitationNumber) }).from(opportunities).where(and(eq(opportunities.organizationId, organizationId), inArray(keyOf(opportunities.solicitationNumber), keys))),
    ]);
    for (const r of [...c, ...o]) known.add(r.k);
  }
  const [org] = await db
    .select({ primary: organizations.primaryNaics, list: organizations.naicsList, socio: organizations.socioEconomic })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  // The scout's own criteria (read here, not through scout.ts, which files a find's attachments from this module).
  const [profile] = await db.select({ keywords: scoutProfiles.keywords, extraNaics: scoutProfiles.extraNaics }).from(scoutProfiles).where(eq(scoutProfiles.organizationId, organizationId)).limit(1);
  const codes = scoutCodes({ extra: profile?.extraNaics ?? [], primary: org?.primary ?? "", list: org?.list ?? [] }, 10);
  const now = new Date();
  const rows = input.bids
    .map((b, i) => ({ b, i }))
    .filter(({ b }) => {
      const k = solicitationKey(b.solicitationNumber);
      return !k || !known.has(k);
    })
    .map(({ b, i }) => {
      const responseDueAt = b.responseDue ? new Date(`${b.responseDue}T23:59:00Z`) : null;
      const fit = scoutFit(
        { source: "portal_email", title: b.title, description: b.summary, agency: b.agency, naicsCode: b.naicsCode, setAside: b.setAside, responseDueAt },
        { primaryNaics: naicsCodeOf(org?.primary ?? ""), naicsList: codes.all, socio: org?.socio ?? null, keywords: profile?.keywords ?? [], recompete: null, customer: null, now },
      );
      return {
        organizationId,
        source: "portal_email" as const,
        inboundEmailId: input.emailId,
        noticeId: bidNoticeId(input.emailId, i),
        title: b.title,
        agency: b.agency,
        solicitationNumber: b.solicitationNumber,
        noticeType: "Portal alert",
        naicsCode: b.naicsCode,
        setAside: b.setAside,
        postedAt: input.receivedAt,
        responseDueAt,
        description: b.summary,
        uiLink: b.url,
        matchedKeyword: fit.keyword?.term.slice(0, 200) ?? "",
        fitScore: fit.score,
        signals: fit.signals,
      };
    });
  if (rows.length === 0) return 0;
  const inserted = await db.insert(scoutCandidates).values(rows).onConflictDoNothing().returning({ id: scoutCandidates.id });
  return inserted.length;
}

/** After an email is stored: read it in the background, unless it is a portal account email. */
export async function queueInboundRead(organizationId: string, emailId: string, kind: string): Promise<void> {
  if (kind === "account") return;
  await runDurable("[inbound-email] read", { organizationId, kind: "inbound_email_parse", resourceId: emailId });
}

/** For the job runner. */
export async function handleInboundEmailParse(job: { organizationId: string; resourceId: string }): Promise<void> {
  const res = await readInboundEmail({ organizationId: job.organizationId, emailId: job.resourceId });
  if (!res.ok && !res.held) log.warn("[inbound-email]", "not read", { organizationId: job.organizationId, emailId: job.resourceId, error: res.error });
}

/**
 * BL-SCOUT-INBOX — when a find read from a portal email is added to the
 * pipeline, the email's attachments go with it: each is filed as a
 * solicitation on the new opportunity and read like an upload. Ten files
 * at most; the plan's storage limit applies. Best effort: a file that
 * can't be filed is logged, never blocking the opportunity.
 */
export async function fileInboundAttachments(input: { organizationId: string; emailId: string; opportunityId: string; userId: string | null }): Promise<number> {
  const { organizationId } = input;
  const [email] = await db
    .select({ storagePath: inboundEmails.storagePath })
    .from(inboundEmails)
    .where(and(eq(inboundEmails.id, input.emailId), eq(inboundEmails.organizationId, organizationId)))
    .limit(1);
  if (!email) return 0;
  const p = await loadPayload(organizationId, email.storagePath);
  const files = (p?.Attachments ?? []).filter((a) => typeof (a as { Content?: unknown }).Content === "string").slice(0, 10);
  let filed = 0;
  for (const a of files) {
    try {
      const bytes = Uint8Array.from(Buffer.from(String((a as { Content?: string }).Content), "base64"));
      if (bytes.length === 0) continue;
      await enforceStorageQuota(organizationId, bytes.length);
      const id = crypto.randomUUID();
      const name = String(a.Name || "attachment").replace(/[\u0000-\u001f/\\]+/g, "_").replace(/^\.+/, "_").slice(0, 150) || "attachment";
      const storagePath = `org/${organizationId}/solicitation/${id}/${name}`;
      const contentType = String(a.ContentType || "application/octet-stream");
      await getStorageProvider().put({ key: storagePath, bytes, contentType });
      await db.insert(solicitations).values({
        id,
        organizationId,
        title: name.replace(/\.[a-z0-9]{1,5}$/i, ""),
        fileName: name,
        fileSize: bytes.length,
        contentType,
        storagePath,
        parseStatus: "uploaded",
        source: "portal-email",
        opportunityId: input.opportunityId,
        uploadedByUserId: input.userId,
      });
      await enqueueJob({ organizationId, kind: "solicitation_parse", resourceId: id, requestedByUserId: input.userId });
      filed++;
    } catch (err) {
      log.warn("[inbound-email]", "attachment not filed", { organizationId, emailId: input.emailId, error: err });
      if (err instanceof QuotaExceededError) break;
    }
  }
  return filed;
}

