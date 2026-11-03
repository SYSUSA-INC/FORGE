import Link from "next/link";
import { LIFECYCLE, lifecycleIndex, type LifecycleKey } from "@/lib/lifecycle";

/**
 * BL-NAV-LIFECYCLE — the process chevron: Identify → Evaluate → Capture →
 * Plan → Develop → Deliver → Measure. The current stage in blue, the
 * stages before it in a pale blue, the rest on paper; each chevron
 * links to its stage page. Server component; on every stage page and on
 * every opportunity and proposal.
 */
export function LifecycleChevron({ current, className = "" }: { current: LifecycleKey; className?: string }) {
  const at = lifecycleIndex(current);
  const last = LIFECYCLE.length - 1;
  return (
    <nav aria-label="Proposal lifecycle" className={`mb-5 w-full overflow-x-auto ${className}`}>
      <ol className="flex min-w-max items-stretch gap-[2px]">
        {LIFECYCLE.map((stage, i) => {
          const here = i === at;
          const done = i < at;
          const tone = here ? "bg-action text-white" : done ? "bg-cobalt/20 text-text hover:bg-cobalt/30" : "bg-layer/5 text-muted hover:bg-layer/10";
          const shape =
            i === 0
              ? "polygon(0 0, calc(100% - 12px) 0, 100% 50%, calc(100% - 12px) 100%, 0 100%)"
              : i === last
                ? "polygon(0 0, 100% 0, 100% 100%, 0 100%, 12px 50%)"
                : "polygon(0 0, calc(100% - 12px) 0, 100% 50%, calc(100% - 12px) 100%, 0 100%, 12px 50%)";
          return (
            <li key={stage.key}>
              <Link
                href={stage.href}
                aria-current={here ? "step" : undefined}
                title={here ? `${stage.label}: the current stage` : stage.label}
                className={`flex h-9 items-center font-body text-[13px] font-medium transition-colors ${tone} ${i === 0 ? "pl-4 pr-6" : i === last ? "pl-6 pr-4" : "px-6"}`}
                style={{ clipPath: shape }}
              >
                {stage.label}
              </Link>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
