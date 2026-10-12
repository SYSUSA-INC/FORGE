import "server-only";
import { noticeStore } from "@/lib/sam-notice-store";
import { noticeDescriptionUrl, readNoticeDescriptions } from "@/lib/samgov";
import type { SamCredential } from "@/lib/samgov-key";
import type { DescriptionState } from "@/lib/samgov-match";

/**
 * BL-STAB-10b — notices' descriptions, from FORGE's copy of SAM.gov's
 * nightly file first and from SAM.gov live (one request each, newest
 * first as given, at most `liveBudget`) for the rest. With no key (`cred`
 * null) only the copy answers. A description cut at 32,000 characters is
 * read live only when `liveForTruncated` asks (Check more); otherwise, or
 * when the live read fails, it comes back `partial`. Never writes.
 */
export async function descriptionsFor(
  cred: SamCredential | null,
  noticeIds: string[],
  liveBudget: number,
  opts: { liveForTruncated?: boolean } = {},
): Promise<Map<string, DescriptionState>> {
  const out = new Map<string, DescriptionState>();
  const stored = await (await noticeStore()).lookup(noticeIds);
  const live: { noticeId: string; description: string }[] = [];
  for (const id of noticeIds) {
    const s = stored.get(id.toLowerCase());
    if (s && "none" in s) out.set(id, { none: true });
    else if (s && !s.partial) out.set(id, { text: s.text });
    else {
      out.set(id, s ? { text: s.text, partial: true } : { unread: true });
      const url = noticeDescriptionUrl(id);
      if (url && (!s || opts.liveForTruncated)) live.push({ noticeId: id, description: url });
    }
  }
  if (cred && live.length > 0 && liveBudget > 0) {
    for (const [id, d] of await readNoticeDescriptions(cred, live, liveBudget)) {
      if (!("unread" in d)) out.set(id, d);
    }
  }
  return out;
}
