"use client";

import { FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createPromoCodeAction, updatePromoCodeAction } from "./actions";

type Initial = {
  code: string;
  description: string;
  discountPercent: number;
  validFrom: string | null; // ISO date string
  validUntil: string | null;
  maxUses: number;
  active: boolean;
};

const EMPTY_INITIAL: Initial = {
  code: "",
  description: "",
  discountPercent: 10,
  validFrom: null,
  validUntil: null,
  maxUses: 0,
  active: true,
};

function dateInputValue(s: string | null): string {
  if (!s) return "";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "";
  // YYYY-MM-DD slice — what <input type="date"> expects.
  return d.toISOString().slice(0, 10);
}

export function PromoCodeForm({
  mode,
  codeId,
  initial,
}: {
  mode: "create" | "edit";
  codeId?: string;
  initial?: Initial;
}) {
  const router = useRouter();
  const base = initial ?? EMPTY_INITIAL;
  const [code, setCode] = useState(base.code);
  const [description, setDescription] = useState(base.description);
  const [discountPercent, setDiscountPercent] = useState(
    base.discountPercent.toString(),
  );
  const [validFrom, setValidFrom] = useState(dateInputValue(base.validFrom));
  const [validUntil, setValidUntil] = useState(dateInputValue(base.validUntil));
  const [maxUses, setMaxUses] = useState(base.maxUses.toString());
  const [active, setActive] = useState(base.active);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const discount = Number(discountPercent);
    if (!Number.isFinite(discount) || discount < 0 || discount > 100) {
      setError("Discount must be a whole number between 0 and 100.");
      return;
    }
    const max = Number(maxUses);
    if (!Number.isFinite(max) || max < 0) {
      setError("Max uses must be a non-negative integer (0 = unlimited).");
      return;
    }

    const input = {
      code: code.trim(),
      description: description.trim(),
      discountPercent: Math.round(discount),
      validFrom: validFrom || null,
      validUntil: validUntil || null,
      maxUses: Math.round(max),
      active,
    };

    startTransition(async () => {
      const res =
        mode === "create"
          ? await createPromoCodeAction(input)
          : await updatePromoCodeAction(codeId!, input);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      if (mode === "create") {
        const id = "id" in res ? res.id : null;
        router.push(id ? `/admin/promo-codes/${id}` : "/admin/promo-codes");
      } else {
        router.refresh();
      }
    });
  }

  return (
    <form className="flex flex-col gap-5" onSubmit={onSubmit}>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="aur-label">Code</span>
          <input
            className="aur-input font-mono"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            maxLength={64}
            required
            placeholder="LAUNCH25"
          />
          <span className="font-mono text-[10px] text-muted/70">
            Case-sensitive. Letters / digits / underscore / hyphen only.
          </span>
        </label>
        <label className="flex flex-col gap-1">
          <span className="aur-label">Discount percent</span>
          <input
            className="aur-input"
            type="number"
            min="0"
            max="100"
            step="1"
            value={discountPercent}
            onChange={(e) => setDiscountPercent(e.target.value)}
            required
          />
        </label>
      </div>

      <label className="flex flex-col gap-1">
        <span className="aur-label">Description (internal)</span>
        <textarea
          className="aur-input min-h-[60px]"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={500}
          rows={2}
          placeholder="Spring 2026 launch promo — 25% off Bronze annual"
        />
      </label>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <label className="flex flex-col gap-1">
          <span className="aur-label">Valid from (optional)</span>
          <input
            className="aur-input"
            type="date"
            value={validFrom}
            onChange={(e) => setValidFrom(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="aur-label">Valid until (optional)</span>
          <input
            className="aur-input"
            type="date"
            value={validUntil}
            onChange={(e) => setValidUntil(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="aur-label">Max uses (0 = unlimited)</span>
          <input
            className="aur-input"
            type="number"
            min="0"
            step="1"
            value={maxUses}
            onChange={(e) => setMaxUses(e.target.value)}
          />
        </label>
      </div>

      <label className="flex cursor-pointer items-center gap-2">
        <input
          type="checkbox"
          checked={active}
          onChange={(e) => setActive(e.target.checked)}
        />
        <span className="font-mono text-[12px] text-text">
          Active — uncheck to disable redemption without deleting the code
        </span>
      </label>

      {error ? (
        <div className="rounded-md border border-rose/40 bg-rose/10 px-3 py-2 font-mono text-[11px] text-rose">
          {error}
        </div>
      ) : null}

      <div className="flex justify-end">
        <button
          type="submit"
          className="aur-btn aur-btn-primary disabled:opacity-60"
          disabled={pending}
        >
          {pending
            ? "Saving…"
            : mode === "create"
              ? "Create code"
              : "Save changes"}
        </button>
      </div>
    </form>
  );
}
