import { THEME } from "@/lib/theme-colors";

export function Perforation({
  tone = "paper",
  className = "",
}: {
  tone?: "paper" | "bone" | "ink";
  className?: string;
}) {
  const dot =
    tone === "ink" ? THEME.canvas : tone === "bone" ? THEME.bone : THEME.paper;
  return (
    <div
      className={`h-3 w-full border-y-2 border-ink ${className}`}
      style={{
        backgroundImage: `radial-gradient(${dot} 3px, transparent 3px)`,
        backgroundSize: "14px 14px",
        backgroundPosition: "center",
        backgroundRepeat: "repeat-x",
      }}
      aria-hidden
    />
  );
}
