# Expense Tracker — итоговый продуктовый и технический контекст

Это первоначальный план с фокусом на iOS и офлайн-вводе. С 21 ноября 2026 года первый клиент MVP — Telegram-бот. Разработка мобильного клиента отложена, [веб-клиент](../../web/README.md) переведён в легаси. См. [актуальный план Telegram MVP](02-telegram-mvp.md).

## 1. Основная идея продукта

Приложение для учета личных расходов со своей аналитикой.

Главная продуктовая проблема, которую нужно решить:

> **Ввод расхода должен быть настолько быстрым и простым, чтобы пользователю было проще записать расход, чем не записать его.**

Ключевая метрика для MVP:

- минимальное число действий;
- сохранение расхода за несколько секунд;
- отсутствие обязательной зависимости от интернета;
- ввод должен работать даже при плохой или полностью отсутствующей сети.

---

## 2. Главный пользовательский сценарий

Пример идеального flow:

1. Пользователь нажимает Action Button / системную кнопку быстрого запуска.
2. Говорит:
   - «480 кофе»
   - «850 такси домой»
   - «вчера 3200 ресторан»
   - «942 рубля продукты Магнит»
3. Голос распознается локально на iPhone.
4. Локальный парсер выделяет:
   - сумму;
   - валюту;
   - категорию;
   - магазин / merchant;
   - дату;
   - комментарий.
5. Расход сразу сохраняется в локальную базу.
6. Пользователь получает haptic / короткое подтверждение.
7. Когда появляется интернет, данные синхронизируются с сервером и при необходимости дополнительно обогащаются AI.

Критический принцип:

> **Никогда не блокировать сохранение расхода ожиданием сети, AI или облачного API.**

---

## 3. Почему offline-first обязателен

У пользователя часто отсутствует стабильный интернет.

Поэтому архитектура вида:

```text
Voice
→ HTTPS API
→ AI
→ Cloud DB
→ Success
```

не подходит.

Нужна обратная модель:

```text
Voice
→ Local Speech-to-Text
→ Local Parser
→ Local DB
→ Success

              ↓ позже

         Sync Queue
              ↓
           Backend
```

То есть сеть — это улучшение продукта, а не обязательная часть базового пользовательского сценария.

---

## 4. Siri: где она полезна, а где нет

Изначально рассматривался сценарий:

```text
Siri
→ App Intent
→ текст расхода
→ наш parser
→ DB
```

Плюсы Siri:

- системный voice entry point;
- можно запускать действие без открытия приложения;
- хорошо интегрируется с App Intents / Shortcuts;
- удобно как дополнительный канал ввода.

Но для нашего конкретного случая есть проблема:

- Siri как основной голосовой интерфейс слишком сильно зависит от доступности системных онлайн-возможностей;
- при плохой сети это делает основной сценарий ненадежным.

Поэтому итог:

> **Siri — дополнительный интерфейс, но не фундамент продукта.**

Главный сценарий должен работать независимо от Siri и интернета.

---

## 5. Собственный голосовой ввод

Предпочтительный основной flow:

```text
Action Button / Quick Capture
              ↓
         microphone
              ↓
     on-device speech-to-text
              ↓
         local parser
              ↓
          local DB
```

Преимущества:

- работает офлайн;
- полный контроль над UX;
- можно хранить raw text;
- можно контролировать запись аудио;
- можно оптимизировать parser конкретно под расходы;
- нет ожидания server round-trip;
- приложение сохраняет данные сразу.

Пример:

```text
"девятьсот сорок два рубля продукты магнит"
```

Результат:

```json
{
  "amount": 942,
  "currency": "RUB",
  "merchant": "Магнит",
  "category": "groceries",
  "rawText": "942 рубля продукты магнит",
  "syncStatus": "pending"
}
```

---

## 6. Нужно ли использовать AI при каждом вводе

Нет.

Для большинства расходов достаточно локального parser.

Например:

```text
"450 кофе"
```

можно превратить в:

```text
amount = 450
category = cafe
```

А:

```text
"760 такси домой"
```

в:

```text
amount = 760
category = taxi
note = домой
```

А:

```text
"вчера 3200 ресторан"
```

в:

```text
amount = 3200
date = yesterday
category = restaurant
```

Локальный parser может покрыть большую часть повседневных случаев правилами, словарями и эвристиками.

AI лучше использовать как второй слой:

```text
local parse
   ↓
сохранить сразу
   ↓
если интернет есть
   ↓
AI enrichment
```

Например:

```text
"полтора косаря посидели с ребятами в баре"
```

локально:

```text
amount = 1500
category = unknown
note = "посидели с ребятами в баре"
```

позже AI:

