import "server-only";
import { noticeStore } from "@/lib/sam-notice-store";
import { noticeDescriptionUrl, readNoticeDescriptions } from "@/lib/samgov";
import type { SamCredential } from "@/lib/samgov-key";
import type { DescriptionState } from "@/lib/samgov-match";

/**
 * BL-STAB-10b — notices' descriptions, from FORGE's copy of SAM.gov's
 * nightly file first and from SAM.gov live (one request each, in the
 * order given, at most `liveBudget`) for the rest; with no key (`cred`
 * null) only the copy answers. A description cut at 32,000 characters
 * comes back `partial`. `liveFirst` (Check more: notices the copy couldn't
 * decide) reads every notice live and falls back to the copy only when
 * SAM.gov doesn't answer — as `partial`, since the copy runs paragraphs
 * together and a miss in it proves nothing. Never writes.
 */
export async function descriptionsFor(
  cred: SamCredential | null,
  noticeIds: string[],
  liveBudget: number,
  opts: { liveFirst?: boolean } = {},
): Promise<Map<string, DescriptionState>> {
  const out = new Map<string, DescriptionState>();
  const stored = await (await noticeStore()).lookup(noticeIds);
  const live: { noticeId: string; description: string }[] = [];
  for (const id of noticeIds) {
    const s = stored.get(id.toLowerCase());
    if (s && "text" in s) out.set(id, s.partial || opts.liveFirst ? { text: s.text, partial: true } : { text: s.text });
    else if (s && "none" in s && !opts.liveFirst) out.set(id, { none: true });
    else out.set(id, { unread: true });
    const url = noticeDescriptionUrl(id);
    if (url && (opts.liveFirst || !s || "link" in s)) live.push({ noticeId: id, description: url });
  }
  if (cred && live.length > 0 && liveBudget > 0) {
    for (const [id, d] of await readNoticeDescriptions(cred, live, liveBudget)) {
      if (!("unread" in d)) out.set(id, d);
    }
  }
  return out;
}
