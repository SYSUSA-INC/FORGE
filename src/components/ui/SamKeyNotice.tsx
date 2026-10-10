import type { samKeyNotice } from "@/lib/samgov-key-logic";

/** BL-STAB-7d — the company's SAM.gov key problem, where people search SAM.gov. */
export function SamKeyNotice({ notice, className = "mb-4" }: { notice: ReturnType<typeof samKeyNotice>; className?: string }) {
  if (!notice) return null;
  const tone = notice.tone === "rose" ? "border-rose/40 bg-rose/10 text-rose" : "border-gold/40 bg-gold/10 text-gold";
  return (
    <div role="status" className={`${className} rounded-md border px-3 py-2 font-mono text-[11px] ${tone}`}>
      {notice.text}
    </div>
  );
}
