CREATE TYPE "public"."company_relationship" AS ENUM('customer', 'prime', 'subcontractor', 'competitor', 'teaming_partner', 'watchlist');--> statement-breakpoint
CREATE TABLE "company" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"uei" text DEFAULT '' NOT NULL,
	"cage_code" text DEFAULT '' NOT NULL,
	"duns_number" text DEFAULT '' NOT NULL,
	"website" text DEFAULT '' NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"contact_name" text DEFAULT '' NOT NULL,
	"contact_title" text DEFAULT '' NOT NULL,
	"address_line1" text DEFAULT '' NOT NULL,
	"address_line2" text DEFAULT '' NOT NULL,
	"city" text DEFAULT '' NOT NULL,
	"state" text DEFAULT '' NOT NULL,
	"zip" text DEFAULT '' NOT NULL,
	"country" text DEFAULT 'USA' NOT NULL,
	"primary_naics" text DEFAULT '' NOT NULL,
	"naics_list" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"sba_certifications" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"registration_status" text DEFAULT '' NOT NULL,
	"registration_expiration_date" timestamp,
	"relationship" "company_relationship" DEFAULT 'watchlist' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"sync_source" text DEFAULT 'manual' NOT NULL,
	"last_synced_at" timestamp,
	"created_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "company" ADD CONSTRAINT "company_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company" ADD CONSTRAINT "company_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;