```text
category = Bars & Restaurants
```

---

## 7. Локальная модель данных

Минимальная сущность:

```text
Expense
-------------------------
id
timestamp
amount
currency
category
merchant
note
rawText
source
syncStatus
createdAt
updatedAt
```

Дополнительно могут понадобиться:

```text
Account
Category
Merchant
VoiceCapture
SyncOperation
BankTransaction
```

Для offline-first особенно важен `syncStatus`.

Например:

```text
synced
pending
failed
conflict
```

---

## 8. Синхронизация

Пример:

```text
LOCAL DATABASE
      │
      ├── Expense 1 ✅ synced
      ├── Expense 2 ⏳ pending
      ├── Expense 3 ⏳ pending
      └── Expense 4 ⏳ pending
                   │
                   ↓
             появился интернет
                   ↓
               batch sync
                   ↓
                backend
```

Требования:

- retries;
- idempotency;
- дедупликация;
- конфликт-резолв;
- приложение не должно показывать ошибку пользователю только потому, что сервер недоступен;
- локальные данные являются рабочей копией, а не кешем.

---

## 9. Сбер / банковская интеграция

Изначально хотелось автоматически получать расходы из Сбера.

Вывод на текущем этапе:

- прямую интеграцию с личными транзакциями Сбера не стоит делать зависимостью MVP;
- официальные банковские API и Open Banking могут стать хорошим последующим каналом;
- банковский импорт лучше проектировать как отдельный адаптер.

Пример абстракции:

```text
BankConnector
    ↓
Account
    ↓
Transaction
```

Важно:

> Не строить продукт на reverse engineering мобильного приложения банка, хранении логина/пароля или хрупких неофициальных интеграциях.

---

## 10. Интересная долгосрочная идея: voice + bank matching

Банк хорошо знает:

> **что произошло с деньгами**

Голосовой ввод знает:

> **зачем пользователь потратил деньги**

Пример:

Банк позже импортирует:

```text
-4 850 ₽
RESTAURANT MOSCOW
```

Пользователь заранее голосом сказал:

```text
"ужин с клиентом, рабочее"
```

Приложение может связать две записи:

```text
4 850 ₽
Restaurant
Work
Dinner with client
```

Это потенциально сильно интереснее обычного expense tracker.

---

## 11. PWA: что она может

PWA / web app подходит для:

- аналитики;
- графиков;
- категорий;
- фильтров;
- настроек;
- обычного ручного ввода;
- offline UI;
- IndexedDB / локального web storage;
- последующей синхронизации;
- быстрого продуктового прототипа.

Можно сделать:

```text
Next.js
React
TypeScript
PWA
```

и получить большую часть обычного приложения.

---

## 12. Почему PWA недостаточно для главной фичи

Главная проблема PWA — доступ к системным возможностям iPhone.

Для нашей идеи наиболее ценны:

- Action Button;
- App Intents;
- системные Quick Actions;
- Lock Screen / Control Center integrations;
- нативный audio session;
- нативное on-device speech recognition;
- надежный background lifecycle;
- haptics;
- локальные фоновые задачи.

Именно эти возможности дают UX:

```text
зажал кнопку
→ сказал
→ готово
```

В PWA скорее получится:

```text
разблокировал
→ открыл приложение
→ нажал микрофон
→ сказал
→ сохранил
```

Это уже заметно больше friction.

---

## 13. Итог по архитектуре приложения

Предпочтительная архитектура:

```text
┌──────────────────────────────┐
│ Native iOS Layer             │
│ Swift / SwiftUI              │
│                              │
│ • Action Button              │
│ • App Intents                │
│ • Quick Capture              │
│ • Microphone                 │
│ • on-device Speech-to-Text   │
│ • Haptics                    │
│ • Local DB                   │
│ • Sync Queue                 │
└──────────────┬───────────────┘
               │
               │ sync when online
               ▼
┌──────────────────────────────┐
│ Backend                      │
│                              │
│ • Auth                       │
│ • Cloud storage              │
│ • AI enrichment              │
│ • Bank connectors            │
│ • Analytics aggregation      │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│ Web / Analytics UI           │
│ Next.js / React              │
│                              │
│ • dashboards                 │
│ • filters                    │
│ • categories                 │
│ • reports                    │
│ • account settings           │
└──────────────────────────────┘
```

---

## 14. Рекомендуемый стек

### iOS

```text
Swift
SwiftUI
App Intents
WidgetKit
Speech
AVFoundation
```

### Локальная база

Варианты:

```text
SQLite
GRDB
SwiftData
```

Для серьезного offline-first приложения имеет смысл внимательно сравнить GRDB и SwiftData.

### Web

```text
Next.js
React
TypeScript
```

