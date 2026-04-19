import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
      sbaBusinessTypeList?: { sbaBusinessTypeCode?: string; sbaBusinessTypeDesc?: string }[];
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

function normalize(raw: SamRawEntity) {
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
    naicsList: (naics.naicsList ?? [])
      .map((n) => n.naicsCode ?? "")
      .filter(Boolean),
    socioEconomic: socio,
    registrationStatus: reg.registrationStatus ?? "",
    registrationExpirationDate: reg.registrationExpirationDate ?? "",
    sbaDescriptions: sbaList
      .map((b) => b.sbaBusinessTypeDesc ?? "")
      .filter(Boolean),
  };
}

export async function GET(req: Request) {
  const key = process.env.SAMGOV_API_KEY;
  if (!key) {
    return NextResponse.json(
      {
        ok: false,
        error: "SAMGOV_API_KEY not configured on the server.",
      },
      { status: 500 },
    );
  }

  const url = new URL(req.url);
  const uei = url.searchParams.get("uei")?.trim();
  const cage = url.searchParams.get("cage")?.trim();

  if (!uei && !cage) {
    return NextResponse.json(
      { ok: false, error: "Provide either ?uei= or ?cage=." },
      { status: 400 },
    );
  }

  const params = new URLSearchParams({
    api_key: key,
    samRegistered: "Yes",
    page: "0",
    size: "1",
  });
  if (uei) params.set("ueiSAM", uei);
  if (cage) params.set("cageCode", cage);

  const samUrl = `${SAM_BASE}?${params.toString()}`;

  try {
    const res = await fetch(samUrl, { cache: "no-store" });
    const text = await res.text();
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, status: res.status, error: text.slice(0, 500) },
        { status: 502 },
      );
    }
    const data = JSON.parse(text) as {
      totalRecords?: number;
      entityData?: SamRawEntity[];
    };
    const first = data.entityData?.[0];
    if (!first) {
      return NextResponse.json(
        { ok: false, error: "No matching registered entity found in SAM.gov." },
        { status: 404 },
      );
    }
    return NextResponse.json({ ok: true, profile: normalize(first) });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
