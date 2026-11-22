CREATE TABLE "category_rules" (
	"user_id" uuid NOT NULL,
	"kind" "transaction_kind" NOT NULL,
	"expression" text NOT NULL,
	"category_id" uuid NOT NULL,
	CONSTRAINT "category_rules_user_id_kind_expression_pk" PRIMARY KEY("user_id","kind","expression"),
	CONSTRAINT "category_rules_expression_length" CHECK (char_length("category_rules"."expression") BETWEEN 1 AND 200)
);
--> statement-breakpoint
ALTER TABLE "category_rules" ADD CONSTRAINT "category_rules_user_kind_category_fk" FOREIGN KEY ("user_id","kind","category_id") REFERENCES "public"."categories"("user_id","kind","id") ON DELETE no action ON UPDATE no action;