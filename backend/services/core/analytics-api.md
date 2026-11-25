# API аналитики Mini App

`GET /api/analytics/overview?period=current-month` на том же origin, что и Mini App. Клиент передаёт неизменённый `Telegram.WebApp.initData` в заголовке `X-Telegram-Init-Data`. Сервер проверяет подпись Telegram и `auth_date`, затем находит владельца по подписанному `user.id`. У пользователя без профиля обзор пустой, часовой пояс UTC.

| `period` | Календарные дни в часовом поясе профиля |
| --- | --- |
| `current-month` | С первого числа текущего месяца по сегодня |
| `last-7-days` | Сегодня и шесть предыдущих дней |
| `previous-month` | Весь предыдущий месяц |

В ответе `200` даты включительны. Суммы передаются десятичными строками в копейках. Даты идут по возрастанию и включают дни с нулевыми суммами. Категории идут по убыванию суммы, при равенстве — по названию и ID. У «Без категории» `id` равен `null`. Доля категории вычисляется от `totals.expenseKopecks`.

```json
{
  "period": "current-month",
  "startDate": "2026-11-01",
  "endDate": "2026-11-01",
  "timeZone": "UTC",
  "usesUtcFallback": true,
  "currency": "RUB",
  "operationCount": 2,
  "budget": { "month": "2026-11-01", "spentKopecks": "12550", "limitKopecks": "5000000", "categories": [] },
  "totals": { "incomeKopecks": "100000", "expenseKopecks": "12550", "differenceKopecks": "87450" },
  "days": [{ "date": "2026-11-01", "incomeKopecks": "100000", "expenseKopecks": "12550" }],
  "expenseCategories": [{ "id": null, "name": "Без категории", "amountKopecks": "12550" }]
}
```

| Статус | Значение `error` |
| --- | --- |
| `400` | `invalid_period` |
| `401` | `invalid_telegram_init_data` |
| `500` | `analytics_unavailable` |

Поле `budget` показывает текущий календарный месяц в часовом поясе владельца при любом `period`. `month` содержит первое число месяца. Общий лимит может быть `null`. Категории с действующим лимитом содержат `id`, `name`, `spentKopecks` и `limitKopecks`.

Все ответы имеют `Cache-Control: no-store`. При `401` пользователь открывает Mini App из меню бота повторно.

HTTP включается при заданном `ANALYTICS_HTTP_PORT`. `ANALYTICS_HTTP_HOST` по умолчанию `127.0.0.1`. За HTTPS-прокси в общей контейнерной сети используется `0.0.0.0`. `ANALYTICS_INIT_DATA_MAX_AGE_SECONDS` по умолчанию `3600`. Подпись проверяется тем же серверным `BOT_TOKEN`, с которым запущен бот.
