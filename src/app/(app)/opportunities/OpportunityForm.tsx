"use client";

import { FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { OpportunityStage } from "@/db/schema";
import {
  CONTRACT_TYPES,
  SET_ASIDES,
  STAGES,
} from "@/lib/opportunity-types";
import {
  createOpportunityAction,
  updateOpportunityAction,
  type OpportunityInput,
} from "./actions";

type Owner = { id: string; name: string | null; email: string };

export type InitialOpportunity = OpportunityInput & { stage?: OpportunityStage };

export function OpportunityForm({
  mode,
  id,
  initial,
  owners,
  defaultOwnerUserId,
}: {
  mode: "create" | "edit";
  id?: string;
  initial?: InitialOpportunity;
  owners: Owner[];
  defaultOwnerUserId?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState(initial?.title ?? "");
  const [agency, setAgency] = useState(initial?.agency ?? "");
  const [office, setOffice] = useState(initial?.office ?? "");
  const [stage, setStage] = useState<OpportunityStage>(
    (initial?.stage as OpportunityStage) ?? "identified",
  );
  const [solicitationNumber, setSolicitationNumber] = useState(
    initial?.solicitationNumber ?? "",
  );
  const [noticeId, setNoticeId] = useState(initial?.noticeId ?? "");
  const [valueLow, setValueLow] = useState(initial?.valueLow ?? "");
  const [valueHigh, setValueHigh] = useState(initial?.valueHigh ?? "");
  const [releaseDate, setReleaseDate] = useState(initial?.releaseDate ?? "");
  const [responseDueDate, setResponseDueDate] = useState(
    initial?.responseDueDate ?? "",
  );
  const [awardDate, setAwardDate] = useState(initial?.awardDate ?? "");
  const [naicsCode, setNaicsCode] = useState(initial?.naicsCode ?? "");
  const [pscCode, setPscCode] = useState(initial?.pscCode ?? "");
  const [setAside, setSetAside] = useState(initial?.setAside ?? "");
  const [contractType, setContractType] = useState(initial?.contractType ?? "");
  const [placeOfPerformance, setPlaceOfPerformance] = useState(
    initial?.placeOfPerformance ?? "",
  );
  const [incumbent, setIncumbent] = useState(initial?.incumbent ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [pWin, setPWin] = useState<number>(initial?.pWin ?? 0);
  const [ownerUserId, setOwnerUserId] = useState<string>(
    initial?.ownerUserId ?? defaultOwnerUserId ?? "",
  );

  function collect(): OpportunityInput {
    return {
      title,
      agency,
      office,
      stage,
      solicitationNumber,
      noticeId,
      valueLow,
      valueHigh,
      releaseDate: releaseDate || null,
      responseDueDate: responseDueDate || null,
      awardDate: awardDate || null,
      naicsCode,
      pscCode,
      setAside,
      contractType,
      placeOfPerformance,
      incumbent,
      description,
      pWin,
      ownerUserId: ownerUserId || null,
    };
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const payload = collect();
      if (mode === "create") {
        const res = await createOpportunityAction(payload);
        if (!res.ok) return setError(res.error);
        router.push(`/opportunities/${res.id}`);
      } else if (mode === "edit" && id) {
        const res = await updateOpportunityAction(id, payload);
        if (!res.ok) return setError(res.error);
        router.refresh();
      }
    });
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={onSubmit}>
      <Field label="Title" required>
        <input
          className="aur-input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          placeholder="e.g., Army NETCENTS-2 Application Services task order"
        />
      </Field>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Field label="Agency / Customer">
          <input
            className="aur-input"
            value={agency}
            onChange={(e) => setAgency(e.target.value)}
            placeholder="Department of the Army"
          />
        </Field>
        <Field label="Office / Command">
          <input
            className="aur-input"
            value={office}
            onChange={(e) => setOffice(e.target.value)}
            placeholder="PEO EIS"
          />
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Field label="Stage">
          <select
            className="aur-input"
            value={stage}
            onChange={(e) => setStage(e.target.value as OpportunityStage)}
          >
            {STAGES.map((s) => (
              <option key={s.key} value={s.key}>
                {s.shortLabel} · {s.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Probability of win (PWin %)">
          <input
            className="aur-input"
            type="number"
            min={0}
            max={100}
            value={pWin}
            onChange={(e) => setPWin(Number(e.target.value))}
          />
        </Field>
        <Field label="Owner">
          <select
            className="aur-input"
            value={ownerUserId}
            onChange={(e) => setOwnerUserId(e.target.value)}
          >
            <option value="">Unassigned</option>
            {owners.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name ?? o.email}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Field label="Solicitation number">
          <input
            className="aur-input"
            value={solicitationNumber}
            onChange={(e) => setSolicitationNumber(e.target.value)}
            placeholder="W91CRB-26-R-0001"
          />
        </Field>
        <Field label="SAM.gov Notice ID">
          <input
            className="aur-input"
            value={noticeId}
            onChange={(e) => setNoticeId(e.target.value)}
            placeholder="Optional"
          />
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Field label="Value low ($)">
          <input
            className="aur-input"
            value={valueLow}
            onChange={(e) => setValueLow(e.target.value)}
            placeholder="10M"
          />
        </Field>
        <Field label="Value high ($)">
          <input
            className="aur-input"
            value={valueHigh}
            onChange={(e) => setValueHigh(e.target.value)}
            placeholder="50M"
          />
        </Field>
        <Field label="Contract type">
          <select
            className="aur-input"
            value={contractType}
            onChange={(e) => setContractType(e.target.value)}
          >
            {CONTRACT_TYPES.map((t) => (
              <option key={t || "_empty"} value={t}>
                {t || "— Select —"}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Field label="Expected release">
          <input
            className="aur-input"
            type="date"
            value={releaseDate ?? ""}
            onChange={(e) => setReleaseDate(e.target.value)}
          />
        </Field>
        <Field label="Response due">
          <input
            className="aur-input"
            type="date"
            value={responseDueDate ?? ""}
            onChange={(e) => setResponseDueDate(e.target.value)}
          />
        </Field>
        <Field label="Award date (if won)">
          <input
            className="aur-input"
            type="date"
            value={awardDate ?? ""}
            onChange={(e) => setAwardDate(e.target.value)}
          />
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Field label="NAICS">
          <input
            className="aur-input"
            value={naicsCode}
            onChange={(e) => setNaicsCode(e.target.value)}
            placeholder="541512"
          />
        </Field>
        <Field label="PSC">
          <input
            className="aur-input"
            value={pscCode}
            onChange={(e) => setPscCode(e.target.value)}
            placeholder="D307"
          />
        </Field>
        <Field label="Set-aside">
          <select
            className="aur-input"
            value={setAside}
            onChange={(e) => setSetAside(e.target.value)}
          >
            {SET_ASIDES.map((s) => (
              <option key={s || "_empty"} value={s}>
                {s || "— Select —"}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Field label="Place of performance">
          <input
            className="aur-input"
            value={placeOfPerformance}
            onChange={(e) => setPlaceOfPerformance(e.target.value)}
            placeholder="Fort Belvoir, VA"
          />
        </Field>
        <Field label="Incumbent">
          <input
            className="aur-input"
            value={incumbent}
            onChange={(e) => setIncumbent(e.target.value)}
            placeholder="Current contractor, if any"
          />
        </Field>
      </div>

      <Field label="Description">
        <textarea
          className="aur-input min-h-[120px] resize-y"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Scope, customer needs, differentiators, positioning notes…"
        />
      </Field>

      {error ? (
        <div className="rounded-md border border-rose/40 bg-rose/10 px-3 py-2 font-mono text-[11px] text-rose">
          {error}
        </div>
      ) : null}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending || !title.trim()}
          className="aur-btn aur-btn-primary py-2.5 text-sm disabled:opacity-60"
        >
          {pending
            ? "Saving…"
            : mode === "create"
              ? "Create opportunity"
              : "Save changes"}
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col">
      <span className="aur-label">
        {label}
        {required ? <span className="ml-1 text-rose">*</span> : null}
      </span>
      {children}
    </label>
  );
}
