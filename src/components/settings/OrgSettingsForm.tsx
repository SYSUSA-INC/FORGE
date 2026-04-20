"use client";

import { useEffect, useMemo, useState } from "react";
import { Panel } from "@/components/ui/Panel";
import {
  DEFAULT_VEHICLES,
  EMPTY_ORG,
  orgStore,
  useOrg,
  type Address,
  type ClearanceLevel,
  type ContractingVehicle,
  type OrgProfile,
  type PastPerformance,
} from "@/lib/orgStore";

type SyncState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ok"; message: string; registrationStatus?: string; registrationExpirationDate?: string }
  | { status: "error"; message: string };

const CLEARANCE_LEVELS: ClearanceLevel[] = [
  "None",
  "Confidential",
  "Secret",
  "Top Secret",
  "TS/SCI",
];

const SOCIO_LABELS: { key: keyof OrgProfile["socioEconomic"]; label: string }[] = [
  { key: "smallBusiness", label: "Small Business" },
  { key: "sba8a", label: "SBA 8(a)" },
  { key: "sdb", label: "SDB" },
  { key: "wosb", label: "WOSB / EDWOSB" },
  { key: "sdvosb", label: "SDVOSB" },
  { key: "hubzone", label: "HUBZone" },
];

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

export function OrgSettingsForm() {
  const stored = useOrg();

  // Local draft — hydrated from store, committed on Save.
  const [draft, setDraft] = useState<OrgProfile>(stored);
  const [dirty, setDirty] = useState(false);
  const [sync, setSync] = useState<SyncState>({ status: "idle" });
  const [saveFlash, setSaveFlash] = useState<string | null>(null);

  useEffect(() => {
    if (!dirty) setDraft(stored);
  }, [stored, dirty]);

  const patch = <K extends keyof OrgProfile>(key: K, value: OrgProfile[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setDirty(true);
  };

  const patchAddress = <K extends keyof Address>(key: K, value: Address[K]) => {
    setDraft((d) => ({ ...d, address: { ...d.address, [key]: value } }));
    setDirty(true);
  };

  const patchSocio = (key: keyof OrgProfile["socioEconomic"], value: boolean) => {
    setDraft((d) => ({ ...d, socioEconomic: { ...d.socioEconomic, [key]: value } }));
    setDirty(true);
  };

  const handleSave = () => {
    orgStore.save(draft);
    setDirty(false);
    setSaveFlash("Saved.");
    setTimeout(() => setSaveFlash(null), 1800);
  };

  const handleReset = () => {
    setDraft(stored);
    setDirty(false);
  };

  const handleClear = () => {
    if (!confirm("Clear all organization fields? This cannot be undone.")) return;
    orgStore.clear();
    setDraft(EMPTY_ORG);
    setDirty(false);
  };

  const handleSamSync = async () => {
    const uei = draft.uei.trim();
    const cage = draft.cageCode.trim();
    if (!uei && !cage) {
      setSync({ status: "error", message: "Enter a UEI or CAGE code first." });
      return;
    }
    setSync({ status: "loading" });
    try {
      const qs = new URLSearchParams();
      if (uei) qs.set("uei", uei);
      else qs.set("cage", cage);
      const res = await fetch(`/api/samgov/entity?${qs.toString()}`);
      const json = (await res.json()) as
        | {
            ok: true;
            profile: {
              name: string;
              website: string;
              uei: string;
              cageCode: string;
              dunsNumber: string;
              address: Address;
              contactName: string;
              contactTitle: string;
              phone: string;
              email: string;
              primaryNaics: string;
              naicsList: string[];
              socioEconomic: OrgProfile["socioEconomic"];
              registrationStatus: string;
              registrationExpirationDate: string;
            };
          }
        | { ok: false; error: string };

      if (!json.ok) {
        setSync({ status: "error", message: json.error || "SAM.gov lookup failed." });
        return;
      }

      const p = json.profile;
      setDraft((d) => ({
        ...d,
        name: p.name || d.name,
        website: p.website || d.website,
        uei: p.uei || d.uei,
        cageCode: p.cageCode || d.cageCode,
        dunsNumber: p.dunsNumber || d.dunsNumber,
        address: {
          line1: p.address.line1 || d.address.line1,
          line2: p.address.line2 || d.address.line2,
          city: p.address.city || d.address.city,
          state: p.address.state || d.address.state,
          zip: p.address.zip || d.address.zip,
          country: p.address.country || d.address.country,
        },
        contactName: p.contactName || d.contactName,
        contactTitle: p.contactTitle || d.contactTitle,
        phone: p.phone || d.phone,
        email: p.email || d.email,
        primaryNaics: p.primaryNaics || d.primaryNaics,
        naicsList: p.naicsList.length ? p.naicsList : d.naicsList,
        socioEconomic: { ...d.socioEconomic, ...p.socioEconomic },
        syncSource: "samgov",
        lastSyncedAt: new Date().toISOString(),
      }));
      setDirty(true);
      setSync({
        status: "ok",
        message: "Pulled from SAM.gov. Review and press Save.",
        registrationStatus: p.registrationStatus,
        registrationExpirationDate: p.registrationExpirationDate,
      });
    } catch (err) {
      setSync({
        status: "error",
        message: err instanceof Error ? err.message : "Network error.",
      });
    }
  };

  const vehicleCatalog = useMemo<ContractingVehicle[]>(() => {
    const custom = draft.contractingVehicles.filter((v) => v.isCustom);
    return [...DEFAULT_VEHICLES, ...custom];
  }, [draft.contractingVehicles]);

  const vehicleSelected = (id: string) =>
    draft.contractingVehicles.some((v) => v.id === id);

  const toggleVehicle = (v: ContractingVehicle) => {
    setDraft((d) => {
      const has = d.contractingVehicles.some((x) => x.id === v.id);
      return {
        ...d,
        contractingVehicles: has
          ? d.contractingVehicles.filter((x) => x.id !== v.id)
          : [...d.contractingVehicles, v],
      };
    });
    setDirty(true);
  };

  const addCustomVehicle = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const v: ContractingVehicle = {
      id: `v_${uid()}`,
      name: trimmed,
      category: "civilian",
      isCustom: true,
    };
    setDraft((d) => ({ ...d, contractingVehicles: [...d.contractingVehicles, v] }));
    setDirty(true);
  };

  const addKeyword = (value: string) => {
    const v = value.trim();
    if (!v) return;
    if (draft.searchKeywords.includes(v)) return;
    patch("searchKeywords", [...draft.searchKeywords, v]);
  };

  const removeKeyword = (value: string) => {
    patch(
      "searchKeywords",
      draft.searchKeywords.filter((k) => k !== value),
    );
  };

  const addNaics = (value: string) => {
    const v = value.trim();
    if (!v) return;
    if (draft.naicsList.includes(v)) return;
    patch("naicsList", [...draft.naicsList, v]);
  };
  const removeNaics = (value: string) =>
    patch("naicsList", draft.naicsList.filter((k) => k !== value));

  const addPsc = (value: string) => {
    const v = value.trim();
    if (!v) return;
    if (draft.pscCodes.includes(v)) return;
    patch("pscCodes", [...draft.pscCodes, v]);
  };
  const removePsc = (value: string) =>
    patch("pscCodes", draft.pscCodes.filter((k) => k !== value));

  const addPastPerf = () => {
    const row: PastPerformance = {
      id: `pp_${uid()}`,
      customer: "",
      contract: "",
      value: "",
      periodStart: "",
      periodEnd: "",
      description: "",
    };
    patch("pastPerformance", [...draft.pastPerformance, row]);
  };

  const updatePastPerf = (id: string, patchRow: Partial<PastPerformance>) => {
    patch(
      "pastPerformance",
      draft.pastPerformance.map((r) => (r.id === id ? { ...r, ...patchRow } : r)),
    );
  };

  const removePastPerf = (id: string) =>
    patch("pastPerformance", draft.pastPerformance.filter((r) => r.id !== id));

  return (
    <div className="flex flex-col gap-4">
      {/* Live banner */}
      <OrgBanner org={draft} sync={sync} />

      {/* Save bar */}
      <div className="sticky top-2 z-10 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-paper/80 px-4 py-2 backdrop-blur-xl">
        <div className="flex items-center gap-3 font-mono text-[11px] text-muted">
          <span className="brut-pill">
            {dirty ? "Unsaved changes" : saveFlash ?? "All changes saved"}
          </span>
          {draft.syncSource === "samgov" && draft.lastSyncedAt ? (
            <span>
              Synced from SAM.gov · {new Date(draft.lastSyncedAt).toLocaleString()}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className="aur-btn-ghost" onClick={handleClear}>
            Clear all
          </button>
          <button
            type="button"
            className="aur-btn"
            onClick={handleReset}
            disabled={!dirty}
          >
            Discard
          </button>
          <button
            type="button"
            className="aur-btn-primary"
            onClick={handleSave}
            disabled={!dirty}
          >
            Save changes
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel title="Identity" eyebrow="Legal + web" accent="violet">
          <div className="grid grid-cols-2 gap-3">
            <TextField
              full
              label="Legal business name"
              value={draft.name}
              onChange={(v) => patch("name", v)}
              placeholder="Registered entity name"
            />
            <TextField
              full
              label="Website"
              value={draft.website}
              onChange={(v) => patch("website", v)}
              placeholder="https://example.com"
            />
          </div>
        </Panel>

        <Panel title="Primary contact" eyebrow="Capture + BD" accent="emerald">
          <div className="grid grid-cols-2 gap-3">
            <TextField
              label="Contact name"
              value={draft.contactName}
              onChange={(v) => patch("contactName", v)}
              placeholder="Full name"
            />
            <TextField
              label="Title"
              value={draft.contactTitle}
              onChange={(v) => patch("contactTitle", v)}
              placeholder="e.g. Capture Manager"
            />
            <TextField
              label="Phone"
              value={draft.phone}
              onChange={(v) => patch("phone", v)}
              placeholder="+1 555 555 5555"
            />
            <TextField
              label="Email"
              value={draft.email}
              onChange={(v) => patch("email", v)}
              placeholder="name@company.com"
            />
          </div>
        </Panel>

        <Panel title="Address" eyebrow="Physical" accent="violet">
          <div className="grid grid-cols-2 gap-3">
            <TextField
              full
              label="Line 1"
              value={draft.address.line1}
              onChange={(v) => patchAddress("line1", v)}
            />
            <TextField
              full
              label="Line 2"
              value={draft.address.line2}
              onChange={(v) => patchAddress("line2", v)}
              placeholder="Suite / floor (optional)"
            />
            <TextField
              label="City"
              value={draft.address.city}
              onChange={(v) => patchAddress("city", v)}
            />
            <TextField
              label="State / region"
              value={draft.address.state}
              onChange={(v) => patchAddress("state", v)}
            />
            <TextField
              label="ZIP / postal"
              value={draft.address.zip}
              onChange={(v) => patchAddress("zip", v)}
            />
            <TextField
              label="Country"
              value={draft.address.country}
              onChange={(v) => patchAddress("country", v)}
            />
          </div>
        </Panel>

        <Panel
          title="Registration IDs · SAM.gov sync"
          eyebrow="UEI / CAGE / DUNS"
          accent="gold"
          actions={
            <button
              type="button"
              className="aur-btn-primary"
              onClick={handleSamSync}
              disabled={sync.status === "loading"}
            >
              {sync.status === "loading" ? "Syncing…" : "Sync from SAM.gov"}
            </button>
          }
        >
          <div className="grid grid-cols-2 gap-3">
            <TextField
              label="UEI (SAM)"
              value={draft.uei}
              onChange={(v) => patch("uei", v.toUpperCase())}
              placeholder="12-char alphanumeric"
            />
            <TextField
              label="CAGE code"
              value={draft.cageCode}
              onChange={(v) => patch("cageCode", v.toUpperCase())}
              placeholder="5-char"
            />
            <TextField
              label="DUNS (legacy)"
              value={draft.dunsNumber}
              onChange={(v) => patch("dunsNumber", v)}
              placeholder="Optional"
            />
            <div>
              <div className="aur-label">Sync source</div>
              <div className="aur-input !bg-white/[0.02] !font-mono !text-[12px]">
                {draft.syncSource === "samgov"
                  ? "SAM.gov"
                  : draft.syncSource === "manual"
                    ? "Manual"
                    : "—"}
              </div>
            </div>
          </div>

          {sync.status !== "idle" ? (
            <div
              className={`mt-4 rounded-lg border px-3 py-2 font-mono text-[11px] ${
                sync.status === "ok"
                  ? "border-emerald/40 bg-emerald/10 text-emerald"
                  : sync.status === "error"
                    ? "border-rose/40 bg-rose/10 text-rose"
                    : "border-white/10 bg-white/5 text-muted"
              }`}
            >
              {sync.status === "loading" ? "Contacting SAM.gov…" : sync.message}
              {sync.status === "ok" && sync.registrationStatus ? (
                <div className="mt-1 text-muted">
                  Registration: {sync.registrationStatus}
                  {sync.registrationExpirationDate
                    ? ` · Expires ${sync.registrationExpirationDate}`
                    : ""}
                </div>
              ) : null}
            </div>
          ) : (
            <p className="mt-4 text-[11px] text-muted">
              Enter a UEI or CAGE, then pull Name, Address, POC, NAICS, and set-aside flags
              directly from the SAM.gov Entity Management v4 API.
            </p>
          )}
        </Panel>

        <Panel title="Security & compliance" eyebrow="Clearance" accent="violet">
          <div className="grid grid-cols-2 gap-3">
            <SelectField
              label="Facility clearance"
              value={draft.companySecurityLevel}
              onChange={(v) => patch("companySecurityLevel", v as ClearanceLevel)}
              options={CLEARANCE_LEVELS}
            />
            <SelectField
              label="Employee max clearance"
              value={draft.employeeSecurityLevel}
              onChange={(v) => patch("employeeSecurityLevel", v as ClearanceLevel)}
              options={CLEARANCE_LEVELS}
            />
            <CheckRow
              label="DCAA-compliant accounting"
              checked={draft.dcaaCompliant}
              onChange={(v) => patch("dcaaCompliant", v)}
            />
          </div>
        </Panel>

        <Panel title="Socio-economic set-asides" eyebrow="SBA flags" accent="emerald">
          <div className="grid grid-cols-2 gap-2">
            {SOCIO_LABELS.map((s) => (
              <CheckRow
                key={s.key}
                label={s.label}
                checked={draft.socioEconomic[s.key]}
                onChange={(v) => patchSocio(s.key, v)}
              />
            ))}
          </div>
        </Panel>

        <Panel title="Classification" eyebrow="NAICS · PSC · keywords" accent="gold">
          <div className="grid grid-cols-1 gap-4">
            <TextField
              label="Primary NAICS"
              value={draft.primaryNaics}
              onChange={(v) => patch("primaryNaics", v)}
              placeholder="e.g. 541512"
            />
            <TagEditor
              label="Secondary NAICS"
              items={draft.naicsList}
              onAdd={addNaics}
              onRemove={removeNaics}
              placeholder="Add NAICS code + enter"
            />
            <TagEditor
              label="PSC codes"
              items={draft.pscCodes}
              onAdd={addPsc}
              onRemove={removePsc}
              placeholder="Add PSC code + enter"
            />
            <TagEditor
              label="Search keywords"
              items={draft.searchKeywords}
              onAdd={addKeyword}
              onRemove={removeKeyword}
              placeholder="Add keyword + enter"
            />
          </div>
        </Panel>

        <Panel title="Contracting vehicles" eyebrow="IDIQ / GWAC / BPA" accent="magenta">
          <div className="grid grid-cols-1 gap-3">
            <div>
              <div className="aur-label">Civilian</div>
              <div className="flex flex-wrap gap-2">
                {vehicleCatalog
                  .filter((v) => v.category === "civilian")
                  .map((v) => (
                    <VehicleChip
                      key={v.id}
                      v={v}
                      selected={vehicleSelected(v.id)}
                      onToggle={() => toggleVehicle(v)}
                    />
                  ))}
              </div>
            </div>
            <div>
              <div className="aur-label">DoD</div>
              <div className="flex flex-wrap gap-2">
                {vehicleCatalog
                  .filter((v) => v.category === "dow")
                  .map((v) => (
                    <VehicleChip
                      key={v.id}
                      v={v}
                      selected={vehicleSelected(v.id)}
                      onToggle={() => toggleVehicle(v)}
                    />
                  ))}
              </div>
            </div>
            <AddVehicle onAdd={addCustomVehicle} />
          </div>
        </Panel>
      </div>

      <Panel
        title="Past performance"
        eyebrow="References"
        accent="emerald"
        actions={
          <button type="button" className="aur-btn" onClick={addPastPerf}>
            + Add reference
          </button>
        }
      >
        {draft.pastPerformance.length === 0 ? (
          <p className="py-2 text-[12px] text-muted">
            No references yet. Add contracts you want to cite as past performance.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {draft.pastPerformance.map((r) => (
              <div
                key={r.id}
                className="rounded-xl border border-white/10 bg-white/[0.02] p-3"
              >
                <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
                  <TextField
                    label="Customer"
                    value={r.customer}
                    onChange={(v) => updatePastPerf(r.id, { customer: v })}
                  />
                  <TextField
                    label="Contract #"
                    value={r.contract}
                    onChange={(v) => updatePastPerf(r.id, { contract: v })}
                  />
                  <TextField
                    label="Value"
                    value={r.value}
                    onChange={(v) => updatePastPerf(r.id, { value: v })}
                    placeholder="$"
                  />
                  <TextField
                    label="Start"
                    value={r.periodStart}
                    onChange={(v) => updatePastPerf(r.id, { periodStart: v })}
                    placeholder="YYYY-MM"
                  />
                  <TextField
                    label="End"
                    value={r.periodEnd}
                    onChange={(v) => updatePastPerf(r.id, { periodEnd: v })}
                    placeholder="YYYY-MM or present"
                  />
                  <div className="flex items-end">
                    <button
                      type="button"
                      className="aur-btn-ghost w-full"
                      onClick={() => removePastPerf(r.id)}
                    >
                      Remove
                    </button>
                  </div>
                  <div className="md:col-span-6">
                    <div className="aur-label">Scope summary</div>
                    <textarea
                      className="aur-input !font-mono !text-[12px]"
                      rows={2}
                      value={r.description}
                      onChange={(e) =>
                        updatePastPerf(r.id, { description: e.target.value })
                      }
                      placeholder="One-line description of the work performed."
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

function OrgBanner({ org, sync }: { org: OrgProfile; sync: SyncState }) {
  const hasName = org.name.trim().length > 0;
  return (
    <section className="aur-card aur-ring overflow-hidden p-6">
      <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-muted">
        Registered entity
      </div>
      <div className="mt-2 font-display text-4xl font-semibold tracking-tight text-text">
        {hasName ? org.name : "Unregistered — fill in Identity below"}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tag k="UEI" v={org.uei || "—"} />
        <Tag k="CAGE" v={org.cageCode || "—"} />
        <Tag
          k="SAM"
          v={org.syncSource === "samgov" ? "Synced" : "Manual"}
          tone={org.syncSource === "samgov" ? "emerald" : "neutral"}
        />
        <Tag
          k="DCAA"
          v={org.dcaaCompliant ? "Approved" : "Not declared"}
          tone={org.dcaaCompliant ? "emerald" : "neutral"}
        />
      </div>
      {sync.status === "loading" ? (
        <div className="mt-4 font-mono text-[11px] text-muted">Contacting SAM.gov…</div>
      ) : null}
    </section>
  );
}

function Tag({
  k,
  v,
  tone,
}: {
  k: string;
  v: string;
  tone?: "emerald" | "gold" | "neutral";
}) {
  const cls =
    tone === "emerald"
      ? "border-emerald/40 bg-emerald/10 text-emerald"
      : tone === "gold"
        ? "border-gold/40 bg-gold/10 text-gold"
        : "border-white/10 bg-white/5 text-text";
  return (
    <div className={`rounded-lg border px-3 py-2 ${cls}`}>
      <div className="font-mono text-[9px] uppercase tracking-widest opacity-70">{k}</div>
      <div className="mt-0.5 font-mono text-sm font-semibold">{v}</div>
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
  full,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  full?: boolean;
}) {
  return (
    <div className={full ? "col-span-2" : undefined}>
      <div className="aur-label">{label}</div>
      <input
        className="aur-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: readonly string[];
}) {
  return (
    <div>
      <div className="aur-label">{label}</div>
      <select
        className="aur-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((opt) => (
          <option key={opt} value={opt} className="bg-paper text-text">
            {opt}
          </option>
        ))}
      </select>
    </div>
  );
}

function CheckRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 transition-colors hover:border-white/20">
      <span className="font-mono text-[12px] text-text">{label}</span>
      <span
        className={`grid h-5 w-5 place-items-center rounded border ${
          checked
            ? "border-teal/60 bg-teal/20 text-teal"
            : "border-white/15 bg-white/5 text-transparent"
        }`}
      >
        {checked ? "✓" : ""}
      </span>
      <input
        type="checkbox"
        className="sr-only"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}

function TagEditor({
  label,
  items,
  onAdd,
  onRemove,
  placeholder,
}: {
  label: string;
  items: string[];
  onAdd: (v: string) => void;
  onRemove: (v: string) => void;
  placeholder?: string;
}) {
  const [value, setValue] = useState("");
  return (
    <div>
      <div className="aur-label">{label}</div>
      <div className="flex flex-wrap gap-2 rounded-lg border border-white/10 bg-white/[0.02] p-2">
        {items.map((t) => (
          <span
            key={t}
            className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-2 py-0.5 font-mono text-[11px] text-text"
          >
            {t}
            <button
              type="button"
              className="text-muted hover:text-rose"
              onClick={() => onRemove(t)}
              aria-label={`Remove ${t}`}
            >
              ×
            </button>
          </span>
        ))}
        <input
          className="min-w-[120px] flex-1 bg-transparent px-1 py-0.5 font-mono text-[12px] text-text placeholder:text-subtle focus:outline-none"
          value={value}
          placeholder={placeholder}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              onAdd(value);
              setValue("");
            }
          }}
        />
      </div>
    </div>
  );
}

function VehicleChip({
  v,
  selected,
  onToggle,
}: {
  v: ContractingVehicle;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`rounded-full border px-3 py-1 font-mono text-[11px] transition-colors ${
        selected
          ? "border-teal/60 bg-teal/15 text-text"
          : "border-white/10 bg-white/5 text-muted hover:border-white/20 hover:text-text"
      }`}
    >
      {v.name}
      {v.isCustom ? <span className="ml-1 text-subtle">·custom</span> : null}
    </button>
  );
}

function AddVehicle({ onAdd }: { onAdd: (name: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <div className="flex items-center gap-2">
      <input
        className="aur-input"
        value={value}
        placeholder="Add custom vehicle (e.g. OASIS+)"
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onAdd(value);
            setValue("");
          }
        }}
      />
      <button
        type="button"
        className="aur-btn"
        onClick={() => {
          onAdd(value);
          setValue("");
        }}
      >
        Add
      </button>
    </div>
  );
}
