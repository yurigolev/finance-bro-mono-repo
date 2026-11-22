ALTER TABLE "category_rules" ADD COLUMN "id" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "category_rules" ADD CONSTRAINT "category_rules_id_unique" UNIQUE("id");