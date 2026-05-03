CREATE TABLE "proposal_winner_analysis" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "proposal_id" uuid NOT NULL UNIQUE,
  "organization_id" uuid NOT NULL,
  "competitor_name" text NOT NULL DEFAULT '',
  "winner_profile_summary" text NOT NULL DEFAULT '',
  "gaps_we_had" text NOT NULL DEFAULT '',
  "our_strengths_unrecognized" text NOT NULL DEFAULT '',
  "recommendations" text NOT NULL DEFAULT '',
  "source_usaspending" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "model" text NOT NULL DEFAULT '',
  "stubbed" boolean NOT NULL DEFAULT false,
  "created_by_user_id" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "proposal_winner_analysis" ADD CONSTRAINT "proposal_winner_analysis_proposal_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposal"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "proposal_winner_analysis" ADD CONSTRAINT "proposal_winner_analysis_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "proposal_winner_analysis" ADD CONSTRAINT "proposal_winner_analysis_created_by_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
