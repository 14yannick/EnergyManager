ALTER TABLE "parties" ADD COLUMN "start_date" date;--> statement-breakpoint
ALTER TABLE "parties" ADD COLUMN "end_date" date;--> statement-breakpoint
ALTER TABLE "parties" ADD CONSTRAINT "parties_date_range_check" CHECK ("parties"."start_date" is null or "parties"."end_date" is null or "parties"."end_date" > "parties"."start_date");