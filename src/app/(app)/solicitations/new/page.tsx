import { redirect } from "next/navigation";

/** BL-NAV-LIFECYCLE 1a — New solicitation is part of Create under Pipeline → Identify now. */
export default function NewSolicitationPage() {
  redirect("/pipeline/identify?tab=create");
}
