ALTER TABLE "proposal_section" ADD COLUMN "body_doc" jsonb DEFAULT '{"type":"doc","content":[]}'::jsonb NOT NULL;
--> statement-breakpoint
-- Backfill body_doc from the legacy `content` text column. Each non-empty
-- paragraph in the source becomes a TipTap paragraph node. Sections with
-- empty content keep the default empty doc.
UPDATE "proposal_section"
SET "body_doc" = (
  SELECT jsonb_build_object(
    'type', 'doc',
    'content', COALESCE(jsonb_agg(
      jsonb_build_object(
        'type', 'paragraph',
        'content', jsonb_build_array(
          jsonb_build_object('type', 'text', 'text', para)
        )
      )
    ), '[]'::jsonb)
  )
  FROM regexp_split_to_table("proposal_section"."content", E'\n\n+') AS para
  WHERE para <> ''
)
WHERE COALESCE("content", '') <> '';