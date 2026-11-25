CREATE TYPE "public"."transaction_kind" AS ENUM('expense', 'income');--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "transaction_kind" NOT NULL,
	"amount_kopecks" bigint NOT NULL,
	"currency" text DEFAULT 'RUB' NOT NULL,
	"description" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"idempotency_key" text NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "transactions_user_idempotency_key" UNIQUE("user_id","idempotency_key"),
	CONSTRAINT "transactions_positive_amount" CHECK ("transactions"."amount_kopecks" > 0),
	CONSTRAINT "transactions_rub_currency" CHECK ("transactions"."currency" = 'RUB'),
	CONSTRAINT "transactions_nonempty_description" CHECK (btrim("transactions"."description") <> '')
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"telegram_id" bigint NOT NULL,
	CONSTRAINT "users_telegram_id_unique" UNIQUE("telegram_id")
);
--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "transactions_user_recent_idx" ON "transactions" USING btree ("user_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "transactions"."deleted_at" IS NULL;