### Backend

Варианты:

```text
PostgreSQL
Supabase
или собственный API
```

### Sync

```text
local-first queue
→ retries
→ batch sync
→ idempotent API
```

---

## 15. Почему не React Native / Flutter как основной выбор

Они технически возможны.

Например:

```text
React Native
├── основной UI
├── JS / TS logic
└── native Swift module
      ├── App Intent
      ├── Speech
      └── Action Button
```

Но ключевая ценность продукта лежит как раз в глубокой интеграции с iOS.

Поэтому на старте native Swift уменьшает количество мостов, edge cases и проблем с системными API.

Если приложение позже понадобится на Android, архитектуру backend/domain logic можно переиспользовать отдельно.

---

## 16. Возможный web-first компромисс

Если хочется очень быстро проверить продукт:

### Шаг 1

Сделать web/PWA:

```text
Next.js
React
TypeScript
local storage / IndexedDB
basic analytics
manual expense input
```

### Шаг 2

Параллельно сделать очень маленький native prototype:

```text
Action Button
→ Quick Capture
→ 2-3 sec recording
→ offline Russian STT
→ local save
```

### Шаг 3

Проверить главное:

> Насколько удобно реально записывать расходы таким способом каждый день?

Если UX работает — расширять native клиент.

Если нет — большая часть продукта уже существует в web.

---

## 17. Какой MVP сейчас выглядит самым разумным

Не начинать со Сбера, сложного AI или большого dashboard.

Сначала подтвердить основной interaction loop.

### MVP 0 — technical spike

Один экран / один flow:

```text
Action Button
→ microphone
→ Russian offline STT
→ raw text
→ local DB
→ haptic confirmation
```

Проверяем:

- скорость запуска;
- качество русского STT;
- работу без интернета;
- можно ли пользоваться flow каждый день.

### MVP 1

Добавить локальный parser:

```text
"450 кофе"
→ 450 ₽
→ Cafe
```

```text
"850 такси домой"
→ 850 ₽
→ Taxi
→ "домой"
```

Добавить простой список расходов.

### MVP 2

Добавить:

- категории;
- исправление ошибочно распознанного расхода;
- локальную аналитику;
- sync queue;
- backend.

### MVP 3

Добавить:

- web dashboard;
- AI enrichment;
- merchant normalization;
- умную категоризацию;
- Siri как дополнительный input;
- банковские connectors / imports.

---

## 18. Самая важная продуктовая гипотеза

Не:

> «Можем ли мы технически распознавать голос?»

А:

> **Будет ли пользователь действительно регулярно записывать расходы, если на это уходит условно 2–4 секунды и не нужно открывать приложение?**

Именно эту гипотезу нужно проверять первой.

---

## 19. Product principles

1. **Offline-first.**
2. **Local save before cloud sync.**
3. **Zero waiting for AI.**
4. **Voice-first, but not voice-only.**
5. **Minimum friction over maximum functionality.**
6. **Bank integration is an enhancement, not MVP dependency.**
7. **Native iOS code only where it gives real platform leverage.**
8. **Analytics can remain web-first for a long time.**
9. **Every expense must be recoverable/editable.**
10. **Raw input should be preserved for debugging and reprocessing.**

---

## 20. Что нужно проверить до начала полноценной разработки

Технический spike должен ответить на следующие вопросы:

- Насколько хорошо русский язык распознается on-device на целевом iPhone?
- Можно ли сделать нужный Action Button / App Intent flow без лишнего открытия интерфейса?
- Насколько быстро активируется microphone capture?
- Как ведет себя приложение на locked device?
- Какие ограничения есть у background audio / intents?
- Какой UX лучше:
  - tap;
  - long press;
  - Action Button;
  - Lock Screen control?
- Стоит ли хранить raw audio или достаточно raw text?
- Какой локальный parser дает достаточно высокую точность без LLM?
- Какую локальную БД выбрать: SwiftData / GRDB / SQLite?
- Как реализовать conflict-safe sync?
- Какие реальные официальные возможности банковского API доступны для физических лиц на момент интеграции?

Некоторые системные ограничения iOS и банковских API необходимо повторно проверить по актуальной документации непосредственно перед реализацией, поскольку они меняются между версиями iOS и API.

---

## 21. Текущее направление

Наиболее логичный путь проекта:

```text
Native iOS Quick Capture
        +
offline speech recognition
        +
local parser
        +
local database
        ↓
background sync when available
        ↓
backend / AI / analytics
        ↓
bank integration later
```

Если сформулировать продукт одной строкой:

> **Expense tracker, в котором фиксация расхода занимает несколько секунд, работает без интернета и не требует открывать приложение.**
