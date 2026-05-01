ALTER TABLE "compliance_item" ADD COLUMN "ai_assessment" jsonb;--> statement-breakpoint
ALTER TABLE "compliance_item" ADD COLUMN "ai_assessed_at" timestamp;
