-- BL-NAV-LIFECYCLE 4c-2 — the decision kind a plan's Move to Develop writes (P-8). Alone in its file: a later INSERT cannot reference an enum value added in the same transaction.
ALTER TYPE "opportunity_decision_kind" ADD VALUE IF NOT EXISTS 'plan';
