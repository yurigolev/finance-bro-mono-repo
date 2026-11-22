ALTER TABLE "category_rules" ALTER COLUMN "category_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "starter_key" text;--> statement-breakpoint
ALTER TABLE "category_rules" ADD CONSTRAINT "category_rules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_user_kind_starter_key" UNIQUE("user_id","kind","starter_key");--> statement-breakpoint
WITH starter_names(kind, starter_key, name) AS (
  VALUES
    ('expense'::transaction_kind, 'groceries', '🛒 Продукты'),
    ('expense', 'dining', '☕ Кафе'),
    ('expense', 'transport', '🚇 Транспорт'),
    ('expense', 'housing', '🏠 Дом'),
    ('expense', 'health', '🩺 Здоровье'),
    ('expense', 'shopping', '🛍️ Покупки'),
    ('income', 'salary', '💼 Зарплата'),
    ('income', 'projects', '🛠️ Проекты'),
    ('income', 'gifts', '🎁 Подарки'),
    ('income', 'interest', '📈 Проценты')
), matches AS (
  SELECT DISTINCT ON (category.user_id, starter.kind, starter.starter_key)
    category.id, starter.starter_key
  FROM starter_names AS starter
  JOIN categories AS category ON category.kind = starter.kind
    AND (lower(btrim(category.name)) = lower(starter.name)
      OR lower(btrim(category.name)) = lower(substr(starter.name, strpos(starter.name, ' ') + 1)))
  WHERE category.archived_at IS NULL
  ORDER BY category.user_id, starter.kind, starter.starter_key,
    (lower(btrim(category.name)) = lower(starter.name)) DESC
)
UPDATE categories SET starter_key = matches.starter_key FROM matches WHERE categories.id = matches.id;
