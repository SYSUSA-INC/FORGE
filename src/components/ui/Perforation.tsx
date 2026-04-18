export function Perforation({
  tone = "paper",
  className = "",
}: {
  tone?: "paper" | "bone" | "ink";
  className?: string;
}) {
  const bg =
    tone === "ink"
      ? "radial-gradient(#0A0A0A 3px, transparent 3px)"
      : tone === "bone"
        ? "radial-gradient(#EDE5D3 3px, transparent 3px)"
        : "radial-gradient(#F5F1E8 3px, transparent 3px)";
  return (
    <div
      className={`h-3 w-full border-y-2 border-ink ${className}`}
      style={{
        backgroundImage: bg,
        backgroundSize: "14px 14px",
        backgroundPosition: "center",
        backgroundRepeat: "repeat-x",
      }}
      aria-hidden
    />
  );
}
