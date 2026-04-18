import { ReactNode } from "react";
import { CropMarks } from "./CropMarks";
import { Barcode } from "./Barcode";

export function PageHeader({
  eyebrow,
  title,
  subtitle,
  actions,
  meta,
  stamp,
  barcode,
  tone = "paper",
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  meta?: { label: string; value: string; accent?: "ink" | "hazard" | "blood" | "signal" | "cobalt" | "plum" }[];
  stamp?: { label: string; tone?: "blood" | "ink" | "signal" | "hazard" };
  barcode?: string;
  tone?: "paper" | "bone";
}) {
  const bg = tone === "bone" ? "bg-bone" : "bg-paper";
  return (
    <div className={`relative mb-8 border-2 border-ink ${bg} shadow-brut-xl`}>
      <CropMarks />

      {/* Top bar — eyebrow + file metadata */}
      <div className="flex items-center justify-between border-b-2 border-ink bg-ink px-5 py-2 text-paper">
        <div className="flex items-center gap-3 font-mono text-[10px] uppercase tracking-[0.3em]">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping bg-hazard opacity-70" />
            <span className="relative inline-flex h-2 w-2 bg-hazard" />
          </span>
          {eyebrow}
        </div>
        <div className="flex items-center gap-3 font-mono text-[10px] uppercase tracking-[0.3em] text-paper/70">
          <span className="hidden md:inline">DOC// {new Date().toISOString().slice(0, 10)}</span>
          <span className="hidden md:inline">REV 04</span>
          <span>CLASS · CUI</span>
        </div>
      </div>

      {/* Hero block */}
      <div className="relative grid grid-cols-1 gap-4 px-6 py-7 lg:grid-cols-[1fr_auto] lg:items-end">
        {/* Hazard side band on left edge */}
        <div className="pointer-events-none absolute bottom-0 left-0 top-0 hidden w-2 brut-diagonal-hazard lg:block" />

        <div className="lg:pl-4">
          <h1 className="brut-stencil relative text-[72px] leading-[0.82] tracking-[-0.04em] md:text-[96px] lg:text-[128px]">
            {title}
            <span className="ml-3 inline-block h-5 w-5 translate-y-[-12px] bg-hazard align-middle" />
          </h1>
          {subtitle ? (
            <p className="mt-4 max-w-2xl font-mono text-[11px] uppercase leading-relaxed tracking-[0.18em] text-ink/70">
              ▸ {subtitle}
            </p>
          ) : null}
          {stamp ? (
            <div className="mt-3">
              <span
                className={`inline-block border-[3px] px-2 py-1 font-display text-[11px] font-black uppercase tracking-[0.22em] opacity-90 ${
                  stamp.tone === "signal"
                    ? "text-signal"
                    : stamp.tone === "ink"
                      ? "text-ink"
                      : stamp.tone === "hazard"
                        ? "text-hazard"
                        : "text-blood"
                }`}
                style={{ transform: "rotate(-5deg)" }}
              >
                ✦ {stamp.label} ✦
              </span>
            </div>
          ) : null}
        </div>

        <div className="flex flex-col items-end gap-3">
          {actions ? <div className="flex flex-wrap items-center justify-end gap-2">{actions}</div> : null}
          {barcode ? <Barcode value={barcode} /> : null}
        </div>
      </div>

      {meta && meta.length > 0 ? (
        <div className="grid grid-cols-2 border-t-2 border-ink md:grid-cols-4">
          {meta.map((m, i) => (
            <div
              key={m.label}
              className={`relative overflow-hidden border-ink p-4 ${
                i !== meta.length - 1 ? "border-r-2" : ""
              } ${
                m.accent === "hazard"
                  ? "bg-hazard"
                  : m.accent === "blood"
                    ? "bg-blood text-paper"
                    : m.accent === "signal"
                      ? "bg-signal"
                      : m.accent === "cobalt"
                        ? "bg-cobalt text-paper"
                        : m.accent === "plum"
                          ? "bg-plum text-paper"
                          : m.accent === "ink"
                            ? "bg-ink text-paper"
                            : "bg-paper"
              }`}
            >
              <div className="flex items-start justify-between font-mono text-[10px] uppercase tracking-[0.25em] opacity-70">
                <span>{m.label}</span>
                <span className="opacity-60">0{i + 1}</span>
              </div>
              <div className="mt-1 brut-stencil text-3xl md:text-4xl">{m.value}</div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
