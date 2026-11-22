import assert from 'node:assert/strict'
import { randomInt } from 'node:crypto'
import test from 'node:test'
import { Api, Bot } from 'grammy'
import type { Message, ReplyKeyboardMarkup, Update } from 'grammy/types'
import { createApplication } from '../src/app.ts'
import { createBudgetViews } from '../src/budgets/service.ts'
import { createDatabase } from '../src/db/client.ts'
import { createBot } from '../src/telegram/bot.ts'
import {
  createTelegramSession,
  type BotContext,
  type TelegramSession,
} from '../src/telegram/context.ts'
import type { TelegramDependencies } from '../src/telegram/dependencies.ts'
import { createVoiceTranscriber, type TranscribeVoice } from '../src/telegram/operations/voice.ts'
import { createLoadDailyHistory } from '../src/transactions/service.ts'
import type { RecordOperationResult } from '../src/transactions/types.ts'

const telegramUser = { id: 123, is_bot: false, first_name: 'Пользователь' }
const privateChat = {
  type: 'private',
  id: telegramUser.id,
  first_name: telegramUser.first_name,
} as const
const botInfo = {
  id: 456,
  is_bot: true,
  first_name: 'FinanceBro Test',
  username: 'financebro_test_bot',
  can_join_groups: false,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false,
  has_topics_enabled: false,
  allows_users_to_create_topics: false,
  can_manage_bots: false,
  supports_join_request_queries: false,
} as const
const ownerId = '10000000-0000-4000-8000-000000000000'
const otherOwnerId = '11000000-0000-4000-8000-000000000000'
const operationId = '20000000-0000-4000-8000-000000000000'
const incomeId = '21000000-0000-4000-8000-000000000000'
const categoryId = '30000000-0000-4000-8000-000000000000'
const incomeCategoryId = '31000000-0000-4000-8000-000000000000'
const operationDraft = { amountKopecks: 48_000n, description: 'кофе' }
const operation = { kind: 'expense', ...operationDraft } as const
const textKey = 'telegram:42'
const incomeDraft = { amountKopecks: 1_500_000n, description: 'проект' }
const income = { kind: 'income', ...incomeDraft } as const
const savedExpense = {
  status: 'created',
  id: operationId,
  kind: 'expense',
  categoryName: null,
} as const
const savedIncome = { status: 'created', id: incomeId, kind: 'income', categoryName: null } as const
type TextUpdate = Update & { message: Message.TextMessage }
type InlineButton = { text: string; callback_data: string; style?: string }
type ApiCall = {
  method: string
  payload: unknown
  message?: Message.TextMessage & { photo?: Message.PhotoMessage['photo'] }
}

function textUpdate(text: string, chat: TextUpdate['message']['chat'] = privateChat): TextUpdate {
  const command = /^\/\S+/u.exec(text)?.[0]
  const entities = command
    ? [{ type: 'bot_command' as const, offset: 0, length: command.length }]
    : []
  return {
    update_id: 42,
    message: { message_id: 1, from: telegramUser, chat, date: 1, text, entities },
  }
}

function voiceUpdate(duration = 3): Update & { message: Message.VoiceMessage } {
  return {
    update_id: 42,
    message: {
      message_id: 7,
      from: telegramUser,
      chat: privateChat,
      date: 1,
      voice: { duration, file_id: 'voice-file', file_unique_id: 'unique-voice-file' },
    },
  }
}

test('ignores malformed Telegram text, voice and callback payloads', async () => {
  const { calls, dispatch } = harness()
  const text = textUpdate('480 кофе')
  const voice = voiceUpdate()
  const invalidUpdates = [
    { ...text, update_id: '42' },
    { ...text, message: { ...text.message, text: 480 } },
    { ...voice, message: { ...voice.message, voice: { ...voice.message.voice, duration: '3' } } },
    {
      update_id: 43,
      callback_query: { id: 'callback', from: telegramUser, data: 42, message: text.message },
    },
  ]

  for (const update of invalidUpdates) await dispatch(update as unknown as Update)
  assert.deepEqual(calls, [])
})

test('grammY session shares state across overlapping updates and drops expired state', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1000 })
  const bot = new Bot<BotContext>('fake-token', { botInfo })
  const entered = Promise.withResolvers<TelegramSession>()
  const release = Promise.withResolvers<void>()
  const observed: TelegramSession[] = []
  bot.use(createTelegramSession())
  bot.on('message:text', async (ctx) => {
    const state = ctx.session
    observed.push(state)
    if (ctx.message.text === 'hold') {
      entered.resolve(state)
      await release.promise
      state.operationKindPrompts = {
        [textKey]: {
          telegramId: telegramUser.id,
          messageId: 10,
          expires: 2000,
          operation: operationDraft,
        },
      }
    }
  })

  await bot.handleUpdate(textUpdate('empty'))
  const pending = bot.handleUpdate(textUpdate('hold'))
  const shared = await entered.promise
  try {
    assert.notEqual(shared, observed[0])
    await bot.handleUpdate(textUpdate('overlap'))
    assert.equal(observed.at(-1), shared)
  } finally {
    release.resolve()
    await pending
  }
  await bot.handleUpdate(textUpdate('active'))
  assert.equal(observed.at(-1), shared)

  t.mock.timers.setTime(2000)
  await bot.handleUpdate(textUpdate('expire'))
  await bot.handleUpdate(textUpdate('after expiry'))
  assert.deepEqual(observed.at(-1), {})
  assert.notEqual(observed.at(-1), shared)
})

test('validates the text field in Whisper responses', async (t) => {
  const api = new Api('fake-token')
  api.config.use(async (_previous, method, payload) => {
    assert.equal(method, 'getFile')
    assert.deepEqual(payload, { file_id: 'voice-file' })
    return {
      ok: true,
      result: {
        file_id: 'voice-file',
        file_unique_id: 'unique-file',
        file_path: 'voices/voice.ogg',
      } as never,
    }
  })
  let body: unknown = { text: '480 кофе', language: 'ru' }
  const whisperUrl = 'https://whisper.example/inference'
  t.mock.method(globalThis, 'fetch', async (input: URL | string) => {
    if (input === whisperUrl) return Response.json(body)
    assert.equal(String(input), 'https://api.telegram.org/file/botfake-token/voices/voice.ogg')
    return new Response(new Uint8Array([1]))
  })
  const transcribe = createVoiceTranscriber(whisperUrl)

  assert.equal(await transcribe(api, 'voice-file'), '480 кофе')
  body = { text: 480 }
  await assert.rejects(transcribe(api, 'voice-file'), {
    message: 'Invalid transcription response',
  })
})

type MockDependencies = TelegramDependencies['users'] &
  TelegramDependencies['transactions'] &
  TelegramDependencies['categories'] &
  TelegramDependencies['budgets']

function harness(
  {
    getOrCreateUser = async (telegramId) => {
      assert.equal(telegramId, telegramUser.id)
      return ownerId
    },
    getTimeZone = async () => null,
    setTimeZone = async () => 'unavailable',
    recordOperation = async () => {
      throw new Error('unexpected recordOperation call')
    },
    recent = async () => [],
    dailyHistory = async () => [],
    remove = async () => false,
    getOperationKind = async () => null,
    getOperation = async () => null,
    setOperationDate = async () => false,
    listCategories = async () => [],
    addCategory = async () => 'unavailable',
    renameCategory = async () => 'unavailable',
    archiveCategory = async () => false,
    setCategory = async () => false,
    canRememberCategory = async () => false,
    rememberCategory = async () => false,
    listCategoryRules = async () => [],
    deleteCategoryRule = async () => false,
    listBuiltInTargets = async () => [],
    getBuiltInRule = async () => null,
    changeBuiltInRule = async () => false,
    bindBuiltInGroup = async () => false,
    monthlyBudget = async () => ({ totalSpent: 0n, totalLimit: null, categories: [] }),
    changeBudgetLimit = async () => 'unavailable',
  }: Partial<MockDependencies> = {},
  rejectRichMessage = false,
  transcribeVoice?: TranscribeVoice,
) {
  return botHarness(
    {
      users: { getOrCreateUser, getTimeZone, setTimeZone },
      transactions: {
        recordOperation,
        recent,
        dailyHistory,
        remove,
        getOperationKind,
        getOperation,
        setOperationDate,
        loadDailyHistory: createLoadDailyHistory({ getTimeZone, dailyHistory }),
      },
      categories: {
        listCategories,
        addCategory,
        renameCategory,
        archiveCategory,
        setCategory,
        canRememberCategory,
        rememberCategory,
        listCategoryRules,
        deleteCategoryRule,
        listBuiltInTargets,
        getBuiltInRule,
        changeBuiltInRule,
        bindBuiltInGroup,
      },
      budgets: {
        monthlyBudget,
        changeBudgetLimit,
        ...createBudgetViews({ getTimeZone, listCategories, monthlyBudget }),
      },
    },
    rejectRichMessage,
    transcribeVoice,
  )
}

function botHarness(
  dependencies: TelegramDependencies,
  rejectRichMessage = false,
  transcribeVoice?: TranscribeVoice,
) {
  const bot = createBot('fake-token', dependencies, transcribeVoice)
  bot.botInfo = botInfo
  const calls: ApiCall[] = []
  bot.api.config.use(async (_previous, method, payload) => {
    const isRich = 'rich_message' in (payload as object)
    if (isRich && rejectRichMessage) {
      calls.push({ method, payload })
      return { ok: false, error_code: 400, description: 'Bad Request' }
    }
    const messageId = (payload as { message_id?: number }).message_id
    const existing = calls.findLast(({ message }) => message?.message_id === messageId)?.message
    const fields = payload as { text?: string; caption?: string; media?: { caption?: string } }
    const text = isRich
      ? (payload as { rich_message?: { html: string } }).rich_message?.html
      : method === 'editMessageReplyMarkup'
        ? existing?.text
        : (fields.text ?? fields.caption ?? fields.media?.caption)
    const message: ApiCall['message'] =
      (isRich ||
        /^(?:sendMessage|sendPhoto|editMessage(?:Text|Caption|Media|ReplyMarkup))$/u.test(
          method,
        )) &&
      text !== undefined
        ? {
            message_id: messageId ?? calls.length + 100,
            from: botInfo,
            chat: privateChat,
            date: 1,
            text,
          }
        : undefined
    if (
      message &&
      (method === 'sendPhoto' ||
        method === 'editMessageMedia' ||
        method === 'editMessageCaption' ||
        existing?.photo)
    )
      message.photo = []
    calls.push({ method, payload, message })
    return { ok: true, result: (message ?? true) as never }
  })

  const dispatch = (update: Update) => bot.handleUpdate(update)

  function latestMessage() {
    const call = calls.findLast(({ message }) => message)
    assert.ok(call?.message)
    return { message: call.message, payload: call.payload }
  }

  return {
    calls,
    dispatch,
    latestMessage,
    press: async (label: string, source = latestMessage(), from = telegramUser) => {
      const button = buttons(source.payload).find(({ text }) => text === label)
      assert.ok(button, `No button labeled ${label}`)
      assert.ok(Buffer.byteLength(button.callback_data) <= 64)
      await dispatch({
        update_id: 43,
        callback_query: {
          id: 'callback',
          from,
          chat_instance: 'chat',
          data: button.callback_data,
          message: source.message,
        },
      })
    },
    reply: async (text: string, source = latestMessage()) => {
      const update = textUpdate(text)
      update.message.reply_to_message = { ...source.message, reply_to_message: undefined }
      await dispatch(update)
    },
  }
}

