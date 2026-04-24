import type { CompanyRelationship } from "@/db/schema";

export const RELATIONSHIPS: {
  key: CompanyRelationship;
  label: string;
  color: string;
  description: string;
}[] = [
  {
    key: "customer",
    label: "Customer",
    color: "#2DD4BF",
    description: "Buying agency or prime customer",
  },
  {
    key: "prime",
    label: "Prime",
    color: "#34D399",
    description: "A prime contractor you want to team with",
  },
  {
    key: "subcontractor",
    label: "Subcontractor",
    color: "#8B5CF6",
    description: "A potential subcontractor under your team",
  },
  {
    key: "competitor",
    label: "Competitor",
    color: "#F43F5E",
    description: "Likely competitor on bids",
  },
  {
    key: "teaming_partner",
    label: "Teaming partner",
    color: "#EC4899",
    description: "Active or former teaming partner",
  },
  {
    key: "watchlist",
    label: "Watchlist",
    color: "#94A3B8",
    description: "Keep an eye on — no current engagement",
  },
];

export const RELATIONSHIP_LABELS: Record<CompanyRelationship, string> =
  Object.fromEntries(
    RELATIONSHIPS.map((r) => [r.key, r.label]),
  ) as Record<CompanyRelationship, string>;

export const RELATIONSHIP_COLORS: Record<CompanyRelationship, string> =
  Object.fromEntries(
    RELATIONSHIPS.map((r) => [r.key, r.color]),
  ) as Record<CompanyRelationship, string>;
