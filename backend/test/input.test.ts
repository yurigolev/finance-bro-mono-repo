import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { test, type TestContext } from 'node:test'
import { createAudioTranscriber, validateAudio } from '../services/input/audio.ts'
import { createInputClient } from '../services/bot/clients/input.ts'
import { maxInputAudioBytes, type InputContext } from '../packages/contracts/input.ts'
import { createInputServer } from '../services/input/http.ts'

const context: InputContext = {
  sentAt: '2026-11-24T14:00:00+05:00',
  timeZone: 'Asia/Yekaterinburg',
  categories: [
    { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', kind: 'expense', name: 'Кафе', key: null },
    {
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      kind: 'expense',
      name: 'Путешествия',
      key: null,
    },
  ],
  categoryRules: [
    { expression: 'кофе', kind: 'expense', categoryId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
    {
      expression: 'в путешествии',
      kind: 'expense',
      categoryId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    },
  ],
}
const example = 'В прошлый вторник кофе в путешествии 400р'
const audio = new File(['audio bytes'], 'voice.ogg', { type: 'audio/ogg' })
const token = 'input-test-bot-token'
const otherToken = 'input-test-other-client-token'

async function start(
  t: TestContext,
  options: Partial<Parameters<typeof createInputServer>[0]> = {},
) {
  const server = createInputServer({
    tokens: [token, otherToken],
    validateAudio: async () => 'ok',
    transcribe: async () => example,
    ...options,
  })
  server.listen(0, '127.0.0.1')
  t.after(() => {
    server.close()
    server.closeAllConnections()
  })
  await once(server, 'listening')
  const address = server.address()
  assert(address && typeof address === 'object')
  return `http://127.0.0.1:${address.port}`
}

test('bot audio and a second client text yield equivalent parsed transactions', async (t) => {
  let whisperCalls = 0
  const url = await start(t, {
    transcribe: async (uploaded) => {
      whisperCalls++
      assert.equal(uploaded.type, 'audio/ogg')
      assert.equal(await uploaded.text(), 'audio bytes')
      return `  ${example}\n`
    },
  })
  const bot = createInputClient({ url, token })
  const other = createInputClient({ url, token: otherToken })
  const text = await other.parseText(example, context)
  assert.equal(whisperCalls, 0)
  assert(text.ok)
  const spoken = await bot.parseAudio(audio, context)
  assert(spoken.ok)
  assert.equal(whisperCalls, 1)
  assert.deepEqual(spoken.result, { ...text.result, transcript: example })
  assert.deepEqual(text.result.draft, {
    kind: 'expense',
    amountKopecks: '40000',
    currency: 'RUB',
    description: 'кофе в путешествии',
    operationDate: { date: '2026-11-17', timeZone: 'Asia/Yekaterinburg' },
  })
  assert.deepEqual(text.result.dateConfirmation, {
    dates: ['2026-11-17'],
    today: '2026-11-24',
    timeZone: 'Asia/Yekaterinburg',
  })
  assert.deepEqual(
    text.result.categoryCandidates.map(({ name }) => name),
    ['Кафе', 'Путешествия'],
  )
  assert.deepEqual(text.result.needsClarification, ['operationDate', 'categoryId'])
})

test('supports confirmed kind, dated errors, short amounts and alternate date choices', async (t) => {
  const url = await start(t)
  const client = createInputClient({ url, token })
  const draft = await client.parseText('400 неизвестно', { ...context, kind: 'income' })
  assert(draft.ok)
  assert.equal(draft.result.draft.kind, 'income')
  assert.deepEqual(draft.result.needsClarification, ['categoryId'])

  const badDate = await client.parseText('31.02.2026 кофе 400', context)
  assert(!badDate.ok)
  assert.equal(badDate.error, 'invalid_date')
  assert.match(badDate.message ?? '', /Такой даты нет/u)

  const amount = await client.parseText('7.50 кофе', context)
  assert(amount.ok)
  assert.equal(amount.result.draft.amountKopecks, '750')
  assert.equal(amount.result.draft.operationDate, null)
  assert.equal(amount.result.dateConfirmation, undefined)

  const alternate = await client.parseText('в понедельник, 16 ноября 2020, 480 кофе', context)
  assert(alternate.ok)
  assert.equal(alternate.result.draft.operationDate, null)
  assert.deepEqual(alternate.result.dateConfirmation?.dates, ['2026-11-23', '2020-11-16'])
})

test('parses budget and date answers as JSON without transcribing or matching categories', async (t) => {
  const url = await start(t, {
    transcribe: async () => assert.fail('a text answer must not reach Whisper'),
    matchCategories: () => assert.fail('a text answer must not match categories'),
  })
  const input = createInputClient({ url, token })
  const timeZone = 'Asia/Yekaterinburg'
  const context = {
    today: '2026-11-21',
    timeZone,
    draft: {
      kind: 'expense',
      amountKopecks: '40000',
      currency: 'RUB',
      description: 'кофе',
      operationDate: null,
    },
  } as const

  assert.deepEqual(await input.parseBudgetLimit('8 000,25'), {
    ok: true,
    result: { amountKopecks: '800025' },
  })
  assert.deepEqual(await input.parseBudgetLimit('-100'), { ok: false, error: 'unrecognized' })
  assert.deepEqual(await input.parseDate('в прошлый вторник', context), {
    ok: true,
    result: {
      status: 'resolved',
      draft: { ...context.draft, operationDate: { date: '2026-11-10', timeZone } },
    },
  })
  assert.deepEqual(await input.parseDate('в понедельник, 18 ноября', context), {
    ok: true,
    result: { status: 'clarification-required', dates: ['2026-11-16', '2026-11-18'] },
  })
  const invalid = await input.parseDate('31.02.2026', context)
  assert.equal(invalid.ok, false)
  if (!invalid.ok) {
    assert.equal(invalid.error, 'invalid_date')
    assert.match(invalid.message ?? '', /Такой даты нет/u)
  }
  assert.deepEqual(await input.parseDate('18 ноября кофе', context), {
    ok: false,
    error: 'unrecognized',
  })
  assert.deepEqual(await input.parseDate('сегодня', { ...context, timeZone: '+05:00' }), {
    ok: false,
    error: 'invalid_request',
  })
  assert.deepEqual(
    await createInputClient({ url, token: 'invalid-token' }).parseBudgetLimit('100'),
    { ok: false, error: 'unauthorized' },
  )
})

test('rejects unauthenticated, oversized and invalid audio before transcription', async (t) => {
  let validations = 0
  const url = await start(t, {
    validateAudio: async (part) => {
      validations++
      return part.type === 'audio/ogg' ? 'audio_too_long' : 'unsupported_audio'
    },
    transcribe: async () => assert.fail('rejected audio must not reach Whisper'),
  })
  const forbidden = createInputClient({ url, token: 'wrong-token' })
  const client = createInputClient({ url, token })
  assert.deepEqual(await forbidden.parseAudio(audio, context), { ok: false, error: 'unauthorized' })
  const oversized = new File([new Uint8Array(maxInputAudioBytes + 1)], 'voice.ogg', {
    type: 'audio/ogg',
  })
  assert.deepEqual(await client.parseAudio(oversized, context), {
    ok: false,
    error: 'audio_too_large',
  })
  assert.equal(validations, 0)
  assert.deepEqual(await client.parseAudio(audio, context), { ok: false, error: 'audio_too_long' })
  assert.deepEqual(await client.parseAudio(new File(['bad'], 'bad.bin'), context), {
    ok: false,
    error: 'unsupported_audio',
  })
  assert.equal(validations, 2)
})

test('distinguishes an empty transcript, an unrecognized transcript and Whisper failures', async (t) => {
  const transcripts = [' ', 'непонятно']
  const url = await start(t, {
    transcriptionTimeoutMs: 200,
    transcribe: async (_audio, signal) => {
      const text = transcripts.shift()
      if (text !== undefined) return text
      return new Promise((_, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
    },
  })
  const client = createInputClient({ url, token })
  assert.deepEqual(await client.parseAudio(audio, context), {
    ok: false,
    error: 'empty_transcript',
  })
  assert.deepEqual(await client.parseAudio(audio, context), {
    ok: false,
    error: 'unrecognized',
    transcript: 'непонятно',
  })
  assert.deepEqual(await client.parseAudio(audio, context), {
    ok: false,
    error: 'transcription_timeout',
  })

  const unavailable = await start(t, {
    transcribe: async () => {
      throw new Error('unexpected Whisper response')
    },
  })
  assert.deepEqual(
    await createInputClient({ url: unavailable, token }).parseAudio(audio, context),
    {
      ok: false,
      error: 'transcription_failed',
    },
  )
})

test('Whisper receives the same multipart file and JSON response option as the bot', async (t) => {
  const { createServer } = await import('node:http')
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(chunk)
    const body = await new Response(Buffer.concat(chunks), {
      headers: { 'Content-Type': request.headers['content-type'] ?? '' },
    }).formData()
    const file = body.get('file')
    assert(file instanceof File)
    assert.equal(file.name, 'voice.ogg')
    assert.equal(await file.text(), 'audio bytes')
    assert.equal(body.get('response_format'), 'json')
    response
      .writeHead(200, { 'Content-Type': 'application/json' })
      .end(JSON.stringify({ text: example }))
  })
  server.listen(0, '127.0.0.1')
  t.after(() => {
    server.close()
    server.closeAllConnections()
  })
  await once(server, 'listening')
  const address = server.address()
  assert(address && typeof address === 'object')
  const transcribe = createAudioTranscriber(`http://127.0.0.1:${address.port}/inference`)
  assert.equal(await transcribe(audio, AbortSignal.timeout(1000)), example)
})

function wav(seconds: number) {
  const sampleRate = 8000
  const dataSize = Math.round(seconds * sampleRate) * 2
  const bytes = new Uint8Array(dataSize + 44)
  const header = Buffer.from(bytes.buffer, 0, 44)
  header.write('RIFF')
  header.writeUInt32LE(dataSize + 36, 4)
  header.write('WAVEfmt ', 8)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(dataSize, 40)
  return new File([bytes], 'test.wav', { type: 'audio/wav' })
}

test(
  'FFmpeg rejects decoded duration over 20 seconds',
  {
    skip: spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status !== 0,
  },
  async () => {
    const signal = AbortSignal.timeout(15_000)
    assert.equal(await validateAudio(wav(20), signal), 'ok')
    assert.equal(await validateAudio(wav(20.1), signal), 'audio_too_long')
    assert.equal(
      await validateAudio(new File(['not a wav'], 'wrong.wav', { type: 'audio/wav' }), signal),
      'unsupported_audio',
    )
  },
)

test('message drafts share the text and voice parser and keep amounts, descriptions and dates per row', async (t) => {
  const spoken = 'кофе двести пятьдесят такси семьсот'
  const url = await start(t, { transcribe: async () => spoken })
  const client = createInputClient({ url, token })
  const legacy = await fetch(new URL('/v1/parse', url), {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: spoken, context }),
  })
  assert.equal(legacy.status, 422)

  const text = await client.parseText(spoken, context)
  const voice = await client.parseAudio(audio, context)
  assert.ok(text.ok && voice.ok)
  assert.deepEqual(voice.result.rows, text.result.rows)
  assert.deepEqual(
    text.result.rows?.map(({ draft }) => draft.amountKopecks),
    ['25000', '70000'],
  )

  for (const [message, expected] of [
    [
      'Такси 750, нет, 570, и кофе 250',
      [
        ['57000', 'Такси', '2026-11-24'],
        ['25000', 'кофе', '2026-11-24'],
      ],
    ],
    [
      'Вчера кофе 250, сегодня ещё 300',
      [
        ['25000', 'кофе', '2026-11-23'],
        ['30000', '', '2026-11-24'],
      ],
    ],
    [
      'Вчера кофе 250 и такси 700, сегодня ещё 300',
      [
        ['25000', 'кофе', '2026-11-23'],
        ['70000', 'такси', '2026-11-23'],
        ['30000', '', '2026-11-24'],
      ],
    ],
    [
      'кофе 250,50 и такси 700',
      [
        ['25050', 'кофе', '2026-11-24'],
        ['70000', 'такси', '2026-11-24'],
      ],
    ],
  ] as const) {
    const result = await client.parseText(message, context)
    assert.ok(result.ok, message)
    assert.deepEqual(
      result.result.rows?.map(({ draft }) => [
        draft.amountKopecks,
        draft.description,
        draft.operationDate?.date,
      ]),
      expected,
      message,
    )
  }

  const kopecks = await client.parseText('250 рублей 50 копеек кофе и такси 700', context)
  assert.ok(kopecks.ok)
  assert.deepEqual(
    kopecks.result.rows?.map(({ draft }) => draft.amountKopecks),
    ['25050', '70000'],
  )

  const extra = await client.parseText('Такси 750 рублей и ещё 570 рублей', context)
  assert.ok(extra.ok)
  assert.equal(extra.result.rows?.[1]?.draft.description, '')
  assert.equal(extra.result.rows?.[1]?.draft.kind, 'expense')
  assert.deepEqual(extra.result.rows?.[1]?.categoryCandidates, [])

  const spokenExtra = await client.parseText(
    'вчера кофе двести пятьдесят сегодня ещё триста',
    context,
  )
  assert.ok(spokenExtra.ok)
  assert.deepEqual(
    spokenExtra.result.rows?.map(({ draft }) => [
      draft.amountKopecks,
      draft.description,
      draft.operationDate?.date,
    ]),
    [
      ['25000', 'кофе', '2026-11-23'],
      ['30000', '', '2026-11-24'],
    ],
  )

  const corrected = await client.parseText('Такси 750… нет, 570', context)
  assert.ok(corrected.ok)
  assert.equal(corrected.result.draft.amountKopecks, '57000')
  assert.equal(corrected.result.rows, undefined)

  const quantity = await client.parseText('Вчера за 2 чашки кофе заплатил 350 рублей', context)
  assert.ok(quantity.ok)
  assert.equal(quantity.result.draft.amountKopecks, '35000')
  assert.equal(quantity.result.draft.operationDate?.date, '2026-11-23')

  for (const message of [
    'Кофе 250 или 350',
    'Кофе от 200 до 250 рублей',
    'Кофе около 250',
    'Кофе 250–350',
  ]) {
    const result = await client.parseText(message, context)
    assert.ok(!result.ok && result.error === 'unrecognized', message)
  }
})