function buttons(payload: unknown): InlineButton[] {
  return (
    (
      payload as { reply_markup?: { inline_keyboard?: InlineButton[][] } }
    ).reply_markup?.inline_keyboard?.flat() ?? []
  )
}

test('Telegram shows, changes and resets the owner’s time zone', async () => {
  let timeZone: string | null = null
  const { dispatch, latestMessage } = harness({
    getTimeZone: async (userId) => {
      assert.equal(userId, ownerId)
      return timeZone
    },
    setTimeZone: async (userId, value) => {
      assert.equal(userId, ownerId)
      if (value === '+05:00') return 'invalid'
      timeZone = value === 'asia/yekaterinburg' ? 'Asia/Yekaterinburg' : value
      return { timeZone }
    },
  })

  await dispatch(textUpdate('/timezone'))
  assert.match(latestMessage().message.text, /по умолчанию — UTC/u)
  await dispatch(textUpdate('/timezone asia/yekaterinburg'))
  assert.match(latestMessage().message.text, /сохранён — Asia\/Yekaterinburg/u)
  await dispatch(textUpdate('/timezone +05:00'))
  assert.match(latestMessage().message.text, /Укажите часовой пояс IANA/u)
  await dispatch(textUpdate('/timezone'))
  assert.match(latestMessage().message.text, /Часовой пояс — Asia\/Yekaterinburg/u)
  await dispatch(textUpdate('/timezone reset'))
  assert.match(latestMessage().message.text, /сброшен. Используется UTC/u)
  assert.equal(timeZone, null)
})

test('the Telegram keyboard opens each menu item', async () => {
  const { dispatch, latestMessage } = harness(
    {
      dailyHistory: async () => [
        { id: operationId, createdAt: new Date(), ...operation, categoryName: null },
      ],
    },
    true,
  )
  const expectedKeyboard = {
    keyboard: [
      [{ text: '📊 Статистика' }, { text: '📅 История' }],
      [{ text: '⚙️ Настройки' }, { text: '❓ Помощь' }],
      [{ text: '🎯 Бюджеты' }],
    ],
    resize_keyboard: true,
    is_persistent: true,
    input_field_placeholder: '480 кофе',
  }
  await dispatch(textUpdate('/start'))
  assert.deepEqual(
    { ...(latestMessage().payload as { reply_markup: ReplyKeyboardMarkup }).reply_markup },
    expectedKeyboard,
  )

  await dispatch(textUpdate('📊 Статистика'))
  assert.match(
    latestMessage().message.text,
    /📊 Статистика за сегодня[^]*Общий доход: 0,00 ₽[^]*Общий расход: 480,00 ₽/u,
  )
  await dispatch(textUpdate('📅 История'))
  assert.match(latestMessage().message.text, /−480 ₽ \(кофе\)/u)
  await dispatch(textUpdate('🎯 Бюджеты'))
  assert.match(latestMessage().message.text, /Общий бюджет\nПотрачено 0 ₽\nЛимит не задан/u)
  await dispatch(textUpdate('⚙️ Настройки'))
  assert.deepEqual(
    buttons(latestMessage().payload).map(({ text }) => text),
    ['📉 Расходы', '📈 Доходы', '🧠 Запомненные слова', '📚 Встроенные слова'],
  )
  await dispatch(textUpdate('❓ Помощь'))
  assert.match(latestMessage().message.text, /480 кофе/u)
  assert.deepEqual(
    { ...(latestMessage().payload as { reply_markup: ReplyKeyboardMarkup }).reply_markup },
    expectedKeyboard,
  )
})

test('ignores photo captions as menu labels and answers unknown callbacks', async () => {
  const { calls, dispatch } = harness()
  const photo = {
    message_id: 11,
    from: telegramUser,
    chat: privateChat,
    date: 1,
    photo: [],
    caption: '🎯 Бюджеты',
  } satisfies Message.PhotoMessage
  await dispatch({ update_id: 42, message: photo })
  assert.equal(calls.length, 0)

  await dispatch({
    update_id: 43,
    callback_query: {
      id: 'unknown-button',
      from: telegramUser,
      chat_instance: 'chat',
      data: 'b:unknown-button',
      message: photo,
    },
  })
  assert.deepEqual(
    calls.map(({ method }) => method),
    ['answerCallbackQuery'],
  )
  assert.equal((calls[0]?.payload as { text?: string }).text, 'Действие больше недоступно.')
})

test('budget months and pages keep totals visible and only the current month can be edited', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2025-11-30T23:00:00Z') })
  const { dispatch, latestMessage, press } = harness(
    {
      getTimeZone: async () => 'Asia/Yekaterinburg',
      monthlyBudget: async (_, month, timeZone) => {
        assert.equal(timeZone, 'Asia/Yekaterinburg')
        assert.ok(['2025-12-01', '2025-11-01'].includes(month))
        return {
          totalSpent: 92_000n,
          totalLimit: 80_000n,
          categories: Array.from({ length: 7 }, (_, index) => ({
            id: categoryId,
            name: `Категория ${index + 1}`,
            archived: false,
            limit: 1_000n,
            spent: index === 0 ? 800n : 1_000n,
          })),
        }
      },
    },
    true,
  )
  await dispatch(textUpdate('/budgets'))
  const first = latestMessage()
  assert.match(first.message.text, /^🎯 Бюджеты\nдекабрь\n/u)
  assert.match(first.message.text, /Общий бюджет\nПотрачено 920 ₽ из 800 ₽\n🔴 Превышение 120 ₽/u)
  assert.match(first.message.text, /🟡 Близко к лимиту · Осталось 2 ₽/u)
  assert.match(first.message.text, /Лимит достигнут/u)
  assert.doesNotMatch(first.message.text, /UTC|Категория 7/u)
  await press('Страница ➡️')
  assert.equal(latestMessage().message.message_id, first.message.message_id)
  assert.match(latestMessage().message.text, /Категория 7/u)
  assert.match(latestMessage().message.text, /Превышение 120 ₽/u)
  await press('⬅️ Месяц')
  assert.match(latestMessage().message.text, /^🎯 Бюджеты\nноябрь\n/u)
  assert.ok(
    !buttons(latestMessage().payload).some(
      ({ text }) => text.includes('лимит') || text === 'Лимит по категории',
    ),
  )
  await press('К текущему')
  assert.match(latestMessage().message.text, /^🎯 Бюджеты\nдекабрь\n/u)
})

test('statistics shows daily totals and this month’s budgets with a link to the full list', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2025-11-30T23:00:00Z') })
  const { dispatch, latestMessage, press } = harness({
    getTimeZone: async () => 'Asia/Yekaterinburg',
    dailyHistory: async (_, date) => {
      assert.equal(date, '2025-12-01')
      return [{ id: operationId, createdAt: new Date(), ...operation, categoryName: null }]
    },
    monthlyBudget: async (userId, month, timeZone) => {
      assert.deepEqual([userId, month, timeZone], [ownerId, '2025-12-01', 'Asia/Yekaterinburg'])
      return {
        totalSpent: 175_050n,
        totalLimit: 200_000n,
        categories: ['Кафе & чай', 'Транспорт', 'Дом', 'Последняя категория'].map((name) => ({
          id: categoryId,
          name,
          archived: false,
          spent: 53_000n,
          limit: 50_000n,
        })),
      }
    },
  })
  await dispatch(textUpdate('📊 Статистика'))
  const statistics = latestMessage()
  assert.match(statistics.message.text, /<h2>📊 Статистика за сегодня, 1 декабря<\/h2>/u)
  assert.match(
    statistics.message.text,
    /Общий расход: 480,00 ₽[^]*Бюджет за месяц · декабрь<\/h3>/u,
  )
  assert.match(statistics.message.text, /<b>1\s750,50 ₽<\/b> из 2\s000 ₽[^]*Осталось 249,50 ₽/u)
  assert.match(statistics.message.text, /Кафе &amp; чай[^]*Превышение 30 ₽/u)
  assert.match(statistics.message.text, /Ещё лимитов по категориям · 1/u)
  assert.doesNotMatch(statistics.message.text, /Последняя категория|UTC/u)

  await press('🎯 Открыть бюджеты')
  assert.notEqual(latestMessage().message.message_id, statistics.message.message_id)
  assert.match(latestMessage().message.text, /Последняя категория/u)
})

test('statistics keeps daily totals when monthly budgets fail to load', async () => {
  const { dispatch, latestMessage } = harness({
    monthlyBudget: async () => {
      throw new Error('unavailable')
    },
  })
  await dispatch(textUpdate('📊 Статистика'))
  assert.match(latestMessage().message.text, /Общий расход: 0,00 ₽[^]*Не удалось загрузить бюджет/u)
  assert.doesNotMatch(latestMessage().message.text, /UTC|\d{4} г\./u)
})

