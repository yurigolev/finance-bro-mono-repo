WITH starter_names(kind, old_name, new_name) AS (
  VALUES
    ('expense'::transaction_kind, 'Продукты', '🛒 Продукты'),
    ('expense', 'Кафе', '☕ Кафе'),
    ('expense', 'Транспорт', '🚇 Транспорт'),
    ('expense', 'Дом', '🏠 Дом'),
    ('expense', 'Здоровье', '🩺 Здоровье'),
    ('expense', 'Покупки', '🛍️ Покупки'),
    ('income', 'Зарплата', '💼 Зарплата'),
    ('income', 'Проекты', '🛠️ Проекты'),
    ('income', 'Подарки', '🎁 Подарки'),
    ('income', 'Проценты', '📈 Проценты')
)
UPDATE categories AS category
SET name = starter_names.new_name
FROM starter_names
WHERE category.kind = starter_names.kind
  AND category.name = starter_names.old_name
  AND (
    category.archived_at IS NOT NULL
    OR NOT EXISTS (
      SELECT 1 FROM categories AS existing
      WHERE existing.user_id = category.user_id
        AND existing.kind = category.kind
        AND existing.archived_at IS NULL
        AND lower(btrim(existing.name)) = lower(starter_names.new_name)
    )
  );
