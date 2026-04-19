"use client";

import { useSyncExternalStore } from "react";

// Client-only in-memory + localStorage-persisted organization profile.
// Will later be replaced by a tRPC org.* router backed by Postgres.

const KEY = "forge.org.v1";

export type ClearanceLevel = "None" | "Confidential" | "Secret" | "Top Secret" | "TS/SCI";

export type Address = {
  line1: string;
  line2: string;
  city: string;
  state: string;
  zip: string;
  country: string;
};

export type ContractingVehicle = {
  id: string;
  name: string;
  category: "civilian" | "dow";
  isCustom: boolean;
};

export type PastPerformance = {
  id: string;
  customer: string;
  contract: string;
  value: string;
  periodStart: string;
  periodEnd: string;
  description: string;
};

export type OrgProfile = {
  // Identity
  name: string;
  website: string;

  // Contact
  contactName: string;
  contactTitle: string;
  phone: string;
  email: string;

  // Address
  address: Address;

  // Registration IDs
  uei: string;
  cageCode: string;
  dunsNumber: string;

  // Security & compliance
  companySecurityLevel: ClearanceLevel;
  employeeSecurityLevel: ClearanceLevel;
  dcaaCompliant: boolean;

  // Classification
  primaryNaics: string;
  naicsList: string[];
  pscCodes: string[];

  // Socio-economic
  socioEconomic: {
    sba8a: boolean;
    smallBusiness: boolean;
    sdb: boolean;
    wosb: boolean;
    sdvosb: boolean;
    hubzone: boolean;
  };

  // Contracting vehicles
  contractingVehicles: ContractingVehicle[];

  // Experience
  pastPerformance: PastPerformance[];
  searchKeywords: string[];

  // Meta
  syncSource: "manual" | "samgov" | "none";
  lastSyncedAt?: string;
};

export const DEFAULT_VEHICLES: ContractingVehicle[] = [
  { id: "v_cio_sp4", name: "CIO-SP4", category: "civilian", isCustom: false },
  { id: "v_alliant2", name: "GSA Alliant 2", category: "civilian", isCustom: false },
  { id: "v_mas", name: "GSA MAS (Schedules)", category: "civilian", isCustom: false },
  { id: "v_sewp", name: "NASA SEWP V / VI", category: "civilian", isCustom: false },
  { id: "v_nitaac", name: "NITAAC CIO-CS", category: "civilian", isCustom: false },
  { id: "v_stars3", name: "GSA 8(a) STARS III", category: "civilian", isCustom: false },
  { id: "v_ites3s", name: "Army ITES-3S", category: "dow", isCustom: false },
  { id: "v_eagle", name: "Army EAGLE", category: "dow", isCustom: false },
  { id: "v_netcents", name: "Air Force NETCENTS-2", category: "dow", isCustom: false },
  { id: "v_seaport", name: "Navy SeaPort-NxG", category: "dow", isCustom: false },
];

export const EMPTY_ORG: OrgProfile = {
  name: "",
  website: "",
  contactName: "",
  contactTitle: "",
  phone: "",
  email: "",
  address: { line1: "", line2: "", city: "", state: "", zip: "", country: "USA" },
  uei: "",
  cageCode: "",
  dunsNumber: "",
  companySecurityLevel: "None",
  employeeSecurityLevel: "None",
  dcaaCompliant: false,
  primaryNaics: "",
  naicsList: [],
  pscCodes: [],
  socioEconomic: {
    sba8a: false,
    smallBusiness: false,
    sdb: false,
    wosb: false,
    sdvosb: false,
    hubzone: false,
  },
  contractingVehicles: [],
  pastPerformance: [],
  searchKeywords: [],
  syncSource: "none",
};

type Listener = () => void;

function loadFromStorage(): OrgProfile {
  if (typeof window === "undefined") return EMPTY_ORG;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return EMPTY_ORG;
    return { ...EMPTY_ORG, ...(JSON.parse(raw) as Partial<OrgProfile>) };
  } catch {
    return EMPTY_ORG;
  }
}

function saveToStorage(next: OrgProfile) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // quota exceeded
  }
}

let state: OrgProfile = EMPTY_ORG;
let hydrated = false;
const listeners = new Set<Listener>();

function hydrate() {
  if (!hydrated && typeof window !== "undefined") {
    state = loadFromStorage();
    hydrated = true;
  }
}

function emit() {
  saveToStorage(state);
  listeners.forEach((l) => l());
}

export const orgStore = {
  getSnapshot(): OrgProfile {
    hydrate();
    return state;
  },
  getServerSnapshot(): OrgProfile {
    return EMPTY_ORG;
  },
  subscribe(listener: Listener) {
    listeners.add(listener);
    const handler = (e: StorageEvent) => {
      if (e.key === KEY) {
        state = loadFromStorage();
        listener();
      }
    };
    if (typeof window !== "undefined") window.addEventListener("storage", handler);
    return () => {
      listeners.delete(listener);
      if (typeof window !== "undefined") window.removeEventListener("storage", handler);
    };
  },
  save(next: OrgProfile) {
    hydrate();
    state = next;
    emit();
  },
  patch(patch: Partial<OrgProfile>) {
    hydrate();
    state = { ...state, ...patch };
    emit();
  },
  applySamGovFields(fields: Partial<OrgProfile>) {
    hydrate();
    state = {
      ...state,
      ...fields,
      syncSource: "samgov",
      lastSyncedAt: new Date().toISOString(),
    };
    emit();
  },
  clear() {
    state = EMPTY_ORG;
    emit();
  },
};

export function useOrg(): OrgProfile {
  return useSyncExternalStore(orgStore.subscribe, orgStore.getSnapshot, orgStore.getServerSnapshot);
}