test('budget input can be corrected or cancelled and expires at the month boundary', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2025-11-30T12:00:00Z') })
  const changes: Parameters<TelegramDependencies['budgets']['changeBudgetLimit']>[] = []
  const results = ['invalid', 'saved', 'stale'] as const
  const { dispatch, latestMessage, press, reply } = harness(
    {
      changeBudgetLimit: async (...args) => {
        const result = results[changes.length]
        changes.push(args)
        assert.ok(result)
        return result
      },
    },
    true,
  )
  async function prompt() {
    await dispatch(textUpdate('/budgets'))
    assert.match(latestMessage().message.text, /^🎯 Бюджеты\nноябрь\n/u)
    await press('Общий лимит')
    await press('Задать сумму')
    return latestMessage()
  }
  const invalid = await prompt()
  await reply('-100', invalid)
  assert.match(latestMessage().message.text, /положительную сумму/u)
  await reply('8 000,25', invalid)
  assert.deepEqual(changes, [
    [ownerId, '2025-11-01', null, { kind: 'set', amountKopecks: null }],
    [ownerId, '2025-11-01', null, { kind: 'set', amountKopecks: 800_025n }],
  ])

  const cancelled = await prompt()
  await reply('Отмена', cancelled)
  assert.match(latestMessage().message.text, /отменена/u)
  await reply('15 000', cancelled)
  assert.match(latestMessage().message.text, /устарел/u)

  const expired = await prompt()
  t.mock.timers.setTime(new Date('2025-12-01T00:00:00Z').getTime())
  await reply('10 000', expired)
  assert.match(latestMessage().message.text, /Месяц изменился/u)
  assert.equal(changes.length, 3)
  assert.deepEqual(changes[2], [
    ownerId,
    '2025-11-01',
    null,
    { kind: 'set', amountKopecks: 1_000_000n },
  ])
})

test('the budget handler routes only replies to the current prompt and serializes saves', async () => {
  const started = Promise.withResolvers<void>()
  const saved = Promise.withResolvers<'saved'>()
  const limits: unknown[] = []
  const entries: string[] = []
  const { calls, dispatch, latestMessage, press, reply } = harness(
    {
      changeBudgetLimit: async (_owner, _month, _category, change) => {
        limits.push(change)
        started.resolve()
        return saved.promise
      },
      recordOperation: async (_owner, _draft, key) => {
        entries.push(key)
        return savedExpense
      },
    },
    true,
    async () => '480 кофе',
  )

  await dispatch(textUpdate('/budgets'))
  await press('Общий лимит')
  const screen = latestMessage()
  await press('Задать сумму', screen)
  const oldPrompt = latestMessage()
  await press('Задать сумму', screen)
  const prompt = latestMessage()
  await reply('600', oldPrompt)
  assert.match(latestMessage().message.text, /устарел/u)
  await reply('/budgets', prompt)
  assert.match(latestMessage().message.text, /^🎯 Бюджеты/u)

  const first = reply('1200', prompt)
  await started.promise
  const second = reply('1300', prompt)
  try {
    await dispatch(textUpdate('480 кофе'))
    await dispatch(voiceUpdate())
    assert.deepEqual(entries, [textKey, 'telegram:voice:123:7'])
  } finally {
    saved.resolve('saved')
  }
  await Promise.all([first, second])
  assert.deepEqual(limits, [{ kind: 'set', amountKopecks: 120_000n }])
  const refreshed = calls.findLast(
    ({ message }) => message?.message_id === screen.message.message_id,
  )
  assert.match(refreshed?.message?.text ?? '', /^🎯 Бюджеты/u)
  assert.match(latestMessage().message.text, /устарел/u)
})

function ownerHarness(
  dependencies: TelegramDependencies,
  userId: string,
  rejectRichMessage = false,
  transcribeVoice?: TranscribeVoice,
) {
  return botHarness(
    {
      ...dependencies,
      users: { ...dependencies.users, getOrCreateUser: async () => userId },
    },
    rejectRichMessage,
    transcribeVoice,
  )
}

const budgetTestDatabaseUrl = process.env.BUDGET_TEST_DATABASE_URL

test(
  'Telegram budget flow uses real accounting with a simulated Telegram transport',
  { skip: !budgetTestDatabaseUrl },
  async (t) => {
    const { db, pool } = createDatabase(budgetTestDatabaseUrl!)
    t.after(() => pool.end())
    const app = createApplication(db).telegram
    const userId = await app.users.getOrCreateUser(randomInt(2 ** 40, 2 ** 41))
    await app.categories.addCategory(userId, 'expense', 'А Кафе')
    const cafe = (await app.categories.listCategories(userId, 'expense')).find(
      ({ name }) => name === 'А Кафе',
    )
    assert.ok(cafe)
    const { dispatch, latestMessage, press, reply } = ownerHarness(app, userId, true)
    await dispatch(textUpdate('/budgets'))
    const previous = buttons(latestMessage().payload)
      .find(({ text }) => text === '⬅️ Месяц')!
      .callback_data.split(':')[2]
    const previousMonth = `${previous}-01`
    assert.equal(
      await app.budgets.changeBudgetLimit(
        userId,
        previousMonth,
        null,
        { kind: 'set', amountKopecks: 40_000n },
        new Date(`${previousMonth}T12:00:00Z`),
      ),
      'saved',
    )
    await press('Общий лимит')
    await press('Изменить сумму')
    await reply('100')
    await press('Лимит по категории')
    await press('А Кафе')
    await press('Задать сумму')
    await reply('50')
    await dispatch(textUpdate('480 новый расход'))
    await press('📉 Расход')
    assert.match(latestMessage().message.text, /📉 <b>− /u)
    const [expense] = await app.transactions.recent(userId)
    assert.ok(expense)
    assert.equal(expense.amountKopecks, 48_000n)
    await press('🏷 Выбрать категорию')
    await press(cafe.name)
    assert.equal((await app.transactions.getOperation(userId, expense.id))?.categoryName, cafe.name)
    await dispatch(textUpdate('📊 Статистика'))
    assert.match(
      latestMessage().message.text,
      /Общий расход: 480,00 ₽[^]*Бюджет за месяц[^]*Превышение 380 ₽/u,
    )
    await press('🎯 Открыть бюджеты')
    assert.match(
      latestMessage().message.text,
      /Общий бюджет\nПотрачено 480 ₽ из 100 ₽\n🔴 Превышение 380 ₽/u,
    )
    assert.match(
      latestMessage().message.text,
      /А Кафе\nПотрачено 480 ₽ из 50 ₽\n🔴 Превышение 430 ₽/u,
    )
    await press('Общий лимит')
    await press('Изменить сумму')
    await reply('600')
    assert.match(
      latestMessage().message.text,
      /Общий бюджет\nПотрачено 480 ₽ из 600 ₽\n🟡 Близко к лимиту · Осталось 120 ₽/u,
    )
    await press('⬅️ Месяц')
    assert.match(latestMessage().message.text, /Общий бюджет\nПотрачено 0 ₽ из 400 ₽/u)
    await press('К текущему')
    await press('Общий лимит')
    await press('Отключить лимит')
    assert.match(latestMessage().message.text, /Общий бюджет\nПотрачено 480 ₽\nЛимит не задан/u)
  },
)

test('waits for the database before acknowledging an operation', async () => {
  const called = Promise.withResolvers<void>()
  const saved = Promise.withResolvers<RecordOperationResult>()
  const { calls, dispatch } = harness({
    recordOperation: async (...args) => {
      assert.deepEqual(args, [ownerId, operationDraft, 'telegram:42'])
      called.resolve()
      return saved.promise
    },
  })
  const request = dispatch(textUpdate('480 кофе'))
  await called.promise
  assert.equal(calls.length, 0)
  saved.resolve(savedExpense)
  await request
  assert.equal(calls[0]?.method, 'sendMessage')
  assert.equal(
    (calls[0]?.payload as { text: string }).text,
    '📉 <b>− 480,00 ₽</b> (кофе)\n🏷 Без категории',
  )
  assert.deepEqual(
    buttons(calls[0]?.payload).map(({ text }) => text),
    ['🏷 Выбрать категорию', '📅 Дата', '🗑 Удалить'],
  )
})

test('automatically records voice by message identity and can delete it after a category change', async () => {
  const key = `telegram:voice:${privateChat.id}:7`
  const draft = { ...operationDraft, amountKopecks: 25_000n }
  const expense = { ...operation, ...draft }
  let saved = false
  let deleted = false
  const { calls, dispatch, latestMessage, press } = harness(
    {
      getOrCreateUser: async (id) => (id === telegramUser.id ? ownerId : otherOwnerId),
      recordOperation: async (...args) => {
        assert.deepEqual(args, [ownerId, draft, key])
        if (saved) return { status: 'duplicate' }
        saved = true
        return savedExpense
      },
      listCategories: async () => [{ id: categoryId, name: 'Кафе' }],
      setCategory: async () => true,
      getOperation: async () => ({
        ...expense,
        id: operationId,
        createdAt: new Date(),
        categoryName: 'Кафе',
        operationDate: { date: '2026-11-21', timeZone: 'UTC' },
        idempotencyKey: key,
      }),
      remove: async (userId, id) => {
        assert.equal(id, operationId)
        if (userId !== ownerId || deleted) return false
        deleted = true
        return true
      },
    },
    true,
    async (_telegram, fileId) => {
      assert.equal(fileId, 'voice-file')
      return 'Двести пятьдесят рублей за кофе.'
    },
  )

  await dispatch(voiceUpdate())
  assert.match(latestMessage().message.text, /250,00 ₽<\/b> \(кофе\)/u)
  await press('Кафе')
  const receipt = latestMessage()
  await press('🗑 Удалить', receipt, { ...telegramUser, id: 789 })
  assert.equal(deleted, false)
  await press('🗑 Удалить', receipt)
  assert.equal(deleted, true)
  assert.equal(latestMessage().message.text, '🗑 Операция удалена.')
  assert.deepEqual(buttons(latestMessage().payload), [])
  const previousCalls = calls.length
  await dispatch({ ...voiceUpdate(), update_id: 45 })
  assert.equal(calls.length, previousCalls)
})

test('rejects long voice messages before transcription and clarifies invalid inputs like text', async () => {
  let attempts = 0
  let writes = 0
  const transcript = 'Кофе за двести и такси за пятьсот'
  const { dispatch, latestMessage } = harness(
    {
      recordOperation: async () => {
        writes++
        return { status: 'duplicate' }
      },
    },
    false,
    async () => {
      attempts++
      return transcript
    },
  )

  await dispatch(voiceUpdate(21))
  assert.equal(attempts, 0)
  assert.match(latestMessage().message.text, /до 20 секунд/u)
  await dispatch(voiceUpdate())
  assert.equal(attempts, 1)
  assert.equal(writes, 0)
  const clarification = latestMessage().message.text
  assert.match(clarification, /Уточните сумму и описание одной операции/u)
  await dispatch(textUpdate(transcript))
  assert.equal(latestMessage().message.text, clarification)
  assert.equal(writes, 0)
})

