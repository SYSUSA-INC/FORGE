import { redirect } from "next/navigation";
import { identifySourceHref } from "@/lib/identify-sources";

/** BL-NAV-LIFECYCLE 1b — this source lives on the Scout tab under Pipeline → Identify now. */
export default function Page() {
  redirect(identifySourceHref("sam"));
}
