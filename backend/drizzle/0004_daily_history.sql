ALTER TABLE "transactions" ADD COLUMN "occurred_at" timestamp with time zone;--> statement-breakpoint
UPDATE "transactions" SET "occurred_at" = "created_at";--> statement-breakpoint
ALTER TABLE "transactions" ALTER COLUMN "occurred_at" SET DEFAULT now(), ALTER COLUMN "occurred_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "time_zone" text;--> statement-breakpoint
CREATE INDEX "transactions_user_daily_idx" ON "transactions" USING btree ("user_id","occurred_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "transactions"."deleted_at" IS NULL;
