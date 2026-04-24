const SAM_BASE = "https://api.sam.gov/entity-information/v4/entities";

type SamRawEntity = {
  entityRegistration?: {
    legalBusinessName?: string;
    ueiSAM?: string;
    cageCode?: string;
    dunsNumber?: string;
    registrationStatus?: string;
    registrationExpirationDate?: string;
  };
  coreData?: {
    entityInformation?: { entityURL?: string };
    physicalAddress?: {
      addressLine1?: string;
      addressLine2?: string;
      city?: string;
      stateOrProvinceCode?: string;
      zipCode?: string;
      zipCodePlus4?: string;
      countryCode?: string;
    };
    businessTypes?: {
      sbaBusinessTypeList?: {
        sbaBusinessTypeCode?: string;
        sbaBusinessTypeDesc?: string;
      }[];
    };
    naicsInformation?: {
      primaryNaics?: string;
      naicsList?: { naicsCode?: string; naicsDescription?: string }[];
    };
  };
  pointsOfContact?: {
    governmentBusinessPOC?: {
      firstName?: string;
      lastName?: string;
      title?: string;
      telephoneNumber?: string;
      email?: string;
    };
    electronicBusinessPOC?: {
      firstName?: string;
      lastName?: string;
      title?: string;
      telephoneNumber?: string;
      email?: string;
    };
  };
};

type SocioMap = {
  sba8a: boolean;
  smallBusiness: boolean;
  sdb: boolean;
  wosb: boolean;
  sdvosb: boolean;
  hubzone: boolean;
};

export type NormalizedSamEntity = {
  name: string;
  website: string;
  uei: string;
  cageCode: string;
  dunsNumber: string;
  address: {
    line1: string;
    line2: string;
    city: string;
    state: string;
    zip: string;
    country: string;
  };
  contactName: string;
  contactTitle: string;
  phone: string;
  email: string;
  primaryNaics: string;
  naicsList: string[];
  socioEconomic: SocioMap;
  registrationStatus: string;
  registrationExpirationDate: string;
  sbaDescriptions: string[];
};

function mapSbaCodeToFlag(code: string): keyof SocioMap | null {
  const table: Record<string, keyof SocioMap> = {
    XX: "sba8a",
    A6: "sba8a",
    A2: "wosb",
    "27": "sdb",
    QF: "sdvosb",
    "JV SDVOSB": "sdvosb",
    QZ: "hubzone",
    A8: "smallBusiness",
  };
  return table[code] ?? null;
}

export function normalizeSamEntity(raw: SamRawEntity): NormalizedSamEntity {
  const reg = raw.entityRegistration ?? {};
  const core = raw.coreData ?? {};
  const addr = core.physicalAddress ?? {};
  const naics = core.naicsInformation ?? {};
  const sbaList = core.businessTypes?.sbaBusinessTypeList ?? [];
  const pocGov = raw.pointsOfContact?.governmentBusinessPOC;
  const pocEb = raw.pointsOfContact?.electronicBusinessPOC;
  const poc = pocGov ?? pocEb;

  const socio: SocioMap = {
    sba8a: false,
    smallBusiness: false,
    sdb: false,
    wosb: false,
    sdvosb: false,
    hubzone: false,
  };
  for (const b of sbaList) {
    const flag = mapSbaCodeToFlag(b.sbaBusinessTypeCode ?? "");
    if (flag) socio[flag] = true;
  }

  const zip =
    addr.zipCodePlus4 && addr.zipCode
      ? `${addr.zipCode}-${addr.zipCodePlus4}`
      : (addr.zipCode ?? "");

  return {
    name: reg.legalBusinessName ?? "",
    website: core.entityInformation?.entityURL ?? "",
    uei: reg.ueiSAM ?? "",
    cageCode: reg.cageCode ?? "",
    dunsNumber: reg.dunsNumber ?? "",
    address: {
      line1: addr.addressLine1 ?? "",
      line2: addr.addressLine2 ?? "",
      city: addr.city ?? "",
      state: addr.stateOrProvinceCode ?? "",
      zip,
      country: addr.countryCode ?? "USA",
    },
    contactName: poc ? `${poc.firstName ?? ""} ${poc.lastName ?? ""}`.trim() : "",
    contactTitle: poc?.title ?? "",
    phone: poc?.telephoneNumber ?? "",
    email: poc?.email ?? "",
    primaryNaics: naics.primaryNaics ?? "",
    naicsList: (naics.naicsList ?? []).map((n) => n.naicsCode ?? "").filter(Boolean),
    socioEconomic: socio,
    registrationStatus: reg.registrationStatus ?? "",
    registrationExpirationDate: reg.registrationExpirationDate ?? "",
    sbaDescriptions: sbaList.map((b) => b.sbaBusinessTypeDesc ?? "").filter(Boolean),
  };
}

