-- BL-10 Phase B-1 — store AI classification results on every
-- knowledge_artifact, not just the ones we auto-applied.
--
-- Phase A wired the classifier to OVERWRITE knowledge_artifact.kind
-- when confidence >= 0.6. That left no audit trail for the
-- classifier's actual output: low-confidence suggestions
-- (0.4–0.59) were silently discarded, and admins had no way to
-- review what the AI thought.
--
-- Phase B-1 keeps the apply-on-high-confidence behavior but ALSO
-- persists the classifier's output to three new columns so admins
-- can surface suggestions in the UI + accept low-confidence ones
-- explicitly.

ALTER TABLE "knowledge_artifact"
  ADD COLUMN "ai_suggested_kind"          "knowledge_artifact_kind",
  ADD COLUMN "ai_classification_confidence" real,
  ADD COLUMN "ai_classification_reasoning" text NOT NULL DEFAULT '';

-- No index — these columns are only read when rendering individual
-- artifact rows, never as a filter or join key. Adding an index
-- would be wasted disk.
