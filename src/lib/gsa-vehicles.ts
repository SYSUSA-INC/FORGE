/**
 * Known GSA contract vehicles — pure data, safe to import from client
 * components. The `keyword` is OR-merged into SAM.gov's `q` parameter
 * to surface task orders against the vehicle. `naicsHint` is advisory.
 *
 * Source for vehicle scope: GSA's "Buy Through Us" page + each
 * vehicle's solicitation, current as of 2026.
 */
export type GSAVehicle = {
  id: string;
  label: string;
  keyword: string;
  scope: string;
  naicsHint?: string;
};

export const GSA_VEHICLES: GSAVehicle[] = [
  {
    id: "mas",
    label: "GSA MAS (Multiple Award Schedule)",
    keyword: "Multiple Award Schedule",
    scope: "Commercial products & services across IT, PSS, MRO, and more.",
    naicsHint: "541512",
  },
  {
    id: "oasis-plus",
    label: "OASIS+",
    keyword: "OASIS+",
    scope: "Professional services across functional categories. Successor to OASIS.",
    naicsHint: "541330",
  },
  {
    id: "polaris",
    label: "Polaris",
    keyword: "Polaris",
    scope: "Small-business IT services GWAC (custom dev, cloud, cyber, data).",
    naicsHint: "541512",
  },
  {
    id: "alliant-2",
    label: "Alliant 2",
    keyword: "Alliant 2",
    scope: "Unrestricted IT services & solutions GWAC.",
    naicsHint: "541512",
  },
  {
    id: "stars-iii",
    label: "8(a) STARS III",
    keyword: "STARS III",
    scope: "8(a) IT services GWAC.",
    naicsHint: "541512",
  },
  {
    id: "vets-2",
    label: "VETS 2",
    keyword: "VETS 2",
    scope: "SDVOSB IT services GWAC.",
    naicsHint: "541512",
  },
  {
    id: "eis",
    label: "EIS (Enterprise Infrastructure Solutions)",
    keyword: "Enterprise Infrastructure Solutions",
    scope: "Network, voice, mobility, cloud connectivity. Replaces Networx.",
    naicsHint: "517311",
  },
  {
    id: "2gov",
    label: "2GIT / 2GIT-2",
    keyword: "2GIT",
    scope: "IT hardware/software BPA against MAS.",
    naicsHint: "334111",
  },
  {
    id: "ascend",
    label: "ASCEND",
    keyword: "ASCEND",
    scope: "Cloud-services BPA (IaaS, PaaS, SaaS) against MAS.",
    naicsHint: "541512",
  },
];
