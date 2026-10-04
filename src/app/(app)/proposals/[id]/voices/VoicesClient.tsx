"use client";

import { useState } from "react";
import { Panel } from "@/components/ui/Panel";
import type { ProposalAuthorVoice } from "@/lib/voice";
import { authorComparisonSummary, authorDifferences } from "@/lib/voice-logic";

const pct = (n: number) => `${Math.round(n * 100)}%`;

/**
 * BL-FB-GEN-VOICE Slice 3 — the authors on this proposal side by side,
 * and a pairwise comparison: where their sections read differently.
 */
export function VoicesClient({ authors }: { authors: ProposalAuthorVoice[] }) {
  const measured = authors.filter((a) => a.metrics);
  const [aId, setAId] = useState(measured[0]?.userId ?? "");
  const [bId, setBId] = useState(measured[1]?.userId ?? "");
  const a = measured.find((x) => x.userId === aId);
  const b = measured.find((x) => x.userId === bId);
  const diffs = a && b && a.userId !== b.userId ? authorDifferences(a.metrics!, b.metrics!) : [];

  if (authors.length === 0) {
    return (
      <Panel title="Voices" eyebrow="Authors on this proposal">
        <p className="font-body text-[13px] text-muted">No section has an author yet. Assign authors on the Sections tab to compare how they write.</p>
      </Panel>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Panel title="Voices" eyebrow="Authors on this proposal">
        <p className="mb-3 font-body text-[12px] leading-relaxed text-muted">
          How each author writes in their sections of this proposal. An author with under 60 words here isn&apos;t measured yet.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-left font-body text-[13px]">
            <thead>
              <tr className="font-mono text-[10px] uppercase tracking-wider text-muted">
                <th className="py-2 pr-3">Author</th>
                <th className="py-2 pr-3 text-right">Sections</th>
                <th className="py-2 pr-3 text-right">Words</th>
                <th className="py-2 pr-3 text-right">Sentence</th>
                <th className="py-2 pr-3 text-right">Passive</th>
                <th className="py-2 pr-3 text-right">Long words</th>
                <th className="py-2 pr-3 text-right">We / you per 1k</th>
                <th className="py-2">Traits</th>
              </tr>
            </thead>
            <tbody>
              {authors.map((x) => (
                <tr key={x.userId} className="border-t border-layer/10 align-top">
                  <td className="py-2 pr-3 text-text">{x.name}</td>
                  <td className="py-2 pr-3 text-right font-mono text-[12px] text-muted">{x.sections}</td>
                  <td className="py-2 pr-3 text-right font-mono text-[12px] text-muted">{x.words.toLocaleString()}</td>
                  {x.metrics ? (
                    <>
                      <td className="py-2 pr-3 text-right font-mono text-[12px] text-text">{Math.round(x.metrics.avgSentenceLength)} words</td>
                      <td className="py-2 pr-3 text-right font-mono text-[12px] text-text">{pct(x.metrics.passiveRate)}</td>
                      <td className="py-2 pr-3 text-right font-mono text-[12px] text-text">{pct(x.metrics.longWordRate)}</td>
                      <td className="py-2 pr-3 text-right font-mono text-[12px] text-text">
                        {x.metrics.wePerThousand} / {x.metrics.youPerThousand}
                      </td>
                      <td className="py-2 font-body text-[12px] text-muted">{x.traits.slice(0, 3).join(" · ")}</td>
                    </>
                  ) : (
                    <td colSpan={5} className="py-2 font-mono text-[11px] text-muted">
                      Not enough text yet
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="Compare two authors" eyebrow="Where an evaluator would notice the change of hands">
        {measured.length < 2 ? (
          <p className="font-body text-[13px] text-muted">Two authors need at least 60 words each on this proposal to compare.</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <select className="aur-input w-auto" value={aId} onChange={(e) => setAId(e.target.value)} aria-label="First author">
                {measured.map((x) => (
                  <option key={x.userId} value={x.userId}>
                    {x.name}
                  </option>
                ))}
              </select>
              <span className="font-mono text-[11px] text-muted">vs</span>
              <select className="aur-input w-auto" value={bId} onChange={(e) => setBId(e.target.value)} aria-label="Second author">
                {measured.map((x) => (
                  <option key={x.userId} value={x.userId}>
                    {x.name}
                  </option>
                ))}
              </select>
            </div>
            {a && b && a.userId !== b.userId ? (
              <>
                <p className={`mt-3 font-body text-[13px] ${diffs.length === 0 ? "text-emerald" : "text-text"}`}>{authorComparisonSummary(a.name, b.name, diffs)}</p>
                {diffs.length > 0 ? (
                  <>
                    <table className="mt-3 w-full text-left font-body text-[13px]">
                      <thead>
                        <tr className="font-mono text-[10px] uppercase tracking-wider text-muted">
                          <th className="py-2 pr-3" />
                          <th className="py-2 pr-3">{a.name}</th>
                          <th className="py-2">{b.name}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {diffs.map((d) => (
                          <tr key={d.kind} className="border-t border-layer/10">
                            <td className="py-2 pr-3 text-muted">{d.label}</td>
                            <td className="py-2 pr-3 font-mono text-[12px] text-text">{d.a}</td>
                            <td className="py-2 font-mono text-[12px] text-text">{d.b}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <p className="mt-3 font-mono text-[10px] text-muted">
                      To read as one voice, agree these points in the house style (Settings → House style, or the volume&apos;s own rules) — the drafter and chat then follow it for every author.
                    </p>
                  </>
                ) : null}
              </>
            ) : (
              <p className="mt-3 font-mono text-[11px] text-muted">Pick two different authors.</p>
            )}
          </>
        )}
      </Panel>
    </div>
  );
}
