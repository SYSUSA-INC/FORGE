export function CropMarks() {
  return (
    <>
      <span className="brut-crop-corner brut-crop-tl" aria-hidden />
      <span className="brut-crop-corner brut-crop-tr" aria-hidden />
      <span className="brut-crop-corner brut-crop-bl" aria-hidden />
      <span className="brut-crop-corner brut-crop-br" aria-hidden />
    </>
  );
}

export function RegistrationMark({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`h-6 w-6 ${className}`}
      aria-hidden
    >
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M12 0 V24 M0 12 H24" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="12" cy="12" r="2" fill="currentColor" />
    </svg>
  );
}
