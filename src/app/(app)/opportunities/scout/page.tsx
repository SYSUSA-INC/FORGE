import { redirect } from "next/navigation";

/** BL-NAV-LIFECYCLE — Scout lives under Pipeline → Identify now. */
export default function ScoutPage() {
  redirect("/pipeline/identify?tab=scout");
}
