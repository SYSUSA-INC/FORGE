-- Phase audit fixes — data integrity.
--
-- Adds a partial unique index on harvested artifacts so concurrent
-- harvest runs for the same proposal can't create duplicates. The
-- index is partial (only mined_from_proposal rows) so user-uploaded
-- artifacts with the same metadata aren't constrained.

CREATE UNIQUE INDEX IF NOT EXISTS knowledge_artifact_proposal_harvest_unique
  ON knowledge_artifact (organization_id, ((metadata ->> 'proposalId')))
  WHERE source = 'mined_from_proposal'
    AND metadata ? 'proposalId';
