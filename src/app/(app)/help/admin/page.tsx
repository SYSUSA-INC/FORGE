import fs from "node:fs/promises";
import path from "node:path";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth-helpers";
import { MarkdownRenderer } from "@/components/help/MarkdownRenderer";

export const dynamic = "force-dynamic";

export default async function AdminHelpPage() {
  const user = await requireAuth();
  if (user.role !== "admin" && !user.isSuperadmin) {
    redirect("/help/user");
  }
  const filePath = path.join(process.cwd(), "docs", "ADMIN_MANUAL.md");
  const source = await fs.readFile(filePath, "utf8");
  return <MarkdownRenderer source={source} />;
}
