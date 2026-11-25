CREATE TABLE "budget_limit_versions" (
	"user_id" uuid NOT NULL,
	"category_id" uuid,
	"kind" "transaction_kind" DEFAULT 'expense' NOT NULL,
	"effective_month" date NOT NULL,
	"amount_kopecks" bigint,
	CONSTRAINT "budget_limit_versions_expense" CHECK ("budget_limit_versions"."kind" = 'expense'),
	CONSTRAINT "budget_limit_versions_month_start" CHECK (extract(day from "budget_limit_versions"."effective_month") = 1),
	CONSTRAINT "budget_limit_versions_positive_amount" CHECK ("budget_limit_versions"."amount_kopecks" > 0)
);
--> statement-breakpoint
ALTER TABLE "budget_limit_versions" ADD CONSTRAINT "budget_limit_versions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_limit_versions" ADD CONSTRAINT "budget_limit_versions_user_kind_category_fk" FOREIGN KEY ("user_id","kind","category_id") REFERENCES "public"."categories"("user_id","kind","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "budget_limit_versions_total_idx" ON "budget_limit_versions" USING btree ("user_id","effective_month") WHERE "budget_limit_versions"."category_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "budget_limit_versions_category_idx" ON "budget_limit_versions" USING btree ("user_id","category_id","effective_month") WHERE "budget_limit_versions"."category_id" IS NOT NULL;