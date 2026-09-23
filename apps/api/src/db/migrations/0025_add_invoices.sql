CREATE TYPE "public"."invoice_status" AS ENUM('issued', 'paid', 'cancelled');--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"party_id" uuid NOT NULL,
	"party_reference" text,
	"party_name" text NOT NULL,
	"period_from" date NOT NULL,
	"period_to" date NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"grid_kwh" numeric(14, 4) NOT NULL,
	"local_kwh" numeric(14, 4) NOT NULL,
	"self_direct_kwh" numeric(14, 4) DEFAULT '0' NOT NULL,
	"self_battery_kwh" numeric(14, 4) DEFAULT '0' NOT NULL,
	"total_chf" numeric(12, 2) NOT NULL,
	"saving_chf" numeric(12, 2) NOT NULL,
	"status" "invoice_status" DEFAULT 'issued' NOT NULL,
	"paid_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"detail" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_active_period_idx" ON "invoices" USING btree ("party_id","period_from","period_to") WHERE "invoices"."status" != 'cancelled';--> statement-breakpoint
CREATE INDEX "invoices_batch_idx" ON "invoices" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "invoices_site_status_idx" ON "invoices" USING btree ("site_id","status");