-- Keep historical operations linked to their original category and type.
UPDATE categories SET archived_at = now()
WHERE kind = 'income' AND starter_key = 'gifts' AND archived_at IS NULL
  AND lower(btrim(name)) IN ('🎁 подарки', 'подарки');
--> statement-breakpoint
WITH existing_starters AS (
  SELECT user_id FROM categories WHERE kind = 'expense' AND starter_key = 'gifts'
), matches AS (
  SELECT DISTINCT ON (category.user_id) category.id
  FROM categories AS category
  WHERE category.kind = 'expense' AND category.archived_at IS NULL AND category.starter_key IS NULL
    AND lower(btrim(category.name)) IN ('🎁 подарки', 'подарки')
    AND NOT EXISTS (SELECT 1 FROM existing_starters AS existing WHERE existing.user_id = category.user_id)
  ORDER BY category.user_id, (lower(btrim(category.name)) = '🎁 подарки') DESC
), adopted AS (
  UPDATE categories AS category SET starter_key = 'gifts'
  FROM matches WHERE category.id = matches.id
  RETURNING category.user_id
)
INSERT INTO categories (user_id, kind, name, starter_key)
SELECT DISTINCT category.user_id, 'expense'::transaction_kind, '🎁 Подарки', 'gifts'
FROM categories AS category
WHERE NOT EXISTS (SELECT 1 FROM existing_starters AS existing WHERE existing.user_id = category.user_id)
  AND NOT EXISTS (SELECT 1 FROM adopted WHERE adopted.user_id = category.user_id)
ON CONFLICT DO NOTHING;