test('text and voice with the same unknown description ask for a kind before saving', async () => {
  const input = 'неизвестная операция 3000'
  const draft = { amountKopecks: 300_000n, description: 'неизвестная операция' }
  const voiceKey = 'telegram:voice:123:7'
  const writes: Parameters<TelegramDependencies['transactions']['recordOperation']>[] = []
  const { dispatch, latestMessage, press, calls } = harness(
    {
      recordOperation: async (...args) => {
        const [, operation, key] = args
        if (!operation.kind) {
          assert.deepEqual(operation, draft)
          return writes.some(([, , savedKey]) => savedKey === key)
            ? { status: 'duplicate' }
            : { status: 'kind-required' }
        }
        writes.push(args)
        return savedIncome
      },
    },
    true,
    async () => input,
  )

  await dispatch(textUpdate(input))
  const textPrompt = latestMessage().message.text
  assert.match(textPrompt, /Доход или расход\?/u)
  await press('↩️ Отмена')

  await dispatch(voiceUpdate())
  assert.equal(latestMessage().message.text, textPrompt)
  assert.equal(writes.length, 0)
  const prompt = latestMessage()
  await Promise.all([press('📈 Доход', prompt), press('📉 Расход', prompt)])
  assert.deepEqual(writes, [[ownerId, { ...draft, kind: 'income' }, voiceKey]])
  assert.equal(calls.findLast(({ message }) => message)?.method, 'editMessageText')
  assert.equal(latestMessage().message.message_id, prompt.message.message_id)
  assert.match(latestMessage().message.text, /📈 <b>\+ /u)

  const previousCalls = calls.length
  await dispatch({ ...voiceUpdate(), update_id: 45 })
  assert.equal(calls.length, previousCalls)
})

test(
  'text and voice offer both matching income categories on the saved receipt',
  { skip: !budgetTestDatabaseUrl },
  async (t) => {
    const { db, pool } = createDatabase(budgetTestDatabaseUrl!)
    t.after(() => pool.end())
    const app = createApplication(db).telegram
    const userId = await app.users.getOrCreateUser(randomInt(2 ** 40, 2 ** 41))
    const description = 'доволен зарплатой за проект'
    const transcript = `${description} 3 тыщи`
    const { dispatch, latestMessage, press } = ownerHarness(
      app,
      userId,
      true,
      async () => transcript,
    )

    for (const [update, category] of [
      [textUpdate(transcript), '💼 Зарплата'],
      [voiceUpdate(), '🛠️ Проекты'],
    ] as const) {
      await dispatch(update)
      assert.match(latestMessage().message.text, /📈 <b>\+ [^]*Выберите категорию/u)
      assert.deepEqual(
        buttons(latestMessage().payload)
          .slice(0, 2)
          .map(({ text }) => text)
          .sort(),
        ['💼 Зарплата', '🛠️ Проекты'],
      )
      await press(category)
      assert.ok(latestMessage().message.text.includes(category))
    }
    const saved = await app.transactions.recent(userId)
    assert.equal(saved.length, 2)
    assert.ok(
      saved.every(
        (operation) =>
          operation.kind === 'income' &&
          operation.amountKopecks === 300_000n &&
          operation.description === description,
      ),
    )
    assert.deepEqual(saved.map(({ categoryName }) => categoryName).sort(), [
      '💼 Зарплата',
      '🛠️ Проекты',
    ])
  },
)

test('an exact match appears on the first receipt with change and clear buttons', async () => {
  const { dispatch, latestMessage, press, calls } = harness({
    recordOperation: async (...args) => {
      assert.deepEqual(args, [
        ownerId,
        { amountKopecks: 4300n, description: 'транспорт' },
        'telegram:42',
      ])
      return { ...savedExpense, categoryName: '🚇 Транспорт' }
    },
    listCategories: async () => {
      throw new Error('unexpected quick choices on categorized receipt')
    },
    setCategory: async (...args) => {
      assert.deepEqual(args, [ownerId, operationId, null])
      return true
    },
    getOperation: async () => ({
      id: operationId,
      kind: 'expense',
      amountKopecks: 4300n,
      description: 'транспорт',
      createdAt: new Date(0),
      categoryName: null,
      operationDate: { date: '2026-11-21', timeZone: 'UTC' },
      idempotencyKey: textKey,
    }),
  })
  await dispatch(textUpdate('43 транспорт'))
  const receipt = latestMessage()
  assert.match(receipt.message.text, /📉 <b>− 43,00 ₽<\/b>\n🏷 🚇 Транспорт$/u)
  assert.deepEqual(
    buttons(receipt.payload).map(({ text }) => text),
    ['🏷 Категория', '✖️ Снять', '📅 Дата', '🗑 Удалить'],
  )
  await press('✖️ Снять', receipt)
  assert.equal(latestMessage().message.message_id, receipt.message.message_id)
  assert.match(latestMessage().message.text, /<\/b> \(транспорт\)\n🏷 Без категории/u)
  assert.deepEqual(
    calls.filter(({ method }) => method.startsWith('send')).map(({ method }) => method),
    ['sendMessage'],
  )
})

test('grouped and abbreviated amounts produce a categorized receipt', async () => {
  for (const text of ['квартира 40 000', '40к квартира', 'квартира 40 тыс']) {
    const { dispatch, latestMessage } = harness({
      recordOperation: async (...args) => {
        assert.deepEqual(args, [
          ownerId,
          { amountKopecks: 4_000_000n, description: 'квартира' },
          'telegram:42',
        ])
        return { ...savedExpense, categoryName: '🏠 Дом' }
      },
    })
    await dispatch(textUpdate(text))
    assert.match(latestMessage().message.text, /40\s000,00 ₽.*квартира.*🏷 🏠 Дом/su)
  }
})

test('remembering a manual category updates the same receipt and categorizes the next entry', async () => {
  let categoryName: string | null = null
  let remembered = false
  const expense = { kind: 'expense', amountKopecks: 4300n, description: 'метро' } as const
  const { dispatch, latestMessage, press, calls } = harness({
    recordOperation: async (userId, input) => {
      assert.equal(userId, ownerId)
      assert.equal(input.description, 'метро')
      return remembered
        ? { ...savedExpense, id: incomeId, categoryName: 'Транспорт' }
        : savedExpense
    },
    listCategories: async () => [{ id: categoryId, name: 'Транспорт' }],
    setCategory: async (...args) => {
      assert.deepEqual(args, [ownerId, operationId, categoryId])
      categoryName = 'Транспорт'
      return true
    },
    getOperation: async () => ({
      ...expense,
      id: operationId,
      createdAt: new Date(),
      categoryName,
      operationDate: { date: '2026-11-21', timeZone: 'UTC' },
      idempotencyKey: textKey,
    }),
    canRememberCategory: async (...args) => {
      assert.deepEqual(args, [ownerId, 'expense', 'метро'])
      return true
    },
    rememberCategory: async (...args) => {
      assert.deepEqual(args, [ownerId, operationId, categoryId])
      remembered = true
      return true
    },
  })
  await dispatch(textUpdate('43 метро'))
  const messageId = latestMessage().message.message_id
  await press('Транспорт')
  assert.equal(remembered, false)
  await press('🧠 Запомнить: метро → Транспорт')
  assert.equal(remembered, true)
  assert.equal(latestMessage().message.message_id, messageId)
  assert.deepEqual(
    buttons(latestMessage().payload).map(({ text }) => text),
    ['🏷 Категория', '✖️ Снять', '📅 Дата', '🗑 Удалить'],
  )
  assert.deepEqual(
    calls.filter(({ method }) => method.startsWith('send')).map(({ method }) => method),
    ['sendMessage'],
  )

  await dispatch({ ...textUpdate('75 метро'), update_id: 44 })
  assert.match(latestMessage().message.text, /75,00 ₽.*🏷 Транспорт/su)
})

test('receipt escapes the description and a quick category button assigns the saved transaction', async () => {
  const { dispatch, latestMessage, press } = harness({
    recordOperation: async () => savedExpense,
    listCategories: async () => [
      { id: categoryId, name: 'Кафе' },
      { id: incomeCategoryId, name: '🎁 Подарки' },
      { id: '32000000-0000-4000-8000-000000000000', name: '🏠 Дом' },
    ],
    getOperation: async () => ({
      ...operation,
      id: operationId,
      createdAt: new Date(),
      categoryName: 'Кафе <утро>',
      operationDate: { date: '2026-11-21', timeZone: 'UTC' },
      idempotencyKey: textKey,
    }),
    setCategory: async (...args) => {
      assert.deepEqual(args, [ownerId, operationId, categoryId])
      return true
    },
  })
  await dispatch(textUpdate('480 кофе <чек> & десерт'))
  assert.match(latestMessage().message.text, /кофе &lt;чек&gt; &amp; десерт/u)
  const { reply_markup } = latestMessage().payload as {
    reply_markup: { inline_keyboard: InlineButton[][] }
  }
  assert.deepEqual(
    reply_markup.inline_keyboard.map((row) => row.map(({ text }) => text)),
    [['Кафе', '🎁 Подарки', '🏠 Дом'], ['🏷 Выбрать категорию'], ['📅 Дата', '🗑 Удалить']],
  )
  assert.ok(reply_markup.inline_keyboard.flat().every((button) => button.style === undefined))
  await press('Кафе')
  assert.match(latestMessage().message.text, /🏷 Кафе &lt;утро&gt;/u)
})

test('receipts use compact text with HTML formatting and inline controls', async () => {
  const { calls, dispatch, latestMessage } = harness(
    { recordOperation: async () => savedExpense },
    true,
  )
  await dispatch(textUpdate('480 кофе'))
  assert.deepEqual(
    calls.map(({ method }) => method),
    ['sendMessage'],
  )
  assert.equal((calls[0]?.payload as { parse_mode: string }).parse_mode, 'HTML')
  assert.equal(latestMessage().message.text.split('\n').length, 2)
  assert.deepEqual(
    buttons(latestMessage().payload).map(({ text }) => text),
    ['🏷 Выбрать категорию', '📅 Дата', '🗑 Удалить'],
  )
})

test('a duplicate update does not get a second confirmation', async () => {
  const { calls, dispatch } = harness({ recordOperation: async () => ({ status: 'duplicate' }) })
  await dispatch(textUpdate('480 кофе'))
  assert.deepEqual(calls, [])
})

test('a database failure gives a retry hint without claiming a write', async (t) => {
  t.mock.method(console, 'error', () => {})
  const { calls, dispatch } = harness({
    recordOperation: async () => {
      throw new Error('database unavailable')
    },
  })
  await dispatch(textUpdate('480 кофе'))
  assert.match(
    (calls[0]?.payload as { text: string }).text,
    /^⚠️ Не удалось подтвердить запись\..*«Историю»/u,
  )
})

