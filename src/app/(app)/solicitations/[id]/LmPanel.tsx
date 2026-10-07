import { Panel } from "@/components/ui/Panel";
import { describeSource, type RequirementSource } from "@/lib/requirement-provenance";
import { basisLabel, type LmStructure } from "@/lib/solicitation-lm";

/**
 * BL-AIX Phase 2b — Sections L and M as the team works from them: the
 * volumes with their page limits, the format and submission rules, and
 * the evaluation factors in order with their importance. Each item says
 * where it sits in the document; one whose wording could not be found
 * there is marked, as requirements are.
 */
export function LmPanel({ lm }: { lm: LmStructure }) {
  const l = lm.sectionL;
  const m = lm.sectionM;
  if (!l && !m) return null;
  return (
    <Panel title="Instructions and evaluation" eyebrow="Sections L and M, item by item">
      <div className="flex flex-col gap-5">
        {l ? (
          <div className="flex flex-col gap-3">
            <h3 className="font-mono text-[10px] uppercase tracking-[0.2em] text-subtle">Section L · what to submit</h3>
            {l.volumes.length > 0 ? (
              <table className="w-full font-body text-[12px]">
                <thead className="font-mono text-[10px] uppercase tracking-[0.2em] text-subtle">
                  <tr>
                    <th className="py-1 text-left">Volume</th>
                    <th className="py-1 text-right">Pages</th>
                    <th className="py-1 pl-3 text-left">Contents</th>
                  </tr>
                </thead>
                <tbody>
                  {l.volumes.map((v, i) => (
                    <tr key={i} className="border-t border-layer/10 align-top">
                      <td className="py-1.5 text-text">
                        {v.name}
                        <Where source={v.source} />
                      </td>
                      <td className="py-1.5 text-right tabular-nums text-text" title={v.pageLimitText || undefined}>
                        {v.pageLimit ?? "—"}
                      </td>
                      <td className="py-1.5 pl-3 text-muted">{v.contents || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
            <RuleList title="Format" rules={l.formatRules} />
            <RuleList title="Submission" rules={l.submission} />
          </div>
        ) : null}
        {m ? (
          <div className="flex flex-col gap-2">
            <h3 className="font-mono text-[10px] uppercase tracking-[0.2em] text-subtle">Section M · how it is evaluated</h3>
            <p className="font-body text-[12px] text-text" title={m.basisQuote || undefined}>
              Award basis: <strong>{basisLabel(m.basis)}</strong>
            </p>
            {m.relativeImportance ? (
              <p className="font-body text-[12px] italic leading-relaxed text-muted">&ldquo;{m.relativeImportance}&rdquo;</p>
            ) : null}
            {m.factors.length > 0 ? (
              <ol className="flex list-decimal flex-col gap-1.5 pl-5 font-body text-[12px] text-text">
                {m.factors.map((f, i) => (
                  <li key={i}>
                    <span className="font-medium">{f.name}</span>
                    {f.importance ? <span className="text-muted"> · {f.importance}</span> : null}
                    <Where source={f.source} />
                    {f.subfactors.length > 0 ? (
                      <ul className="mt-0.5 flex list-[lower-alpha] flex-col gap-0.5 pl-5 text-muted">
                        {f.subfactors.map((sf, j) => (
                          <li key={j}>
                            {sf.name}
                            {sf.importance ? ` · ${sf.importance}` : ""}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                ))}
              </ol>
            ) : null}
          </div>
        ) : null}
      </div>
    </Panel>
  );
}

function RuleList({ title, rules }: { title: string; rules: { rule: string; source?: RequirementSource }[] }) {
  if (rules.length === 0) return null;
  return (
    <div>
      <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-subtle">{title}</div>
      <ul className="mt-1 flex flex-col gap-0.5 font-body text-[12px] text-text">
        {rules.map((r, i) => (
          <li key={i}>
            {r.rule}
            <Where source={r.source} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function Where({ source }: { source?: RequirementSource }) {
  if (!source) return null;
  const where = describeSource(source);
  if (source.quote === "none") {
    return (
      <span
        className="ml-2 rounded border border-gold/40 bg-gold/10 px-1 py-0.5 font-mono text-[8px] uppercase tracking-widest text-gold"
        title="This wording was not found in the document; check it against the source."
      >
        not found in source
      </span>
    );
  }
  return where ? <span className="ml-2 font-mono text-[10px] tracking-widest text-subtle">{where}</span> : null;
}
