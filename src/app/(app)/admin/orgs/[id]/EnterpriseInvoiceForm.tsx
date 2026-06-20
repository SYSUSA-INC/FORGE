"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { issueEnterpriseInvoiceAction } from "./enterprise-invoice-actions";

type TierOption = {
  slug: string;
  name: string;
  hasMonthlyPrice: boolean;
  hasYearlyPrice: boolean;
};

/**
 * BL-17 Slice 5 — superadmin enterprise wire-invoice form.
 *
 * Lives inside the "Subscription tier" panel on /admin/orgs/[id]. On
 * submit, calls the server action that:
 *   1. Creates / updates the Stripe Customer with the supplied
 *      billing email
 *   2. Creates a Stripe Subscription with collection_method=send_invoice,
 *      Net-30 (default), and PO# metadata
 *   3. Returns the hosted invoice URL we surface in a success banner
 *
 * The customer's AP wires the money against the hosted invoice's
 * virtual US bank account number; Stripe reconciles; the existing
 * `invoice.paid` webhook from Slice 4 flips tier_id and sets
 * status='active'.
 */
export function EnterpriseInvoiceForm({
  organizationId,
  organizationName,
  defaultBillingEmail,
  tiers,
}: {
  organizationId: string;
  organizationName: string;
  defaultBillingEmail: string;
  tiers: TierOption[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{
    hostedInvoiceUrl: string | null;
    subscriptionId: string;
  } | null>(null);

  const buyableTiers = tiers.filter(
    (t) => t.hasMonthlyPrice || t.hasYearlyPrice,
  );

  const [tierSlug, setTierSlug] = useState(buyableTiers[0]?.slug ?? "");
  const [period, setPeriod] = useState<"monthly" | "yearly">("yearly");
  const [billingEmail, setBillingEmail] = useState(defaultBillingEmail);
  const [poNumber, setPoNumber] = useState("");
  const [daysUntilDue, setDaysUntilDue] = useState("30");
  const [notes, setNotes] = useState("");

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    startTransition(async () => {
      const res = await issueEnterpriseInvoiceAction({
        organizationId,
        tierSlug,
        period,
        billingEmail: billingEmail.trim(),
        poNumber: poNumber.trim(),
        daysUntilDue: Number(daysUntilDue) || 30,
        notes: notes.trim(),
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSuccess({
        hostedInvoiceUrl: res.hostedInvoiceUrl,
        subscriptionId: res.subscriptionId,
      });
      router.refresh();
    });
  }

  if (buyableTiers.length === 0) {
    return (
      <p className="mt-3 font-mono text-[10px] text-muted">
        No tiers have Stripe Prices configured. Add Price ids in
        /admin/tiers first.
      </p>
    );
  }

  const selectedTier = buyableTiers.find((t) => t.slug === tierSlug);
  const periodAvailable =
    period === "yearly"
      ? selectedTier?.hasYearlyPrice
      : selectedTier?.hasMonthlyPrice;

  return (
    <form
      onSubmit={onSubmit}
      className="mt-4 flex flex-col gap-3 rounded-md border border-white/10 bg-white/[0.02] p-3"
    >
      <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
        Issue enterprise wire-invoice
      </div>
      <p className="font-mono text-[10px] leading-relaxed text-muted/80">
        Sales-led path for{" "}
        <span className="text-text">{organizationName}</span>: creates a
        Stripe subscription with{" "}
        <code className="text-text">collection_method=send_invoice</code> +
        Net-30 terms. The customer's AP wires against the hosted invoice;
        the existing webhook flips the tier when payment lands.
      </p>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="aur-label">Tier</span>
          <select
            className="aur-input"
            value={tierSlug}
            onChange={(e) => setTierSlug(e.target.value)}
            disabled={pending}
          >
            {buyableTiers.map((t) => (
              <option key={t.slug} value={t.slug}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="aur-label">Billing period</span>
          <select
            className="aur-input"
            value={period}
            onChange={(e) => setPeriod(e.target.value as "monthly" | "yearly")}
            disabled={pending}
          >
            <option value="yearly" disabled={!selectedTier?.hasYearlyPrice}>
              Yearly
            </option>
            <option value="monthly" disabled={!selectedTier?.hasMonthlyPrice}>
              Monthly
            </option>
          </select>
        </label>
        <label className="flex flex-col gap-1 md:col-span-2">
          <span className="aur-label">Billing email (AP contact)</span>
          <input
            className="aur-input"
            type="email"
            value={billingEmail}
            onChange={(e) => setBillingEmail(e.target.value)}
            placeholder="ap@example.com"
            disabled={pending}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="aur-label">PO number</span>
          <input
            className="aur-input font-mono text-[12px]"
            value={poNumber}
            onChange={(e) => setPoNumber(e.target.value)}
            placeholder="PO-12345"
            disabled={pending}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="aur-label">Net (days until due)</span>
          <input
            className="aur-input"
            type="number"
            min="1"
            max="120"
            value={daysUntilDue}
            onChange={(e) => setDaysUntilDue(e.target.value)}
            disabled={pending}
          />
        </label>
        <label className="flex flex-col gap-1 md:col-span-2">
          <span className="aur-label">Sales notes (optional)</span>
          <input
            className="aur-input"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Reference: contract # / negotiated discount / sales rep"
            maxLength={500}
            disabled={pending}
          />
        </label>
      </div>

      <div>
        <button
          type="submit"
          className="aur-btn aur-btn-primary text-[12px] disabled:opacity-50"
          disabled={pending || !periodAvailable}
        >
          {pending
            ? "Issuing…"
            : !periodAvailable
              ? `${period} not available for this tier`
              : "Issue invoice →"}
        </button>
      </div>

      {error ? (
        <div className="rounded-md border border-rose/40 bg-rose/10 px-3 py-2 font-mono text-[11px] text-rose">
          {error}
        </div>
      ) : null}
      {success ? (
        <div className="rounded-md border border-emerald-400/40 bg-emerald-400/10 px-3 py-2 font-mono text-[11px] text-emerald-300">
          <div>Invoice issued. Subscription: {success.subscriptionId}</div>
          {success.hostedInvoiceUrl ? (
            <a
              href={success.hostedInvoiceUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-1 inline-block underline"
            >
              Open hosted invoice (also emailed to billing contact) →
            </a>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}