test('ambiguous input gets a clarification without a database call', async () => {
  let touchedDatabase = false
  const { calls, dispatch } = harness({
    getOrCreateUser: async () => {
      touchedDatabase = true
      return ownerId
    },
  })
  await dispatch(textUpdate('15 00 проект'))
  assert.equal(touchedDatabase, false)
  assert.match((calls[0]?.payload as { text: string }).text, /^✍️ Уточните /u)
})

test('ignores group messages', async () => {
  const { calls, dispatch } = harness()
  await dispatch(textUpdate('480 кофе', { type: 'group', id: -23, title: 'Группа' }))
  assert.deepEqual(calls, [])
})

test('chooses, changes and clears an income category, then deletes the income in the original receipt', async () => {
  const assignments: (string | null)[] = []
  const { calls, dispatch, latestMessage, press } = harness({
    recordOperation: async (...args) => {
      assert.deepEqual(args, [ownerId, incomeDraft, 'telegram:42'])
      return savedIncome
    },
    getOperationKind: async (...args) => {
      assert.deepEqual(args, [ownerId, incomeId])
      return 'income'
    },
    getOperation: async (userId, id) => {
      assert.deepEqual([userId, id], [ownerId, incomeId])
      const selected = assignments.at(-1)
      const categoryName =
        selected === incomeCategoryId ? 'Проекты' : selected === categoryId ? 'Проценты' : null
      return {
        ...income,
        id,
        createdAt: new Date(),
        categoryName,
        operationDate: { date: '2026-11-21', timeZone: 'UTC' },
        idempotencyKey: textKey,
      }
    },
    listCategories: async (...args) => {
      assert.deepEqual(args, [ownerId, 'income'])
      return [
        { id: incomeCategoryId, name: 'Проекты' },
        { id: categoryId, name: 'Проценты' },
      ]
    },
    setCategory: async (...args) => {
      assert.deepEqual(args.slice(0, 2), [ownerId, incomeId])
      assignments.push(args[2])
      return true
    },
    remove: async (...args) => {
      assert.deepEqual(args, [ownerId, incomeId])
      return true
    },
  })

  await dispatch(textUpdate('+15000 проект'))
  const receiptId = latestMessage().message.message_id
  assert.match(latestMessage().message.text, /📈 <b>\+ 15\s000,00 ₽<\/b> \(проект\)/u)
  await press('🏷 Выбрать категорию')
  const picker = latestMessage()
  assert.deepEqual(
    buttons(picker.payload).map(({ text }) => text),
    ['Проекты', 'Проценты', '✖️ Снять категорию', '🧾 К чеку'],
  )
  await press('Проекты', picker)
  assert.match(latestMessage().message.text, /🏷 Проекты/u)
  await press('🏷 Категория')
  await press('Проценты')
  assert.match(latestMessage().message.text, /🏷 Проценты/u)
  await press('✖️ Снять')
  assert.match(latestMessage().message.text, /Без категории/u)
  await press('🗑 Удалить')
  assert.match(latestMessage().message.text, /Операция удалена/u)
  assert.deepEqual(buttons(latestMessage().payload), [])
  assert.deepEqual(assignments, [incomeCategoryId, categoryId, null])
  assert.deepEqual(
    calls.filter(({ message }) => message).map(({ message }) => message?.message_id),
    Array(7).fill(receiptId),
  )
  assert.deepEqual(
    calls.filter(({ method }) => method.startsWith('send')).map(({ method }) => method),
    ['sendMessage'],
  )
})

test('legacy receipt buttons still update the original photo caption', async () => {
  const assigned: (string | null)[] = []
  const { calls, dispatch } = harness({
    getOperationKind: async (owner, id) => {
      assert.deepEqual([owner, id], [ownerId, operationId])
      return 'expense'
    },
    listCategories: async (owner, kind) => {
      assert.deepEqual([owner, kind], [ownerId, 'expense'])
      return [{ id: categoryId, name: 'Кафе' }]
    },
    setCategory: async (owner, id, category) => {
      assert.deepEqual([owner, id], [ownerId, operationId])
      assigned.push(category)
      return true
    },
    getOperation: async () => ({
      ...operation,
      id: operationId,
      createdAt: new Date(0),
      categoryName: 'Кафе',
      operationDate: { date: '2026-11-21', timeZone: 'UTC' },
      idempotencyKey: textKey,
    }),
  })
  const pick = `pick:${operationId}:0`
  const target = 'IAAAAAAAQACAAAAAAAAAAA:MAAAAAAAQACAAAAAAAAAAA'
  const photo: Message.PhotoMessage = {
    message_id: 101,
    from: botInfo,
    chat: privateChat,
    date: 1,
    photo: [],
    caption: 'Чек',
    reply_markup: { inline_keyboard: [[{ text: 'Выбрать категорию', callback_data: pick }]] },
  }
  const press = (data: string) =>
    dispatch({
      update_id: 43,
      callback_query: {
        id: 'callback',
        from: telegramUser,
        chat_instance: 'chat',
        data,
        message: photo,
      },
    })

  await press(pick)
  assert.deepEqual(
    calls.map(({ method }) => method),
    ['editMessageReplyMarkup', 'answerCallbackQuery'],
  )
  assert.ok(
    buttons(calls[0]?.payload).some(({ callback_data }) => callback_data === `rs:${target}`),
  )

  await press(`set:${target}`)
  assert.deepEqual(assigned, [categoryId])
  const caption = calls.find(({ method }) => method === 'editMessageCaption')?.payload as {
    message_id: number
    caption: string
    show_caption_above_media: boolean
  }
  assert.equal(caption.message_id, photo.message_id)
  assert.match(caption.caption, /🏷 Кафе/u)
  assert.equal(caption.show_caption_above_media, true)

  await press(`remove:${operationId}`)
  assert.deepEqual(
    calls.slice(4).map(({ method }) => method),
    ['answerCallbackQuery'],
  )
  assert.equal(
    (calls.at(-1)?.payload as { text: string }).text,
    'Откройте «Историю», чтобы удалить операцию.',
  )
})

test('/recent opens local today, browses empty days in place and returns to today', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2025-03-08T20:00:00Z') })
  const { calls, dispatch, latestMessage, press } = harness(
    {
      getTimeZone: async () => 'Asia/Yekaterinburg',
      dailyHistory: async (userId, date, timeZone) => {
        assert.deepEqual([userId, timeZone], [ownerId, 'Asia/Yekaterinburg'])
        const rows =
          date === '2025-03-09'
            ? [
                { id: operationId, createdAt: new Date(), ...operation, categoryName: null },
                { id: incomeId, createdAt: new Date(), ...income, categoryName: 'Проекты' },
              ]
            : date === '2025-03-07'
              ? [
                  {
                    id: operationId,
                    createdAt: new Date(),
                    ...operation,
                    description: 'старый кофе',
                    categoryName: null,
                  },
                ]
              : []
        return rows
      },
    },
    true,
  )

  await dispatch(textUpdate('/recent'))
  const today = latestMessage()
  assert.match(today.message.text, /^📅 Сегодня, 9 марта\n/u)
  assert.doesNotMatch(today.message.text, /2025|UTC/u)
  assert.match(
    today.message.text,
    /^📅[^\n]*\n\n📉 Расходы · 480,00 ₽\n−480 ₽ \(кофе\)\n\n📈 Доходы · 15\s000,00 ₽\n\+15\s000 ₽ · Проекты \(проект\)$/u,
  )
  assert.deepEqual(
    buttons(today.payload).map(({ text }) => text),
    ['⬅️ День', '✏️ Редактировать операции'],
  )

  await press('⬅️ День')
  assert.match(
    latestMessage().message.text,
    /^📅 8 марта[^\n]*\n\n📭 За этот день операций нет\.$/u,
  )
  await press('⬅️ День')
  assert.match(latestMessage().message.text, /^📅 7 марта[^]*старый кофе/u)
  await press('День ➡️')
  assert.match(latestMessage().message.text, /^📅 8 марта/u)
  await press('📍 К сегодня')
  assert.equal(latestMessage().message.text, today.message.text)
  assert.deepEqual(
    calls.filter(({ message }) => message).map(({ message }) => message?.message_id),
    Array(5).fill(today.message.message_id),
  )

  await press('⬅️ День')
  await dispatch(textUpdate('/recent'))
  assert.equal(latestMessage().message.text, today.message.text)
  assert.notEqual(latestMessage().message.message_id, today.message.message_id)

  await dispatch(textUpdate('/help'))
  assert.match(
    latestMessage().message.text,
    /🧾 История[^]*по дням[^]*изменить дату[^]*удалить запись/u,
  )
})

