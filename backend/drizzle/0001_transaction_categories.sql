CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "transaction_kind" NOT NULL,
	"name" text NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "categories_user_kind_id" UNIQUE("user_id","kind","id"),
	CONSTRAINT "categories_name_length" CHECK (char_length(btrim("categories"."name")) BETWEEN 1 AND 60)
);
--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "category_id" uuid;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "categories_active_name_idx" ON "categories" USING btree ("user_id","kind",lower(btrim("name"))) WHERE "categories"."archived_at" IS NULL;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_user_kind_category_fk" FOREIGN KEY ("user_id","kind","category_id") REFERENCES "public"."categories"("user_id","kind","id") ON DELETE no action ON UPDATE no action;