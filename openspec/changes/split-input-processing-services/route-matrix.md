# Исходная карта маршрутов

Срез текущего рабочего дерева до разделения сервисов. Имена в таблице относятся к действующим методам `TelegramDependencies` и публичным HTTP-маршрутам.

## Telegram → финансовое ядро

У каждого сценария с доступом к данным `withOwner` вызывает `users.getOrCreateUser(telegramId)` и передаёт внутренний ID владельца следующему вызову. Ошибка зависимости превращается в `undefined` для текущего экрана. Текущие настройки чата, блокировки по ключу обновления и хранение состояния диалогов принадлежат боту. [Регистрация](../../../backend/src/telegram/bot.ts) · [Интерфейс](../../../backend/src/telegram/dependencies.ts) · [Сборка зависимостей](../../../backend/src/app.ts)

| Сценарий и клавиши | Текущие вызовы |
| --- | --- |
| `/start`, `/help`, «Помощь», неизвестная команда | Справка без вызова ядра. |
| Текст и голос, подтверждение даты новой операции, `choose:…` | `transactions.recordOperation`. Для ввода с датой сначала `users.getTimeZone`. Если запись создана без категории и без предложенных совпадений, `categories.listCategories`. |
| Дата сохранённой операции, `date:edit:…`, `date:…` | `transactions.getOperation` при открытии, `setOperationDate` при сохранении и `getOperation` для обновления чека. |
| Выбор категории в чеке, `pick` / `rp`, `set` / `rs` | `transactions.getOperationKind`, `categories.listCategories`, `transactions.getOperation` для возврата к чеку. Запись через `categories.setCategory`, затем `getOperation` и `categories.canRememberCategory` для кнопки запоминания. |
| Запоминание категории и удаление из чека, `rm`, `rv`, старый `remove` | `categories.rememberCategory` и `transactions.getOperation`, либо `transactions.remove` для `rv`. Старый `remove` отклоняется как недоступный. |
| `/recent`, «История», навигация `h` / `he` | `transactions.loadDailyHistory` с выбранной датой или без даты для «сегодня». |
| Карточка и правки в истории, `ho`, `hd`, `hp`, `hs`, `hc` | `transactions.getOperation` для карточки и подтверждения удаления. Выбор через `getOperationKind` и `categories.listCategories`, запись через `categories.setCategory`, удаление через `transactions.remove`. После мутаций перечитывается дневная история. |
| «Статистика» | `transactions.loadDailyHistory`, затем `budgets.monthlyBudget` по месяцу и часовому поясу истории. При сбое бюджета показывается статистика без него. |
| `/budgets`, «Бюджеты», `b:open`, `b:current`, `b:view`, `b:pick`, `b:scope`, `b:edit`, `b:off` и ответ на запрос суммы | `budgets.viewBudget`, `listBudgetCategoryChoices`, `viewBudgetLimit`, `changeBudgetLimit` для изменения, сброса суммы или отключения категории. |
| `/timezone` | `users.getTimeZone` для чтения, `setTimeZone` для изменения и сброса. |
| `/categories`, «Настройки», `settings:menu`, `catalog` / `catalog-page`, `details`, `rename`, `add`, `archive` и ответ с названием | Вход в меню без запроса. Каталог и детали через `categories.listCategories`, правки через `addCategory`, `renameCategory`, `archiveCategory` и повторную загрузку списка. |
| Настройки правил, `rules` / `rules-page`, `rd` | `categories.listCategoryRules`, `deleteCategoryRule` с ID правила и ожидаемой категорией, затем повторный список. |
| Встроенные слова, `bw:menu`, `bw:find`, `bg`, `bw`, `bp`, `bt`, `bm`, `bb` и ответ на поиск | Начальный список групп и поиск по встроенным словам локальны. Текущие назначения через `categories.listBuiltInTargets` и `getBuiltInRule`. Мутации через `changeBuiltInRule` и `bindBuiltInGroup`. |
| Остальные callback'и | Локальный ответ «Действие недоступно». |

