"use client";

import { Panel } from "@/components/ui/Panel";
import type { IntegrationStatus } from "@/lib/settings-status";

const CATEGORY_LABELS: Record<IntegrationStatus["category"], string> = {
  data: "Data sources",
  ai: "AI providers",
  output: "Document output",
  email: "Email",
};

const CATEGORY_ORDER: IntegrationStatus["category"][] = [
  "data",
  "ai",
  "output",
  "email",
];

export function IntegrationsTab({
  integrations,
}: {
  integrations: IntegrationStatus[];
}) {
  const liveCount = integrations.filter((i) => i.configured).length;

  return (
    <>
      <Panel
        title="Integrations"
        eyebrow={`${liveCount} of ${integrations.length} configured`}
      >
        <p className="font-body text-[13px] leading-relaxed text-muted">
          Status of every external service FORGE talks to. These are
          platform-level credentials (Vercel env vars) — features
          gracefully degrade to stub mode when a provider isn&apos;t
          configured, and the corresponding UI surfaces a banner so
          you always know what&apos;s live versus mocked.
        </p>
      </Panel>

      {CATEGORY_ORDER.map((cat) => {
        const items = integrations.filter((i) => i.category === cat);
        if (items.length === 0) return null;
        return (
          <Panel key={cat} title={CATEGORY_LABELS[cat]}>
            <ul className="space-y-2">
              {items.map((i) => (
                <li
                  key={i.key}
                  className="aur-card-elevated px-4 py-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-display text-[14px] font-semibold text-foreground">
                          {i.name}
                        </span>
                        <StatusPill configured={i.configured} />
                      </div>
                      <div className="mt-1 font-body text-[13px] leading-relaxed text-muted">
                        {i.powers}
                      </div>
                      <div
                        className={`mt-1 font-mono text-[11px] ${
                          i.configured ? "text-emerald" : "text-amber-200"
                        }`}
                      >
                        {i.detail}
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </Panel>
        );
      })}
    </>
  );
}

function StatusPill({ configured }: { configured: boolean }) {
  return configured ? (
    <span className="aur-pill bg-emerald-400/10 text-emerald-300 border-emerald-400/30">
      live
    </span>
  ) : (
    <span className="aur-pill bg-amber-400/10 text-amber-200 border-amber-400/30">
      stub
    </span>
  );
}
