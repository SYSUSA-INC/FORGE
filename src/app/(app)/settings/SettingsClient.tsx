"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import {
  CLEARANCE_LEVELS,
  DEFAULT_VEHICLES,
  type ClearanceLevel,
  type ContractingVehicle,
  type OrgProfile,
  type PastPerformance,
} from "@/lib/org-types";
import {
  applySamGovSyncAction,
  saveOrgProfileAction,
} from "./actions";

type TabKey = "organization" | "users" | "integrations" | "ai";

const TABS: { key: TabKey; label: string }[] = [
  { key: "organization", label: "Organization" },
  { key: "users", label: "Users & Roles" },
  { key: "integrations", label: "Integrations" },
  { key: "ai", label: "AI Engine" },
];

function newId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
  }
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

export function SettingsClient({
  initialProfile,
  canEdit,
}: {
  initialProfile: OrgProfile;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<TabKey>("organization");
  const [draft, setDraft] = useState<OrgProfile>(initialProfile);
  const [dirty, setDirty] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, startSaveTransition] = useTransition();

  function update<K extends keyof OrgProfile>(key: K, value: OrgProfile[K]) {
    if (!canEdit) return;
    setDraft((d) => ({ ...d, [key]: value }));
    setDirty(true);
  }

  function handleSave() {
    if (!canEdit) return;
    setSaveError(null);
    startSaveTransition(async () => {
      const res = await saveOrgProfileAction(draft);
      if (!res.ok) {
        setSaveError(res.error);
        return;
      }
      setDirty(false);
      router.refresh();
    });
  }

  function handleReset() {
    setDraft(initialProfile);
    setDirty(false);
    setSaveError(null);
  }

  return (
    <>
      <PageHeader
        eyebrow="Settings"
        title="Organization & workspace"
        subtitle={
          canEdit
            ? "Identity, registrations, compliance posture, and integrations for your organization."
            : "View-only — only organization admins can edit these fields."
        }
        actions={
          canEdit ? (
            <>
              <button
                className="aur-btn aur-btn-ghost"
                onClick={handleReset}
                disabled={!dirty || saving}
              >
                Reset
              </button>
              <button
                className="aur-btn aur-btn-primary"
                onClick={handleSave}
                disabled={!dirty || saving}
              >
                {saving ? "Saving…" : "Save changes"}
              </button>
            </>
          ) : null
        }
      />

      {saveError ? (
        <div className="mb-4 rounded-md border border-rose/40 bg-rose/10 px-3 py-2 font-mono text-[11px] text-rose">
          {saveError}
        </div>
      ) : null}

      <nav className="mb-6 flex flex-wrap gap-1 border-b border-white/10">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`relative -mb-px border-b-2 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.22em] transition-colors ${
              tab === t.key
                ? "border-teal-400 text-text"
                : "border-transparent text-muted hover:text-text"
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {tab === "organization" && (
        <OrganizationTab draft={draft} update={update} canEdit={canEdit} />
      )}
      {tab === "users" && <PlaceholderTab title="Users & Roles" />}
      {tab === "integrations" && <PlaceholderTab title="Integrations" />}
      {tab === "ai" && <PlaceholderTab title="AI Engine" />}
    </>
  );
}

function OrganizationTab({
  draft,
  update,
  canEdit,
}: {
  draft: OrgProfile;
  update: <K extends keyof OrgProfile>(key: K, value: OrgProfile[K]) => void;
  canEdit: boolean;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <EntityBanner org={draft} className="xl:col-span-2" />

      {canEdit ? (
        <SamGovSyncPanel className="xl:col-span-2" initialUei={draft.uei} />
      ) : null}

      <Panel title="Identity">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <TextField
            label="Legal name"
            value={draft.name}
            onChange={(v) => update("name", v)}
          />
          <TextField
            label="Website"
            value={draft.website}
            onChange={(v) => update("website", v)}
            placeholder="https://example.com"
          />
        </div>
      </Panel>

      <Panel title="Primary contact">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <TextField
            label="Contact name"
            value={draft.contactName}
            onChange={(v) => update("contactName", v)}
          />
          <TextField
            label="Title"
            value={draft.contactTitle}
            onChange={(v) => update("contactTitle", v)}
          />
          <TextField
            label="Phone"
            value={draft.phone}
            onChange={(v) => update("phone", v)}
          />
          <TextField
            label="Email"
            type="email"
            value={draft.email}
            onChange={(v) => update("email", v)}
          />
        </div>
      </Panel>

      <Panel title="Address" className="xl:col-span-2">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-6">
          <TextField
            className="md:col-span-3"
            label="Line 1"
            value={draft.address.line1}
            onChange={(v) => update("address", { ...draft.address, line1: v })}
          />
          <TextField
            className="md:col-span-3"
            label="Line 2"
            value={draft.address.line2}
            onChange={(v) => update("address", { ...draft.address, line2: v })}
          />
          <TextField
            className="md:col-span-2"
            label="City"
            value={draft.address.city}
            onChange={(v) => update("address", { ...draft.address, city: v })}
          />
          <TextField
            label="State"
            value={draft.address.state}
            onChange={(v) => update("address", { ...draft.address, state: v })}
          />
          <TextField
            label="ZIP"
            value={draft.address.zip}
            onChange={(v) => update("address", { ...draft.address, zip: v })}
          />
          <TextField
            className="md:col-span-2"
            label="Country"
            value={draft.address.country}
            onChange={(v) => update("address", { ...draft.address, country: v })}
          />
        </div>
      </Panel>

      <Panel title="Registration IDs">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <TextField
            label="UEI"
            value={draft.uei}
            onChange={(v) => update("uei", v)}
          />
          <TextField
            label="CAGE code"
            value={draft.cageCode}
            onChange={(v) => update("cageCode", v)}
          />
          <TextField
            label="DUNS"
            value={draft.dunsNumber}
            onChange={(v) => update("dunsNumber", v)}
          />
        </div>
      </Panel>

      <Panel title="Security & compliance">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <SelectField
            label="Company security level"
            value={draft.companySecurityLevel}
            options={CLEARANCE_LEVELS}
            onChange={(v) => update("companySecurityLevel", v as ClearanceLevel)}
          />
          <SelectField
            label="Employee security level"
            value={draft.employeeSecurityLevel}
            options={CLEARANCE_LEVELS}
            onChange={(v) => update("employeeSecurityLevel", v as ClearanceLevel)}
          />
          <ToggleField
            className="md:col-span-2"
            label="DCAA compliant"
            description="Approved accounting system for cost-reimbursable contracts."
            checked={draft.dcaaCompliant}
            onChange={(v) => update("dcaaCompliant", v)}
          />
        </div>
      </Panel>

      <Panel title="Classification" className="xl:col-span-2">
        <div className="flex flex-col gap-4">
          <TextField
            label="Primary NAICS"
            value={draft.primaryNaics}
            onChange={(v) => update("primaryNaics", v)}
          />
          <ChipEditor
            label="NAICS list"
            values={draft.naicsList}
            onAdd={(v) => update("naicsList", [...draft.naicsList, v])}
            onRemove={(v) =>
              update(
                "naicsList",
                draft.naicsList.filter((x) => x !== v),
              )
            }
            placeholder="Add NAICS code"
          />
          <ChipEditor
            label="PSC codes"
            values={draft.pscCodes}
            onAdd={(v) => update("pscCodes", [...draft.pscCodes, v])}
            onRemove={(v) =>
              update(
                "pscCodes",
                draft.pscCodes.filter((x) => x !== v),
              )
            }
            placeholder="Add PSC code"
          />
        </div>
      </Panel>

      <Panel title="Socio-economic designations" className="xl:col-span-2">
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3">
          <CheckboxField
            label="SBA 8(a)"
            checked={draft.socioEconomic.sba8a}
            onChange={(v) =>
              update("socioEconomic", { ...draft.socioEconomic, sba8a: v })
            }
          />
          <CheckboxField
            label="Small business"
            checked={draft.socioEconomic.smallBusiness}
            onChange={(v) =>
              update("socioEconomic", { ...draft.socioEconomic, smallBusiness: v })
            }
          />
          <CheckboxField
            label="SDB"
            checked={draft.socioEconomic.sdb}
            onChange={(v) =>
              update("socioEconomic", { ...draft.socioEconomic, sdb: v })
            }
          />
          <CheckboxField
            label="WOSB"
            checked={draft.socioEconomic.wosb}
            onChange={(v) =>
              update("socioEconomic", { ...draft.socioEconomic, wosb: v })
            }
          />
          <CheckboxField
            label="SDVOSB"
            checked={draft.socioEconomic.sdvosb}
            onChange={(v) =>
              update("socioEconomic", { ...draft.socioEconomic, sdvosb: v })
            }
          />
          <CheckboxField
            label="HUBZone"
            checked={draft.socioEconomic.hubzone}
            onChange={(v) =>
              update("socioEconomic", { ...draft.socioEconomic, hubzone: v })
            }
          />
        </div>
      </Panel>

      <VehiclesPanel
        className="xl:col-span-2"
        selected={draft.contractingVehicles}
        onChange={(v) => update("contractingVehicles", v)}
      />

      <PastPerformancePanel
        className="xl:col-span-2"
        rows={draft.pastPerformance}
        onChange={(v) => update("pastPerformance", v)}
      />

      <Panel title="Search keywords" className="xl:col-span-2">
        <ChipEditor
          label="Keywords used to match opportunities"
          values={draft.searchKeywords}
          onAdd={(v) => update("searchKeywords", [...draft.searchKeywords, v])}
          onRemove={(v) =>
            update(
              "searchKeywords",
              draft.searchKeywords.filter((x) => x !== v),
            )
          }
          placeholder="Add keyword"
        />
      </Panel>
    </div>
  );
}

function EntityBanner({ org, className }: { org: OrgProfile; className?: string }) {
  const synced =
    org.syncSource === "samgov"
      ? `SAM.gov · ${org.lastSyncedAt ? new Date(org.lastSyncedAt).toLocaleString() : "synced"}`
      : org.syncSource === "manual"
        ? "Manual entry"
        : "Not yet synced";

  return (
    <section className={`aur-card px-6 py-5 ${className ?? ""}`}>
      <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
        Registered entity
      </div>
      <div className="mt-1 font-display text-3xl font-semibold tracking-tight text-text">
        {org.name || "Unnamed organization"}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <BannerTag k="UEI" v={org.uei || "—"} />
        <BannerTag k="CAGE" v={org.cageCode || "—"} />
        <BannerTag k="Source" v={org.syncSource === "samgov" ? "SAM.gov" : org.syncSource === "manual" ? "Manual" : "—"} />
        <BannerTag k="Last sync" v={synced} />
      </div>
    </section>
  );
}

function BannerTag({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-md border border-white/10 bg-white/[0.03] px-3 py-2">
      <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-muted">
        {k}
      </div>
      <div className="mt-0.5 font-mono text-[13px] font-medium text-text">{v}</div>
    </div>
  );
}

function SamGovSyncPanel({
  initialUei,
  className,
}: {
  initialUei: string;
  className?: string;
}) {
  const router = useRouter();
  const [uei, setUei] = useState(initialUei);
  const [status, setStatus] = useState<"idle" | "loading" | "ok" | "error">(
    "idle",
  );
  const [message, setMessage] = useState<string>("");
  const [pending, startTransition] = useTransition();

  async function sync() {
    const trimmed = uei.trim();
    if (!trimmed) {
      setStatus("error");
      setMessage("Enter a UEI first.");
      return;
    }
    setStatus("loading");
    setMessage("Contacting SAM.gov…");
    startTransition(async () => {
      const res = await applySamGovSyncAction(trimmed);
      if (!res.ok) {
        setStatus("error");
        setMessage(res.error);
        return;
      }
      setStatus("ok");
      setMessage(`Imported entity data from SAM.gov.`);
      router.refresh();
    });
  }

  const statusTone =
    status === "ok"
      ? "text-emerald"
      : status === "error"
        ? "text-rose"
        : status === "loading"
          ? "text-muted"
          : "text-muted";

  return (
    <Panel
      title="SAM.gov sync"
      eyebrow="Pull registered entity data"
      className={className}
    >
      <div className="flex flex-col gap-3 md:flex-row md:items-end">
        <div className="flex-1">
          <label className="aur-label">UEI</label>
          <input
            className="aur-input"
            value={uei}
            onChange={(e) => setUei(e.target.value)}
            placeholder="12-character Unique Entity ID"
            spellCheck={false}
            autoCapitalize="characters"
          />
        </div>
        <button
          className="aur-btn aur-btn-primary"
          onClick={sync}
          disabled={status === "loading" || pending}
        >
          {status === "loading" || pending ? "Syncing…" : "Sync from SAM.gov"}
        </button>
      </div>
      {message ? (
        <div className={`mt-3 font-mono text-[11px] ${statusTone}`}>{message}</div>
      ) : null}
    </Panel>
  );
}

function VehiclesPanel({
  selected,
  onChange,
  className,
}: {
  selected: ContractingVehicle[];
  onChange: (next: ContractingVehicle[]) => void;
  className?: string;
}) {
  const [customName, setCustomName] = useState("");
  const [customCategory, setCustomCategory] = useState<"civilian" | "dow">("civilian");

  const selectedIds = useMemo(() => new Set(selected.map((v) => v.id)), [selected]);

  function toggleDefault(v: ContractingVehicle) {
    if (selectedIds.has(v.id)) {
      onChange(selected.filter((s) => s.id !== v.id));
    } else {
      onChange([...selected, v]);
    }
  }

  function removeCustom(id: string) {
    onChange(selected.filter((s) => s.id !== id));
  }

  function addCustom() {
    const name = customName.trim();
    if (!name) return;
    const next: ContractingVehicle = {
      id: newId("vc"),
      name,
      category: customCategory,
      isCustom: true,
    };
    onChange([...selected, next]);
    setCustomName("");
  }

  const civilianDefaults = DEFAULT_VEHICLES.filter((v) => v.category === "civilian");
  const dowDefaults = DEFAULT_VEHICLES.filter((v) => v.category === "dow");
  const customs = selected.filter((s) => s.isCustom);

  return (
    <Panel title="Contracting vehicles" className={className}>
      <div className="flex flex-col gap-5">
        <VehicleGroup
          heading="Civilian"
          options={civilianDefaults}
          selectedIds={selectedIds}
          onToggle={toggleDefault}
        />
        <VehicleGroup
          heading="Department of War"
          options={dowDefaults}
          selectedIds={selectedIds}
          onToggle={toggleDefault}
        />

        <div>
          <div className="aur-label">Custom vehicles</div>
          {customs.length === 0 ? (
            <div className="mt-1 font-mono text-[11px] text-muted">None yet.</div>
          ) : (
            <div className="mt-1 flex flex-wrap gap-2">
              {customs.map((v) => (
                <span key={v.id} className="aur-chip inline-flex items-center gap-2">
                  <span>{v.name}</span>
                  <span className="font-mono text-[9px] uppercase tracking-widest text-muted">
                    {v.category === "dow" ? "DoW" : "Civilian"}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeCustom(v.id)}
                    className="text-muted hover:text-rose"
                    aria-label={`Remove ${v.name}`}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}

          <div className="mt-3 flex flex-col gap-2 md:flex-row">
            <input
              className="aur-input flex-1"
              placeholder="Add custom vehicle"
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addCustom();
                }
              }}
            />
            <select
              className="aur-input md:w-48"
              value={customCategory}
              onChange={(e) =>
                setCustomCategory(e.target.value as "civilian" | "dow")
              }
            >
              <option value="civilian">Civilian</option>
              <option value="dow">Department of War</option>
            </select>
            <button
              type="button"
              className="aur-btn aur-btn-ghost"
              onClick={addCustom}
              disabled={!customName.trim()}
            >
              Add
            </button>
          </div>
        </div>
      </div>
    </Panel>
  );
}

function VehicleGroup({
  heading,
  options,
  selectedIds,
  onToggle,
}: {
  heading: string;
  options: ContractingVehicle[];
  selectedIds: Set<string>;
  onToggle: (v: ContractingVehicle) => void;
}) {
  return (
    <div>
      <div className="aur-label">{heading}</div>
      <div className="mt-1 flex flex-wrap gap-2">
        {options.map((v) => {
          const isOn = selectedIds.has(v.id);
          return (
            <button
              key={v.id}
              type="button"
              onClick={() => onToggle(v)}
              className={`aur-chip transition-colors ${
                isOn
                  ? "border-teal-400/60 bg-teal-400/10 text-text"
                  : "text-muted hover:text-text"
              }`}
              aria-pressed={isOn}
            >
              {v.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function PastPerformancePanel({
  rows,
  onChange,
  className,
}: {
  rows: PastPerformance[];
  onChange: (next: PastPerformance[]) => void;
  className?: string;
}) {
  function addRow() {
    const next: PastPerformance = {
      id: newId("pp"),
      customer: "",
      contract: "",
      value: "",
      periodStart: "",
      periodEnd: "",
      description: "",
    };
    onChange([...rows, next]);
  }

  function removeRow(id: string) {
    onChange(rows.filter((r) => r.id !== id));
  }

  function patchRow(id: string, patch: Partial<PastPerformance>) {
    onChange(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  return (
    <Panel
      title="Past performance"
      className={className}
      actions={
        <button type="button" className="aur-btn aur-btn-ghost" onClick={addRow}>
          Add entry
        </button>
      }
    >
      {rows.length === 0 ? (
        <div className="font-mono text-[11px] text-muted">
          No past performance entries yet.
        </div>
      ) : (
        <ul className="flex flex-col gap-4">
          {rows.map((r) => (
            <li
              key={r.id}
              className="rounded-lg border border-white/10 bg-white/[0.02] p-4"
            >
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <TextField
                  label="Customer"
                  value={r.customer}
                  onChange={(v) => patchRow(r.id, { customer: v })}
                />
                <TextField
                  label="Contract / task order"
                  value={r.contract}
                  onChange={(v) => patchRow(r.id, { contract: v })}
                />
                <TextField
                  label="Value"
                  value={r.value}
                  onChange={(v) => patchRow(r.id, { value: v })}
                  placeholder="$"
                />
                <div className="grid grid-cols-2 gap-3">
                  <TextField
                    label="Period start"
                    type="date"
                    value={r.periodStart}
                    onChange={(v) => patchRow(r.id, { periodStart: v })}
                  />
                  <TextField
                    label="Period end"
                    type="date"
                    value={r.periodEnd}
                    onChange={(v) => patchRow(r.id, { periodEnd: v })}
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="aur-label">Description</label>
                  <textarea
                    className="aur-input min-h-[72px] resize-y"
                    value={r.description}
                    onChange={(e) =>
                      patchRow(r.id, { description: e.target.value })
                    }
                  />
                </div>
              </div>
              <div className="mt-3 flex justify-end">
                <button
                  type="button"
                  className="aur-btn aur-btn-danger"
                  onClick={() => removeRow(r.id)}
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function PlaceholderTab({ title }: { title: string }) {
  return (
    <Panel title={title} eyebrow="Coming soon">
      <div className="font-mono text-[12px] text-muted">
        This area will be configured in a later phase.
      </div>
    </Panel>
  );
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  className,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <label className="aur-label">{label}</label>
      <input
        className="aur-input"
        type={type}
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
  options,
  onChange,
  className,
}: {
  label: string;
  value: string;
  options: readonly string[];
  onChange: (v: string) => void;
  className?: string;
}) {
  return (
    <div className={className}>
      <label className="aur-label">{label}</label>
      <select
        className="aur-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </div>
  );
}

function ToggleField({
  label,
  description,
  checked,
  onChange,
  className,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  className?: string;
}) {
  return (
    <label
      className={`flex cursor-pointer items-start gap-3 rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 ${className ?? ""}`}
    >
      <input
        type="checkbox"
        className="mt-1 accent-teal-400"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="flex flex-col">
        <span className="font-mono text-[12px] text-text">{label}</span>
        {description ? (
          <span className="font-mono text-[10px] text-muted">{description}</span>
        ) : null}
      </span>
    </label>
  );
}

function CheckboxField({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 rounded-md border border-white/10 bg-white/[0.02] px-3 py-2">
      <input
        type="checkbox"
        className="accent-teal-400"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="font-mono text-[12px] text-text">{label}</span>
    </label>
  );
}

function ChipEditor({
  label,
  values,
  onAdd,
  onRemove,
  placeholder,
}: {
  label: string;
  values: string[];
  onAdd: (v: string) => void;
  onRemove: (v: string) => void;
  placeholder?: string;
}) {
  const [input, setInput] = useState("");

  function commit() {
    const v = input.trim();
    if (!v) return;
    if (values.includes(v)) {
      setInput("");
      return;
    }
    onAdd(v);
    setInput("");
  }

  return (
    <div>
      <div className="aur-label">{label}</div>
      {values.length > 0 ? (
        <div className="mt-1 flex flex-wrap gap-2">
          {values.map((v) => (
            <span key={v} className="aur-chip inline-flex items-center gap-2">
              <span>{v}</span>
              <button
                type="button"
                onClick={() => onRemove(v)}
                className="text-muted hover:text-rose"
                aria-label={`Remove ${v}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      ) : null}
      <div className="mt-2 flex gap-2">
        <input
          className="aur-input flex-1"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            }
          }}
          placeholder={placeholder}
        />
        <button
          type="button"
          className="aur-btn aur-btn-ghost"
          onClick={commit}
          disabled={!input.trim()}
        >
          Add
        </button>
      </div>
    </div>
  );
}
