import { redirect } from "next/navigation";

/**
 * BL-NAV-LIFECYCLE phase 2a (owner, 2026-11-06) — the Solicitations list
 * folded into Pipeline → Evaluate: documents not yet on an opportunity
 * are listed there, each with Create opportunity from it, and a document
 * on an opportunity opens from that opportunity. A solicitation's own
 * page (/solicitations/{id}) stays as its document page.
 */
export default function SolicitationsListPage() {
  redirect("/pipeline/evaluate");
}