export async function fetchSamGovByUei(
  uei: string,
): Promise<
  | { ok: true; profile: NormalizedSamEntity }
  | { ok: false; error: string; status?: number }
> {
  const key = process.env.SAMGOV_API_KEY;
  if (!key) {
    return { ok: false, error: "SAMGOV_API_KEY not configured on the server." };
  }
  if (!uei) return { ok: false, error: "Provide a UEI." };

  const params = new URLSearchParams({
    api_key: key,
    samRegistered: "Yes",
    page: "0",
    size: "1",
    ueiSAM: uei,
  });

  try {
    const res = await fetch(`${SAM_BASE}?${params.toString()}`, { cache: "no-store" });
    const text = await res.text();
    if (!res.ok) {
      return { ok: false, error: text.slice(0, 500), status: res.status };
    }
    const data = JSON.parse(text) as {
      totalRecords?: number;
      entityData?: SamRawEntity[];
    };
    const first = data.entityData?.[0];
    if (!first) {
      return { ok: false, error: "No matching registered entity found in SAM.gov." };
    }
    return { ok: true, profile: normalizeSamEntity(first) };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

const SAM_OPP_BASE = "https://api.sam.gov/opportunities/v2/search";

export type SamOpportunity = {
  noticeId: string;
  title: string;
  solicitationNumber: string;
  department: string;
  subTier: string;
  office: string;
  postedDate: string;
  type: string;
  baseType: string;
  archiveType: string;
  archiveDate: string | null;
  typeOfSetAsideDescription: string;
  typeOfSetAside: string;
  responseDeadLine: string | null;
  naicsCode: string;
  classificationCode: string;
  active: string;
  placeOfPerformance: { city?: { name?: string }; state?: { name?: string }; country?: { name?: string } } | null;
  description: string;
  uiLink: string;
  award: { number?: string; amount?: string; date?: string } | null;
};

export type SamOpportunitySearchParams = {
  naicsCodes?: string[];
  keyword?: string;
  postedDaysBack?: number;
  activeOnly?: boolean;
  limit?: number;
};

function mmddyyyy(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}/${dd}/${d.getFullYear()}`;
}

export async function searchSamGovOpportunities(
  input: SamOpportunitySearchParams,
): Promise<
  | { ok: true; opportunities: SamOpportunity[]; totalRecords: number }
  | { ok: false; error: string; status?: number }
> {
  const key = process.env.SAMGOV_API_KEY;
  if (!key) {
    return { ok: false, error: "SAMGOV_API_KEY not configured on the server." };
  }

  const postedTo = new Date();
  const postedFrom = new Date();
  postedFrom.setDate(postedFrom.getDate() - (input.postedDaysBack ?? 30));

  const params = new URLSearchParams({
    api_key: key,
    limit: String(input.limit ?? 50),
    postedFrom: mmddyyyy(postedFrom),
    postedTo: mmddyyyy(postedTo),
  });
  if (input.keyword) params.set("q", input.keyword);
  if (input.naicsCodes && input.naicsCodes.length > 0) {
    params.set("ncode", input.naicsCodes.join(","));
  }

  try {
    const res = await fetch(`${SAM_OPP_BASE}?${params.toString()}`, {
      cache: "no-store",
    });
    const text = await res.text();
    if (!res.ok) {
      return {
        ok: false,
        error: text.slice(0, 500),
        status: res.status,
      };
    }
    const data = JSON.parse(text) as {
      totalRecords?: number;
      opportunitiesData?: SamOpportunity[];
    };
    const ops = (data.opportunitiesData ?? []).filter((o) =>
      input.activeOnly === false ? true : o.active === "Yes",
    );
    return { ok: true, opportunities: ops, totalRecords: data.totalRecords ?? ops.length };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export type SamEntitySearchResult = {
  ueiSAM: string;
  legalBusinessName: string;
  cageCode: string;
  registrationStatus: string;
  registrationExpirationDate: string;
  physicalAddressCity: string;
  physicalAddressStateOrProvinceCode: string;
  physicalAddressCountryCode: string;
  primaryNaics: string;
  sbaCertifications: string[];
};

export type SamEntitySearchParams = {
  legalBusinessName?: string;
  uei?: string;
  cage?: string;
  naics?: string;
  state?: string;
  setAsides?: string[];
  limit?: number;
};

export async function searchSamGovEntities(
  input: SamEntitySearchParams,
): Promise<
  | { ok: true; entities: SamEntitySearchResult[]; totalRecords: number }
  | { ok: false; error: string; status?: number }
> {
  const key = process.env.SAMGOV_API_KEY;
  if (!key) {
    return { ok: false, error: "SAMGOV_API_KEY not configured on the server." };
  }
  if (
    !input.legalBusinessName &&
    !input.uei &&
    !input.cage &&
    !input.naics
  ) {
    return {
      ok: false,
      error:
        "Provide at least one search term (name, UEI, CAGE, or NAICS).",
    };
  }

  const params = new URLSearchParams({
    api_key: key,
    samRegistered: "Yes",
    registrationStatus: "A",
    size: String(input.limit ?? 50),
    page: "0",
  });
  if (input.legalBusinessName) {
    params.set("legalBusinessName", input.legalBusinessName);
  }
  if (input.uei) params.set("ueiSAM", input.uei);
  if (input.cage) params.set("cageCode", input.cage);
  if (input.naics) params.set("primaryNaics", input.naics);
  if (input.state) params.set("physicalAddressProvinceOrStateCode", input.state);

  try {
    const res = await fetch(`${SAM_BASE}?${params.toString()}`, {
      cache: "no-store",
    });
    const text = await res.text();
    if (!res.ok) {
      return { ok: false, error: text.slice(0, 500), status: res.status };
    }
    const data = JSON.parse(text) as {
      totalRecords?: number;
      entityData?: SamRawEntity[];
    };
    const entities: SamEntitySearchResult[] = (data.entityData ?? []).map(
      (raw) => {
        const reg = raw.entityRegistration ?? {};
        const addr = raw.coreData?.physicalAddress ?? {};
        const naics = raw.coreData?.naicsInformation?.primaryNaics ?? "";
        const sbaList = raw.coreData?.businessTypes?.sbaBusinessTypeList ?? [];
        return {
          ueiSAM: reg.ueiSAM ?? "",
          legalBusinessName: reg.legalBusinessName ?? "",
          cageCode: reg.cageCode ?? "",
          registrationStatus: reg.registrationStatus ?? "",
          registrationExpirationDate: reg.registrationExpirationDate ?? "",
          physicalAddressCity: addr.city ?? "",
          physicalAddressStateOrProvinceCode: addr.stateOrProvinceCode ?? "",
          physicalAddressCountryCode: addr.countryCode ?? "USA",
          primaryNaics: naics,
          sbaCertifications: sbaList
            .map((b) => b.sbaBusinessTypeDesc ?? "")
            .filter(Boolean),
        };
      },
    );
    return {
      ok: true,
      entities,
      totalRecords: data.totalRecords ?? entities.length,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