test('/recent updates the selected day after category changes and recalculates the totals after deletion', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2025-03-09T12:00:00Z') })
  const callbackSender = { ...telegramUser, id: 999 }
  let categoryName: string | null = null
  let deleted = false
  const { calls, dispatch, latestMessage, press } = harness({
    getOrCreateUser: async (id) => (id === callbackSender.id ? otherOwnerId : ownerId),
    dailyHistory: async (userId, date, zone) => {
      assert.deepEqual([userId, zone], [ownerId, 'UTC'])
      if (date !== '2025-03-08') return []
      return [
        { id: incomeId, createdAt: new Date(), ...income, categoryName: 'Проекты' },
        ...(deleted
          ? []
          : [{ id: operationId, createdAt: new Date(), ...operation, categoryName }]),
      ]
    },
    getOperationKind: async (userId, id) => {
      assert.equal(id, operationId)
      return deleted || userId !== ownerId ? null : 'expense'
    },
    getOperation: async (userId, id) => {
      assert.equal(id, operationId)
      return deleted || userId !== ownerId
        ? null
        : {
            id,
            createdAt: new Date(),
            ...operation,
            categoryName,
            operationDate: { date: '2026-11-21', timeZone: 'UTC' },
            idempotencyKey: textKey,
          }
    },
    listCategories: async (...args) => {
      assert.deepEqual(args, [ownerId, 'expense'])
      return [{ id: categoryId, name: 'Кафе' }]
    },
    setCategory: async (userId, id, category) => {
      assert.equal(id, operationId)
      assert.ok(category === categoryId || category === null)
      if (deleted || userId !== ownerId) return false
      categoryName = category ? 'Кафе' : null
      return true
    },
    remove: async (userId, id) => {
      assert.equal(id, operationId)
      if (deleted || userId !== ownerId) return false
      deleted = true
      return true
    },
  })

  await dispatch(textUpdate('/recent'))
  const messageId = latestMessage().message.message_id
  assert.match(latestMessage().message.text, /Сегодня, 9 марта</u)
  await press('⬅️ День')
  const history = latestMessage()
  assert.match(
    history.message.text,
    /8 марта[^]*<h3>📉 Расходы · 480,00 ₽<\/h3>[^]*−480 ₽<\/b> \(кофе\)<\/p>[^]*<h3>📈 Доходы · 15\s000,00 ₽<\/h3>/u,
  )
  assert.doesNotMatch(history.message.text, /Общий доход|Общий расход/u)
  async function openOperation() {
    await press('✏️ Редактировать операции')
    assert.deepEqual(
      buttons(latestMessage().payload).map(({ text }) => text),
      ['−480 ₽ · кофе', '+15 000 ₽ · проект', '⬅️ К списку'],
    )
    await press('−480 ₽ · кофе')
    assert.match(latestMessage().message.text, /480,00 ₽ · кофе/u)
    assert.ok(latestMessage().message.text.includes(categoryName ?? 'Без категории'))
  }
  await openOperation()
  await press('🏷 Сменить категорию')
  const picker = latestMessage()
  await press('⬅️ Назад')
  await press('⬅️ К выбору операции')
  await press('⬅️ К списку')
  assert.equal(latestMessage().message.text, history.message.text)
  await openOperation()
  await press('🏷 Сменить категорию')
  await press('Кафе', picker, callbackSender)
  assert.match((calls.at(-1)?.payload as { text: string }).text, /недоступно/iu)
  assert.equal(categoryName, null)
  await press('Кафе')
  assert.match(latestMessage().message.text, /8 марта[^]*📉 Расходы · 480,00 ₽[^]*Кафе \(кофе\)/u)
  await openOperation()
  await press('🏷 Сменить категорию')
  await press('✖️ Снять категорию')
  assert.equal(latestMessage().message.text, history.message.text)

  await openOperation()
  await press('🗑 Удалить')
  assert.equal(deleted, false)
  assert.match(latestMessage().message.text, /Удалить операцию\?[^]*480,00 ₽ · кофе/u)
  await press('↩️ Отмена')
  assert.equal(deleted, false)
  await press('🗑 Удалить')
  const confirmation = latestMessage()
  await press('🗑 Подтвердить удаление', confirmation, callbackSender)
  assert.equal(deleted, false)
  await press('🗑 Подтвердить удаление')
  assert.match(
    latestMessage().message.text,
    /8 марта[^]*📈 Доходы · 15\s000,00 ₽[^]*Проекты \(проект\)/u,
  )
  assert.doesNotMatch(latestMessage().message.text, /📉 Расходы|кофе/u)
  await press('🗑 Подтвердить удаление', confirmation)
  assert.match((calls.at(-1)?.payload as { text: string }).text, /уже удалена/u)
  await press('Кафе', picker)
  assert.match((calls.at(-1)?.payload as { text: string }).text, /недоступно/iu)
  assert.ok(
    calls
      .filter(({ message }) => message)
      .every(({ message }) => message?.message_id === messageId),
  )
})

test('/recent shows a full day when it fits and only paginates the keyboard if needed', async () => {
  const rows = Array.from({ length: 105 }, (_, index) => ({
    ...operation,
    id: `20000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    createdAt: new Date(),
    description: `операция ${index + 1}`,
    categoryName: null,
  }))
  for (const plain of [false, true]) {
    const { dispatch, latestMessage, press } = harness({ dailyHistory: async () => rows }, plain)
    await dispatch(textUpdate('/recent'))
    assert.equal((latestMessage().message.text.match(/операция \d+/gu) ?? []).length, 105)
    assert.deepEqual(
      buttons(latestMessage().payload).map(({ text }) => text),
      ['⬅️ День', '✏️ Редактировать операции'],
    )

    await press('✏️ Редактировать операции')
    assert.equal(buttons(latestMessage().payload).length, 100)
    await press('Ещё операции ➡️')
    assert.ok(buttons(latestMessage().payload).some(({ text }) => text === '−480 ₽ · операция 105'))
    await press('⬅️ К списку')
    assert.doesNotMatch(latestMessage().message.text, /Страница/u)
  }
})

test('/recent pages through long days at the rich or plain text limit and keeps totals after deletion', async () => {
  const allRows = Array.from({ length: 180 }, (_, index) => ({
    ...operation,
    id: `20000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    createdAt: new Date(),
    amountKopecks: 101n,
    description: `операция ${index + 1} ${'д'.repeat(185)}`,
    categoryName: null,
  }))
  for (const plain of [false, true]) {
    const rows = [...allRows]
    const { calls, dispatch, latestMessage, press } = harness(
      {
        dailyHistory: async () => rows,
        getOperation: async (_owner, id) => {
          const row = rows.find((operation) => operation.id === id)
          return row
            ? {
                ...row,
                operationDate: { date: '2026-11-21', timeZone: 'UTC' },
                idempotencyKey: textKey,
              }
            : null
        },
        remove: async (_owner, id) => rows.at(-1)?.id === id && Boolean(rows.pop()),
      },
      plain,
    )
    await dispatch(textUpdate('/recent'))
    const first = latestMessage()
    assert.match(first.message.text, /📉 Расходы · 181,80 ₽/u)
    assert.match(first.message.text, /Страница 1 из \d+ · 180 операций/u)
    const seen: number[] = []
    while (true) {
      const { message, payload } = latestMessage()
      assert.match(message.text, /📉 Расходы · 181,80 ₽/u)
      assert.ok(message.text.replace(/<[^>]+>/gu, '').length <= (plain ? 4096 : 32768))
      seen.push(
        ...Array.from(message.text.matchAll(/операция (\d+) /gu), ([, index]) => Number(index)),
      )
      if (!buttons(payload).some(({ text }) => text === 'Ещё операции ➡️')) break
      await press('Ещё операции ➡️')
    }
    assert.deepEqual(
      seen,
      rows.map((_, index) => index + 1),
    )
    await press('✏️ Редактировать операции')
    const lastOperation = buttons(latestMessage().payload).find(({ text }) =>
      /^−1,01 ₽ · операция 180 /u.test(text),
    )
    assert.ok(lastOperation)
    await press(lastOperation.text)
    await press('⬅️ К выбору операции')
    assert.ok(buttons(latestMessage().payload).some(({ text }) => text === lastOperation.text))
    await press(lastOperation.text)
    await press('🗑 Удалить')
    await press('🗑 Подтвердить удаление')
    const updated = latestMessage().message
    assert.match(updated.text, /📉 Расходы · 180,79 ₽[^]*операция 179 /u)
    assert.doesNotMatch(updated.text, /операция 180 /u)
    assert.ok(
      calls
        .filter(({ message }) => message)
        .every(({ message }) => message?.message_id === first.message.message_id),
    )
    await press('⬅️ Операции')
    assert.match(latestMessage().message.text, /Страница \d+ из \d+/u)
  }
})

test('remembered words paginate and remove the chosen rule from the same message', async () => {
  const archivedRuleId = '40000000-0000-4000-8000-000000000007'
  let rules = Array.from({ length: 7 }, (_, index) => ({
    id: `40000000-0000-4000-8000-00000000000${index + 1}`,
    categoryId,
    expression: index === 6 ? 'метро <утро>' : `слово ${index + 1}`,
    kind: 'expense' as const,
    categoryName: 'Транспорт',
    archivedAt: index === 6 ? new Date(0) : null,
  }))
  const { dispatch, latestMessage, press, calls } = harness({
    listCategoryRules: async (userId) => {
      assert.equal(userId, ownerId)
      return rules
    },
    deleteCategoryRule: async (...args) => {
      assert.deepEqual(args, [ownerId, archivedRuleId, categoryId])
      const before = rules.length
      rules = rules.filter(({ id }) => id !== archivedRuleId)
      return rules.length !== before
    },
  })
  await dispatch(textUpdate('/categories'))
  await press('🧠 Запомненные слова')
  const listId = latestMessage().message.message_id
  assert.match(latestMessage().message.text, /Запомненные слова · 1\/2/u)
  await press('➡️ Далее')
  const lastPage = latestMessage()
  assert.match(
    lastPage.message.text,
    /метро &lt;утро&gt; → Транспорт · Расходы · Архивная категория/u,
  )
  await press('🗑 Удалить №7')
  assert.equal(latestMessage().message.message_id, listId)
  assert.doesNotMatch(latestMessage().message.text, /метро/u)
  assert.match(latestMessage().message.text, /слово 6/u)
  await press('🗑 Удалить №7', lastPage)
  assert.match((calls.at(-1)?.payload as { text: string }).text, /уже удалено или изменилось/u)
})

test('/categories adds, renames, and archives through owner-scoped buttons', async () => {
  let category: { id: string; name: string } | null = null
  const { calls, dispatch, latestMessage, press, reply } = harness({
    recordOperation: async (...args) => {
      assert.deepEqual(args, [ownerId, operationDraft, 'telegram:42'])
      return savedExpense
    },
    listCategories: async (...args) => {
      assert.deepEqual(args, [ownerId, 'expense'])
      return category ? [category] : []
    },
    addCategory: async (...args) => {
      assert.deepEqual(args, [ownerId, 'expense', 'Кафе'])
      category = { id: categoryId, name: args[2] }
      return 'ok'
    },
    renameCategory: async (...args) => {
      assert.deepEqual(args, [ownerId, categoryId, 'Кофейни'])
      category = { id: categoryId, name: args[2] }
      return 'ok'
    },
    archiveCategory: async (...args) => {
      assert.deepEqual(args, [ownerId, categoryId])
      if (!category) return false
      category = null
      return true
    },
  })

  await dispatch(textUpdate('/categories'))
  const menu = latestMessage()
  assert.equal(menu.message.text, '<h2>🏷 Личные категории</h2>')
  assert.deepEqual(
    buttons(menu.payload).map(({ text }) => text),
    ['📉 Расходы', '📈 Доходы', '🧠 Запомненные слова', '📚 Встроенные слова'],
  )
  await press('📉 Расходы', menu)
  assert.equal(latestMessage().message.message_id, menu.message.message_id)
  await press('➕ Добавить категорию')
  const prompt = latestMessage()
  assert.equal(
    (prompt.payload as { reply_markup?: { force_reply?: boolean } }).reply_markup?.force_reply,
    true,
  )
  await dispatch(textUpdate('480 кофе'))
  assert.match(latestMessage().message.text, /^📉 <b>− /u)
  await reply('Кафе', prompt)
  assert.match(latestMessage().message.text, /Категория добавлена\./u)
  assert.equal(latestMessage().message.message_id, menu.message.message_id)
  await press('📉 Расходы', menu)
  await press('Кафе')
  assert.equal(latestMessage().message.message_id, menu.message.message_id)
  await press('✏️ Переименовать')
  await reply('Кофейни')
  assert.match(latestMessage().message.text, /Категория переименована\./u)
  assert.equal(latestMessage().message.message_id, menu.message.message_id)
  await press('📉 Расходы', menu)
  await press('Кофейни')
  const details = latestMessage()
  await press('📦 Архивировать', details)
  assert.ok(
    calls.some(
      ({ method, payload }) =>
        method === 'answerCallbackQuery' &&
        (payload as { text?: string }).text === 'Категория архивирована.',
    ),
  )
  assert.equal(latestMessage().message.message_id, menu.message.message_id)
  await press('📦 Архивировать', details)
  assert.match((calls.at(-1)?.payload as { text: string }).text, /недоступно/iu)
  await press('📉 Расходы', menu)
  assert.ok(!buttons(latestMessage().payload).some(({ text }) => text === 'Кофейни'))
  await press('⬅️ К настройкам')
  assert.equal(latestMessage().message.message_id, menu.message.message_id)
  assert.equal(latestMessage().message.text, menu.message.text)
  await press('📉 Расходы')
  await dispatch(textUpdate('⚙️ Настройки'))
  assert.equal(latestMessage().message.message_id, menu.message.message_id)
  assert.equal(latestMessage().message.text, menu.message.text)
})

