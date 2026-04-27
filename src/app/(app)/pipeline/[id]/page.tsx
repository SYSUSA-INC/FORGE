import { redirect } from "next/navigation";

/**
 * /pipeline/[id] used to render a mock opportunity detail page.
 * It's been superseded by the real /opportunities/[id] view, which
 * renders the same record with editable fields, evaluation,
 * competitors, activity timeline, and the AI pursuit brief.
 */
export default function PipelineDetailRedirect({
  params,
}: {
  params: { id: string };
}) {
  redirect(`/opportunities/${params.id}`);
}
