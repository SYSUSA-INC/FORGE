/**
 * BL-SCOUT-FIT — how well a find matches what the company can do.
 *
 * Pure: no database, no network. The scout builds a tenant's capability
 * cards (src/lib/scout.ts), embeds them and each find's text, and this
 * file turns the cosine similarities into a band and a score adjustment.
 * Docs: docs/design/BL-SCOUT-FIT.md.
 */

export type FitCardKind = "won" | "proven" | "claimed" | "gap";

/** One thing the company does (or admits it does not): its text, and how strong the evidence is. */
export type FitCard = { name: string; text: string; kind: FitCardKind };

export type CapabilityBand = "strong" | "related" | "weak";

/** Decision 5: shipped defaults, shown on every find so they can be tuned. */
export const STRONG_SIMILARITY = 0.55;
export const WEAK_SIMILARITY = 0.35;

/** Decision 3: how a band moves `scoutFit`'s score. */
export const BAND_ADJUSTMENT: Record<CapabilityBand, number> = { strong: 20, related: 5, weak: -20 };

export type CapabilityFit = {
  band: CapabilityBand;
  /** 0..100: the best capability card's cosine similarity. */
  score: number;
  /** "Closest: Cloud migration (proven), similarity 0.71", shown on the find. */
  basis: string;
};

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
}

const KIND_LABEL: Record<FitCardKind, string> = { won: "won", proven: "proven", claimed: "claimed", gap: "a gap you named" };

/**
 * The band for one find. `vec` is the find's embedding, `cards` the
 * tenant's cards and `cardVecs` their embeddings, in the same order.
 * A card of kind `gap` never raises the band: a find closest to a stated
 * gap is held to Related at best (decision 7). Returns null when there is
 * nothing to compare with.
 */
export function capabilityFitFor(vec: number[], cards: FitCard[], cardVecs: number[][]): CapabilityFit | null {
  let best = -1;
  let bestCard: FitCard | null = null;
  let gap = -1;
  for (let i = 0; i < cards.length; i++) {
    const card = cards[i]!;
    const v = cardVecs[i];
    if (!v) continue;
    const sim = cosine(vec, v);
    if (card.kind === "gap") gap = Math.max(gap, sim);
    else if (sim > best) {
      best = sim;
      bestCard = card;
    }
  }
  if (!bestCard) return null;
  // Strong needs evidence: a claimed (unproven or partial) capability, however close, is Related.
  const backed = cards.some((c, i) => (c.kind === "proven" || c.kind === "won") && cardVecs[i] && cosine(vec, cardVecs[i]!) >= STRONG_SIMILARITY);
  let band: CapabilityBand = best >= STRONG_SIMILARITY ? (backed ? "strong" : "related") : best >= WEAK_SIMILARITY ? "related" : "weak";
  let basis = `Closest: ${bestCard.name.slice(0, 80)} (${KIND_LABEL[bestCard.kind]}), similarity ${best.toFixed(2)}`;
  if (band === "strong" && gap >= STRONG_SIMILARITY && gap > best) {
    band = "related";
    basis += `; closer to a gap you named (${gap.toFixed(2)}), so held to related`;
  }
  return { band, score: Math.max(0, Math.min(100, Math.round(best * 100))), basis };
}

/** `scoutFit`'s score moved by the band, kept within 0..100. */
export function applyCapabilityBand(score: number, band: CapabilityBand | null): number {
  return Math.max(0, Math.min(100, score + (band ? BAND_ADJUSTMENT[band] : 0)));
}

const BAND_SIGNAL: Record<CapabilityBand, string> = {
  strong: "Strong capability fit",
  related: "Related to your capabilities",
  weak: "Weak capability fit",
};

/** The line the find's signals list gains. */
export function capabilitySignal(fit: CapabilityFit): string {
  return `${BAND_SIGNAL[fit.band]}. ${fit.basis}`;
}

/** Signals from an earlier scoring, without the capability line, so re-scoring never doubles it. */
export function withoutCapabilitySignal(signals: string[]): string[] {
  return signals.filter((s) => !Object.values(BAND_SIGNAL).some((p) => s.startsWith(`${p}.`)));
}

/** The text a find is embedded as. */
export function findText(f: { title: string; agency: string; description: string }): string {
  return `${f.title}\n${f.agency}\n${f.description}`.slice(0, 6000);
}

export type CardSources = {
  /** The approved company model, when there is one. */
  model: {
    summary: string;
    capabilities: { name: string; description: string; strength: "proven" | "unproven" | "partial" }[];
    naicsWork: { code: string; whatWeDo: string }[];
    gaps: string[];
  } | null;
  /** Fallback when there is no model: capability and past-performance entries. */
  entries: { title: string; text: string }[];
  pastPerformance: { customer: string; contract: string; description: string }[];
  /** Pursuits the company won. */
  won: { title: string; agency: string }[];
};

export const MAX_FIT_CARDS = 60;

/** Decision 2: the approved model, past performance and won pursuits as the strongest evidence; the entries when there is no model. */
export function buildFitCards(src: CardSources): FitCard[] {
  const cards: FitCard[] = [];
  const clean = (s: string) => s.replace(/\s+/g, " ").trim();
  if (src.model) {
    if (src.model.summary) cards.push({ name: "Company summary", text: clean(src.model.summary), kind: "claimed" });
    for (const c of src.model.capabilities) {
      cards.push({ name: c.name, text: clean(`${c.name}. ${c.description}`), kind: c.strength === "proven" ? "proven" : "claimed" });
    }
    for (const n of src.model.naicsWork) cards.push({ name: `NAICS ${n.code} work`, text: clean(n.whatWeDo), kind: "claimed" });
    for (const g of src.model.gaps) cards.push({ name: g.slice(0, 80), text: clean(g), kind: "gap" });
  } else {
    for (const e of src.entries) cards.push({ name: e.title, text: clean(`${e.title}. ${e.text}`), kind: "claimed" });
  }
  for (const p of src.pastPerformance) {
    const name = `${p.customer} ${p.contract}`.trim() || "Past performance";
    cards.push({ name, text: clean(`${name}. ${p.description}`), kind: "proven" });
  }
  for (const w of src.won) cards.push({ name: w.title, text: clean(`${w.title}. ${w.agency}`), kind: "won" });
  return cards.filter((c) => c.text.length >= 6).slice(0, MAX_FIT_CARDS);
}
