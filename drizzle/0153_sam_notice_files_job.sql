-- BL-SCOUT-FILES — an opportunity added from a SAM.gov notice (Scout's
-- Add to pipeline, the SAM.gov search) has the notice's attachments
-- downloaded at once by a background job, rather than at the next daily
-- amendment check. Additive.

ALTER TYPE "background_job_kind" ADD VALUE IF NOT EXISTS 'sam_notice_files';