В `TelegramDependencies.transactions` также входят `recent` и `dailyHistory`. Telegram-экраны вызывают `loadDailyHistory`, который сам использует `dailyHistory` и часовой пояс. `recent` и прямой вызов `dailyHistory` используются тестами. При выделении HTTP-адаптера эти два метода можно оставить за клиентской границей, сохранив доступ внутри приложения и тестов. [Репозиторий операций](../../../backend/src/transactions/repository.ts) · [История](../../../backend/src/telegram/history/handlers.ts)

### Контрольные условия для внутреннего адаптера

- Сохранить различия между `null`, `false`, бизнес-статусами и исключением зависимости. Для совместимой записи сохранить `created` с `id`, `kind`, `categoryName` и опциональным `categoryChoices`, а также `kind-required` и `duplicate`.
- Сохранять точность `bigint` в суммах истории, операций и бюджетов. Для транспорта использовать десятичные строки, а даты сущностей (`createdAt`, `archivedAt`) передавать как ISO-строки и восстанавливать где требуется. Отсутствующая дата дневной истории означает сегодня, `null` означает недопустимый выбор.
- Привязка владельца к Telegram ID продолжается на ядре. ID операции и категории из callback'а сами по себе не авторизуют действие. В публичной аналитике неизвестный владелец даёт пустой обзор, в настройках и истории используется `getOrCreateUser`.
- Сохранить ключи `telegram:<update_id>`, `telegram:voice:<chat_id>:<message_id>` и `mini-app:<requestId>`. Для даты, категории, бюджетов и выбора типа сохранить порядок обработки callback'ов и ответов в боте. [Регистрация ввода](../../../backend/src/telegram/operations/entry/handlers.ts) · [Сессии](../../../backend/src/telegram/context.ts)

## Mini App → публичный API

Все маршруты идут same-origin через nginx `/api/` с `X-Telegram-Init-Data`. Текущий upstream `bot:${ANALYTICS_HTTP_PORT:-8787}`. Сервер проверяет подпись и срок данных запуска. Общие ответы `404 not_found`, `405 method_not_allowed` с `Allow`, `401 invalid_telegram_init_data`. [Публичный HTTP-сервер](../../../backend/src/analytics/http.ts) · [Прокси](../../../mini-app/nginx.conf.template) · [Compose](../../../compose.yaml)

| Метод и путь | Потребители и контракт |
| --- | --- |
| `GET /api/analytics/overview` | Главная, бюджеты, сравнение текущего и прошлого месяца. Один `period`. Для `custom` по одному `startDate` и `endDate`. Ответ `200` с обзором или `400 invalid_period` / `500 analytics_unavailable`. |
| `GET /api/settings` | Страница «Настройки» и форма добавления операции. Ответ `200` с `timeZone`, категориями обоих типов, правилами и группами. |
| `PATCH /api/settings` | Страница «Настройки». Действия `time-zone`, `add-category`, `rename-category`, `archive-category`, `delete-rule`, `change-word`, `bind-group`. Ответ `204` или `400 invalid_settings/invalid`, `409 duplicate/unavailable`, `413 body_too_large`, `500 settings_unavailable`. |
| `GET /api/transactions` | Страница «История». Опциональный `month=YYYY-MM`, будущие месяцы отклоняются. Ответ `200` с месяцем, датой «сегодня», часовым поясом и операциями, суммы в копейках передаются строками. Ошибки `400 invalid_month`, `500 transactions_unavailable`. |
| `POST /api/transactions` | Форма добавления операции. JSON с `kind`, строкой `amountKopecks`, `description`, `date`, `categoryId` и UUID `requestId`. Ответ `204` также при повторе, `400 invalid_operation/invalid_date`, `409 category_unavailable`, `413 body_too_large` или `500 transactions_unavailable`. |

Источники маршрутов и вызовов: [аналитика Mini App](../../../mini-app/app/composables/useAnalyticsOverview.ts) · [настройки](../../../backend/src/settings/http.ts) · [операции](../../../backend/src/transactions/http.ts) · [история Mini App](../../../mini-app/app/pages/history.vue) · [форма операции](../../../mini-app/app/components/HistoryEntryDialog.vue).
