import fs from "node:fs/promises";
import path from "node:path";
import { requireAuth } from "@/lib/auth-helpers";
import { MarkdownRenderer } from "@/components/help/MarkdownRenderer";

export const dynamic = "force-dynamic";

export default async function UserHelpPage() {
  await requireAuth();
  const filePath = path.join(process.cwd(), "docs", "USER_MANUAL.md");
  const source = await fs.readFile(filePath, "utf8");
  return <MarkdownRenderer source={source} />;
}
