import type { Organization } from "@/db/schema";

export type ClearanceLevel =
  | "None"
  | "Confidential"
  | "Secret"
  | "Top Secret"
  | "TS/SCI";

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

export type SocioEconomic = {
  sba8a: boolean;
  smallBusiness: boolean;
  sdb: boolean;
  wosb: boolean;
  sdvosb: boolean;
  hubzone: boolean;
};

export type SyncSource = "manual" | "samgov" | "none";

export type OrgProfile = {
  name: string;
  website: string;
  contactName: string;
  contactTitle: string;
  phone: string;
  email: string;
  address: Address;
  uei: string;
  cageCode: string;
  dunsNumber: string;
  companySecurityLevel: ClearanceLevel;
  employeeSecurityLevel: ClearanceLevel;
  dcaaCompliant: boolean;
  primaryNaics: string;
  naicsList: string[];
  pscCodes: string[];
  socioEconomic: SocioEconomic;
  contractingVehicles: ContractingVehicle[];
  pastPerformance: PastPerformance[];
  searchKeywords: string[];
  syncSource: SyncSource;
  lastSyncedAt: string | null;
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

export const CLEARANCE_LEVELS: ClearanceLevel[] = [
  "None",
  "Confidential",
  "Secret",
  "Top Secret",
  "TS/SCI",
];

export function rowToOrgProfile(row: Organization): OrgProfile {
  return {
    name: row.name,
    website: row.website,
    contactName: row.contactName,
    contactTitle: row.contactTitle,
    phone: row.phone,
    email: row.email,
    address: {
      line1: row.addressLine1,
      line2: row.addressLine2,
      city: row.city,
      state: row.state,
      zip: row.zip,
      country: row.country,
    },
    uei: row.uei,
    cageCode: row.cageCode,
    dunsNumber: row.dunsNumber,
    companySecurityLevel: row.companySecurityLevel as ClearanceLevel,
    employeeSecurityLevel: row.employeeSecurityLevel as ClearanceLevel,
    dcaaCompliant: row.dcaaCompliant,
    primaryNaics: row.primaryNaics,
    naicsList: row.naicsList,
    pscCodes: row.pscCodes,
    socioEconomic: row.socioEconomic,
    contractingVehicles: row.contractingVehicles,
    pastPerformance: row.pastPerformance,
    searchKeywords: row.searchKeywords,
    syncSource: row.syncSource as SyncSource,
    lastSyncedAt: row.lastSyncedAt ? row.lastSyncedAt.toISOString() : null,
  };
}
