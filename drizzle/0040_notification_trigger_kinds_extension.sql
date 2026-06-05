-- BL-13 Phase E-2a — extend `notification_trigger_event_kind` with
-- the three trigger semantics still served by hardcoded notification
-- paths today. Phase E-2b wires `dispatchTriggerEvent` calls for each
-- of these (in parallel with the legacy dispatch); Phase E-2c retires
-- the legacy paths once seed rules covering them are live.
--
-- Hardcoded sites being prepared for migration:
--
--   comment_mentioned          — addReviewCommentAction's
--                                dispatchCommentMentionNotification
--                                (proposals/[id]/reviews/actions.ts)
--   opportunity_reviewed       — submitOpportunityReviewAction's direct
--                                db.insert(notifications) call
--                                (opportunities/[id]/review/actions.ts)
--   solicitation_role_assigned — assignSolicitationRoleAction's direct
--                                db.insert(notifications) call
--                                (solicitations/[id]/team-actions.ts)
--
-- `ALTER TYPE ... ADD VALUE` cannot run inside a transaction that also
-- references the newly added value. Each ADD VALUE is its own
-- statement; downstream rule/delivery rows referencing these values
-- only land in Phase E-2b's seed migration.

ALTER TYPE "notification_trigger_event_kind" ADD VALUE IF NOT EXISTS 'comment_mentioned';
ALTER TYPE "notification_trigger_event_kind" ADD VALUE IF NOT EXISTS 'opportunity_reviewed';
ALTER TYPE "notification_trigger_event_kind" ADD VALUE IF NOT EXISTS 'solicitation_role_assigned';
