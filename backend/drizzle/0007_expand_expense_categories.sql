WITH starter_names(starter_key, name) AS (
  VALUES
    ('travel', '✈️ Путешествия'),
    ('subscriptions', '🔁 Подписки'),
    ('clothing', '👕 Одежда и обувь'),
    ('electronics', '💻 Техника'),
    ('beauty', '💅 Красота и уход'),
    ('education', '🎓 Образование')
), initialized_users AS (
  SELECT DISTINCT user_id FROM categories
), existing_starters AS (
  SELECT user_id, starter_key FROM categories
  WHERE kind = 'expense' AND starter_key IN (SELECT starter_key FROM starter_names)
), matches AS (
  SELECT DISTINCT ON (category.user_id, starter.starter_key)
    category.id, starter.starter_key
  FROM starter_names AS starter
  JOIN categories AS category ON category.kind = 'expense'
    AND category.archived_at IS NULL AND category.starter_key IS NULL
    AND (lower(btrim(category.name)) = lower(starter.name)
      OR lower(btrim(category.name)) = lower(substr(starter.name, strpos(starter.name, ' ') + 1)))
  WHERE NOT EXISTS (
    SELECT 1 FROM existing_starters AS existing
    WHERE existing.user_id = category.user_id AND existing.starter_key = starter.starter_key
  )
  ORDER BY category.user_id, starter.starter_key,
    (lower(btrim(category.name)) = lower(starter.name)) DESC
), adopted AS (
  UPDATE categories AS category SET starter_key = matches.starter_key
  FROM matches WHERE category.id = matches.id
  RETURNING category.user_id, category.starter_key
)
INSERT INTO categories (user_id, kind, name, starter_key)
SELECT owner.user_id, 'expense', starter.name, starter.starter_key
FROM initialized_users AS owner CROSS JOIN starter_names AS starter
WHERE NOT EXISTS (
  SELECT 1 FROM existing_starters AS existing
  WHERE existing.user_id = owner.user_id AND existing.starter_key = starter.starter_key
) AND NOT EXISTS (
  SELECT 1 FROM adopted
  WHERE adopted.user_id = owner.user_id AND adopted.starter_key = starter.starter_key
)
ON CONFLICT DO NOTHING;