test('concurrent category replies save once without clearing a newer name prompt', async () => {
  const saving = Promise.withResolvers<void>()
  const saved = Promise.withResolvers<'ok'>()
  const names: string[] = []
  const { dispatch, latestMessage, press, reply } = harness({
    addCategory: async (_owner, _kind, name) => {
      names.push(name)
      saving.resolve()
      return saved.promise
    },
  })
  await dispatch(textUpdate('/categories'))
  await press('📉 Расходы')
  const catalogue = latestMessage()
  await press('➕ Добавить категорию', catalogue)
  const firstPrompt = latestMessage()
  const firstReply = reply('Кафе', firstPrompt)
  await saving.promise
  try {
    await reply('Такси', firstPrompt)
    assert.deepEqual(names, ['Кафе'])
    await press('➕ Добавить категорию', catalogue)
  } finally {
    saved.resolve('ok')
  }
  const secondPrompt = latestMessage()
  await firstReply
  await reply('Такси', secondPrompt)
  assert.deepEqual(names, ['Кафе', 'Такси'])
  assert.equal(latestMessage().message.message_id, catalogue.message.message_id)
  await reply('Кафе', firstPrompt)
  assert.match(latestMessage().message.text, /устарел/u)
})

test('the category catalogue fits twelve entries and edits the same message on both page transitions', async () => {
  const entries = Array.from({ length: 13 }, (_, index) => ({
    id: `30000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    name: `Категория ${index + 1}`,
  }))
  const { calls, dispatch, latestMessage, press } = harness({ listCategories: async () => entries })
  await dispatch(textUpdate('/categories'))
  const menu = latestMessage()
  const lastEntry = entries.pop()
  assert.ok(lastEntry)
  await press('📉 Расходы', menu)
  assert.deepEqual(
    buttons(latestMessage().payload).map(({ text }) => text),
    [...entries.map(({ name }) => name), '➕ Добавить категорию', '⬅️ К настройкам'],
  )

  entries.push(lastEntry)
  await press('📉 Расходы', menu)
  const firstPage = latestMessage()
  await press('➡️ Далее', firstPage)
  assert.equal(calls.at(-1)?.method, 'editMessageText')
  assert.equal(latestMessage().message.message_id, firstPage.message.message_id)
  assert.deepEqual(
    buttons(latestMessage().payload).map(({ text }) => text),
    [lastEntry.name, '⬅️ Назад', '➕ Добавить категорию', '⬅️ К настройкам'],
  )

  await press('⬅️ Назад')
  assert.equal(calls.at(-1)?.method, 'editMessageText')
  assert.equal(latestMessage().message.message_id, firstPage.message.message_id)
  assert.deepEqual(buttons(latestMessage().payload), buttons(firstPage.payload))
})

test('built-in words are separate from personal rules and can be searched, reassigned, disabled and reset', async () => {
  let rule: Awaited<ReturnType<TelegramDependencies['categories']['getBuiltInRule']>> = null
  const home = { id: categoryId, name: '🏠 Дом', key: 'housing' }
  const rent = { id: '40000000-0000-4000-8000-000000000009', name: 'Аренда', key: null }
  const { dispatch, press, reply, latestMessage } = harness({
    listBuiltInTargets: async (...args) => {
      assert.deepEqual(args, [ownerId, 'expense'])
      return [home, rent]
    },
    listCategoryRules: async () => (rule ? [rule] : []),
    getBuiltInRule: async () => rule,
    changeBuiltInRule: async (userId, kind, word, target) => {
      assert.deepEqual([userId, kind, word], [ownerId, 'expense', 'хата'])
      assert.ok(target === rent.id || target === 'reset' || target === null)
      rule =
        target === 'reset'
          ? null
          : {
              id: '40000000-0000-4000-8000-000000000008',
              kind,
              expression: word,
              categoryId: target,
              categoryName: target ? rent.name : null,
              archivedAt: null,
            }
      return true
    },
  })

  await dispatch(textUpdate('/categories'))
  const settings = latestMessage()
  await press('🧠 Запомненные слова', settings)
  assert.equal(latestMessage().message.message_id, settings.message.message_id)
  assert.match(latestMessage().message.text, /Пока нет запомненных слов/u)
  await press('📚 Встроенные слова', settings)
  assert.equal(latestMessage().message.message_id, settings.message.message_id)
  await press('🔎 Найти слово')
  await reply(' ХАТА ')
  assert.equal(latestMessage().message.message_id, settings.message.message_id)
  assert.match(latestMessage().message.text, /«хата».*🏠 Дом/u)
  await press('Сменить категорию')
  await press('Аренда')
  assert.match(latestMessage().message.text, /Ваше правило — Аренда/u)
  await press('Отключить')
  assert.match(latestMessage().message.text, /Ваше правило — Отключено/u)
  await press('🧠 Запомненные слова', settings)
  assert.match(latestMessage().message.text, /хата → Отключено/u)
  await press('📚 Встроенные слова', settings)
  await press('🏠 Дом')
  const listId = latestMessage().message.message_id
  assert.match(latestMessage().message.text, /Дом · 1\//u)
  assert.ok(buttons(latestMessage().payload).length <= 11)
  await press('➡️ Далее')
  assert.equal(latestMessage().message.message_id, listId)
  assert.match(latestMessage().message.text, /Дом · 2\//u)
  await press('оплата квартиры')
  assert.match(latestMessage().message.text, /«оплата квартиры»/u)
  await press('⬅️ К категории')
  assert.match(latestMessage().message.text, /Дом · 2\//u)
  await press('⬅️ Назад')
  await press('хата')
  await press('Вернуть стандартную')
  assert.doesNotMatch(latestMessage().message.text, /Ваше правило/u)
})

const novemberSaturday = Date.parse('2026-11-21T18:00:00Z') / 1000
function datedText(text: string, date = novemberSaturday) {
  const update = textUpdate(text)
  update.message.date = date
  return update
}

test(
  'category matches set the type and ambiguous or unknown inputs wait for a choice',
  { skip: !budgetTestDatabaseUrl },
  async (t) => {
    const { db, pool } = createDatabase(budgetTestDatabaseUrl!)
    t.after(() => pool.end())
    const app = createApplication(db).telegram
    const userId = await app.users.getOrCreateUser(randomInt(2 ** 40, 2 ** 41))
    const { dispatch, latestMessage, press, calls } = ownerHarness(app, userId)
    let updateId = 50
    const send = (text: string) => dispatch({ ...datedText(text), update_id: updateId++ })

    await send('20000 зарплата')
    assert.match(latestMessage().message.text, /📈 <b>\+ [^]*💼 Зарплата/u)
    await send('-20000 зарплата')
    assert.match(latestMessage().message.text, /📈 <b>\+ [^]*💼 Зарплата/u)
    await send('+250 кофе')
    assert.match(latestMessage().message.text, /📉 <b>− [^]*☕ Кафе/u)
    await send('+3000 подарок')
    assert.match(latestMessage().message.text, /📉 <b>− [^]*🎁 Подарки/u)

    assert.equal(await app.categories.addCategory(userId, 'income', 'Разовые услуги'), 'ok')
    assert.equal(await app.categories.addCategory(userId, 'expense', 'Разовые услуги'), 'ok')
    const beforeChoice = await app.transactions.recent(userId)
    assert.equal(beforeChoice.length, 4)
    await send('+3000 разовые услуги')
    const kindPrompt = latestMessage()
    assert.match(kindPrompt.message.text, /Доход или расход\?/u)
    assert.deepEqual(
      buttons(kindPrompt.payload).map(({ text }) => text),
      ['📈 Доход', '📉 Расход', '↩️ Отмена'],
    )
    await press('📈 Доход', kindPrompt, { ...telegramUser, id: 789 })
    assert.deepEqual(await app.transactions.recent(userId), beforeChoice)
    await Promise.all([press('📈 Доход', kindPrompt), press('📉 Расход', kindPrompt)])
    assert.match(latestMessage().message.text, /📈 <b>\+ [^]*🏷 Разовые услуги/u)
    assert.equal(latestMessage().message.message_id, kindPrompt.message.message_id)
    assert.equal((await app.transactions.recent(userId)).length, 5)

    const callCount = calls.length
    await dispatch({ ...datedText('+3000 разовые услуги'), update_id: updateId - 1 })
    assert.equal(calls.length, callCount)

    await send('в понедельник 321 тестовое описание')
    await press('✅ Записать')
    assert.match(latestMessage().message.text, /Доход или расход\?[^]*16 ноября/u)
    assert.equal((await app.transactions.recent(userId)).length, 5)
    await press('📉 Расход')
    assert.match(latestMessage().message.text, /📉 <b>− [^]*Без категории[^]*16 ноября/u)
    const [dated] = await app.transactions.dailyHistory(userId, '2026-11-16', 'UTC')
    assert.equal(dated?.description, 'тестовое описание')
    assert.equal(dated?.kind, 'expense')

    await send('432 ещё одно тестовое описание')
    const cancelled = latestMessage()
    await press('↩️ Отмена')
    await press('📈 Доход', cancelled)
    assert.equal((await app.transactions.recent(userId)).length, 6)
  },
)

test('dated text records the requested civil day and never silently records invalid dates', async () => {
  const writes: Parameters<TelegramDependencies['transactions']['recordOperation']>[1][] = []
  const { dispatch, latestMessage } = harness(
    {
      getTimeZone: async () => 'Asia/Yekaterinburg',
      recordOperation: async (_owner, input) => {
        writes.push(input)
        return savedExpense
      },
    },
    true,
  )
  for (const [text, date] of [
    ['вчера 480 кофе', '2026-11-20'],
    ['480 кофе 18.11.2026', '2026-11-18'],
    ['2026-11-19 480 кофе', '2026-11-19'],
    ['2 дня назад 480 кофе', '2026-11-19'],
    ['позавчера 480 кофе', '2026-11-19'],
  ] as const) {
    await dispatch(datedText(text))
    assert.deepEqual(writes.at(-1), {
      ...operationDraft,
      operationDate: { date, timeZone: 'Asia/Yekaterinburg' },
    })
    assert.match(latestMessage().message.text, /ноября/u)
    assert.doesNotMatch(latestMessage().message.text, /UTC|2026|Категория:/u)
  }

  await dispatch(datedText('вчера 480 кофе', Date.parse('2026-11-21T20:05:00Z') / 1000))
  assert.equal(writes.at(-1)?.operationDate?.date, '2026-11-21')
  for (const [text, feedback] of [
    ['31.02.2026 480 кофе', /Такой даты нет/u],
    ['завтра 480 кофе', /Дата в будущем/u],
    ['23.11.2026 480 кофе', /Дата в будущем/u],
    ['на прошлой неделе 480 кофе', /конкретный день/u],
    ['вчера и позавчера 480 кофе', /несколько дат/u],
    ['вчера 480 кофе и 700 такси', /одной операции/u],
  ] as const) {
    const count = writes.length
    await dispatch(datedText(text))
    assert.equal(writes.length, count)
    assert.match(latestMessage().message.text, feedback)
  }
  await dispatch(datedText('18 ноября 4800 кофе'))
  assert.match(latestMessage().message.text, /Подтвердите операцию/u)
  assert.match(latestMessage().message.text, /4[\u00a0\u202f ]800 ₽<\/b> · кофе/u)
  await dispatch(datedText('25.10 кофе'))
  assert.equal(writes.at(-1)?.amountKopecks, 2_510n)
  assert.equal(writes.at(-1)?.operationDate, undefined)
  await dispatch(datedText('вчера 480 кофе 24/7'))
  assert.equal(writes.at(-1)?.description, 'кофе 24/7')
})

test('weekday drafts show the chosen date, resolve a mismatch and confirm just once', async () => {
  const dates: string[] = []
  const { calls, dispatch, latestMessage, press } = harness(
    {
      recordOperation: async (_owner, input) => {
        dates.push(input.operationDate!.date)
        return savedExpense
      },
    },
    true,
  )

  for (const [text, display] of [
    ['в понедельник 480 кофе', /понедельник, 16 ноября/u],
    ['в прошлый вторник 480 кофе', /вторник, 10 ноября/u],
    ['в воскресенье 480 кофе', /воскресенье, 15 ноября/u],
    ['29 февраля 480 кофе', /29 февраля/u],
  ] as const) {
    await dispatch(datedText(text))
    assert.match(latestMessage().message.text, display)
    await press('↩️ Отмена')
  }
  await dispatch(datedText('31 декабря 480 кофе', Date.parse('2027-01-02T12:00:00Z') / 1000))
  assert.match(latestMessage().message.text, /31 декабря/u)
  const separateDraft = latestMessage()
  await dispatch(datedText('в понедельник, 16 ноября 2020, 480 кофе'))
  assert.deepEqual(
    buttons(latestMessage().payload)
      .slice(0, 2)
      .map(({ text }) => text),
    ['понедельник, 16 ноября · Ближе', 'понедельник, 16 ноября · Раньше'],
  )
  await press('↩️ Отмена')
  await dispatch(datedText('в понедельник, 17 ноября, 480 кофе'))
  assert.match(latestMessage().message.text, /расходятся/u)
  const disagreement = latestMessage()
  await press('↩️ Отмена', separateDraft)
  await press('вторник, 17 ноября', disagreement)
  const preview = latestMessage()
  assert.deepEqual(dates, [])
  await Promise.all([press('✅ Записать', preview), press('✅ Записать', preview)])
  assert.deepEqual(dates, ['2026-11-17'])
  assert.equal(calls.findLast(({ message }) => message)?.method, 'editMessageText')
  assert.equal(latestMessage().message.message_id, preview.message.message_id)
  assert.match(latestMessage().message.text, /📉 <b>− /u)
})

test('voice uses the same confirmation rules for inferred and explicit dates as text', async () => {
  const writes: Parameters<TelegramDependencies['transactions']['recordOperation']>[] = []
  let transcript = 'В прошлый вторник я потратил четыреста восемьдесят рублей на кофе.'
  const { dispatch, latestMessage, press, reply } = harness(
    {
      getTimeZone: async () => 'Asia/Yekaterinburg',
      recordOperation: async (...args) => {
        writes.push(args)
        return savedExpense
      },
    },
    true,
    async () => transcript,
  )
  const update = voiceUpdate()
  update.message.date = novemberSaturday
  await dispatch(update)
  assert.match(latestMessage().message.text, /Подтвердите операцию/u)
  assert.match(latestMessage().message.text, /480 ₽<\/b> · кофе\n📅 вторник, 10 ноября/u)
  assert.equal(
    buttons(latestMessage().payload).find(({ text }) => text === '✅ Записать')?.style,
    'success',
  )
  assert.equal(writes.length, 0)
  await press('📅 Дата')
  await press('⌨️ Ввести дату')
  const prompt = latestMessage()
  await reply('31.02.2026', prompt)
  assert.match(latestMessage().message.text, /Такой даты нет/u)
  await reply('18.11.2026', prompt)
  assert.match(latestMessage().message.text, /среда, 18 ноября/u)
  await press('✅ Записать')
  assert.deepEqual(writes, [
    [
      ownerId,
      {
        ...operationDraft,
        operationDate: { date: '2026-11-18', timeZone: 'Asia/Yekaterinburg' },
      },
      'telegram:voice:123:7',
    ],
  ])

  transcript =
    'Двадцать первого ноября две тысячи двадцать шестого года четыреста восемьдесят рублей за кофе.'
  await dispatch({ ...update, update_id: 44, message: { ...update.message, message_id: 8 } })
  assert.equal(writes.length, 2)
  assert.deepEqual(writes[1], [
    ownerId,
    {
      ...operationDraft,
      operationDate: { date: '2026-11-21', timeZone: 'Asia/Yekaterinburg' },
    },
    'telegram:voice:123:8',
  ])
  assert.match(latestMessage().message.text, /21 ноября/u)
})

test('changing a receipt date updates the same operation, preserves its category and refreshes the receipt', async () => {
  let current = '2026-11-21'
  const saved = () => ({
    ...operation,
    id: operationId,
    operationDate: { date: current, timeZone: 'UTC' },
    createdAt: new Date(novemberSaturday * 1000),
    categoryName: 'Кафе',
    idempotencyKey: textKey,
  })
  const { dispatch, press, latestMessage, reply } = harness(
    {
      recordOperation: async () => savedExpense,
      getOperation: async () => saved(),
      setOperationDate: async (owner, id, value) => {
        assert.equal(owner, ownerId)
        assert.equal(id, operationId)
        current = value.date
        return true
      },
    },
    true,
  )
  await dispatch(datedText('480 кофе'))
  const receipt = latestMessage()
  await press('📅 Дата')
  await press('⌨️ Ввести дату')
  await reply('31.10.2026')
  assert.equal(current, '2026-11-21')
  await press('✅ Сохранить дату')
  assert.equal(current, '2026-10-31')
  assert.equal(latestMessage().message.message_id, receipt.message.message_id)
  assert.match(latestMessage().message.text, /Кафе\n📅 суббота, 31 октября/u)
})

test('date drafts bind separate replies and expire independently, including on an old photo receipt', async (t) => {
  const start = novemberSaturday * 1000
  t.mock.timers.enable({ apis: ['Date'], now: start })
  let receiptDate = '2026-11-21'
  const writes: string[] = []
  const { calls, dispatch, latestMessage, press, reply } = harness({
    recordOperation: async () => {
      writes.push('new operation')
      return savedExpense
    },
    getOperation: async () => ({
      ...operation,
      id: operationId,
      operationDate: { date: receiptDate, timeZone: 'UTC' },
      createdAt: new Date(start),
      categoryName: 'Кафе',
      idempotencyKey: textKey,
    }),
    setOperationDate: async (_owner, _id, value) => {
      writes.push(value.date)
      receiptDate = value.date
      return true
    },
  })

  await dispatch(datedText('в понедельник 480 кофе'))
  const initial = latestMessage()
  await press('📅 Дата')
  await press('⌨️ Ввести дату')
  const first = latestMessage()

  t.mock.timers.setTime(start + 10 * 60_000)
  const photoId = 200
  await dispatch({
    update_id: 44,
    callback_query: {
      id: 'old-photo-button',
      from: telegramUser,
      chat_instance: 'chat',
      data: 'date:edit:IAAAAAAAQACAAAAAAAAAAA',
      message: { message_id: photoId, from: botInfo, chat: privateChat, date: 1, photo: [] },
    },
  })
  await press('⌨️ Ввести дату')
  const second = latestMessage()
  await Promise.all([reply('19.11.2026', second), reply('18.11.2026', first)])

  const firstEdit = calls.findLast(
    ({ message }) => message?.message_id === initial.message.message_id,
  )
  const secondEdit = calls.findLast(({ message }) => message?.message_id === photoId)
  assert.ok(firstEdit?.message)
  assert.ok(secondEdit?.message)
  assert.match(firstEdit.message.text, /18 ноября/u)
  assert.match(secondEdit.message.text, /19 ноября/u)
  assert.equal(secondEdit.method, 'editMessageCaption')

  await press('✅ Записать', initial)
  assert.match((calls.at(-1)?.payload as { text: string }).text, /недоступно/u)

  t.mock.timers.setTime(start + 30 * 60_000)
  await press('✅ Записать', { message: firstEdit.message, payload: firstEdit.payload })
  assert.match((calls.at(-1)?.payload as { text: string }).text, /недоступно/u)
  await press('✅ Сохранить дату', { message: secondEdit.message, payload: secondEdit.payload })
  assert.deepEqual(writes, ['2026-11-19'])
  assert.equal(latestMessage().message.message_id, photoId)
  assert.equal(calls.findLast(({ message }) => message)?.method, 'editMessageCaption')
  assert.match(latestMessage().message.text, /Кафе\n📅 четверг, 19 ноября/u)
})
