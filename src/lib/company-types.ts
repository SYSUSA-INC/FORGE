import type { CompanyRelationship } from "@/db/schema";
import { THEME } from "@/lib/theme-colors";

export const RELATIONSHIPS: {
  key: CompanyRelationship;
  label: string;
  color: string;
  description: string;
}[] = [
  {
    key: "customer",
    label: "Customer",
    color: THEME.cobalt,
    description: "Buying agency or prime customer",
  },
  {
    key: "prime",
    label: "Prime",
    color: THEME.green,
    description: "A prime contractor you want to team with",
  },
  {
    key: "subcontractor",
    label: "Subcontractor",
    color: THEME.indigo,
    description: "A potential subcontractor under your team",
  },
  {
    key: "competitor",
    label: "Competitor",
    color: THEME.red,
    description: "Likely competitor on bids",
  },
  {
    key: "teaming_partner",
    label: "Teaming partner",
    color: THEME.plum,
    description: "Active or former teaming partner",
  },
  {
    key: "watchlist",
    label: "Watchlist",
    color: THEME.muted,
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
