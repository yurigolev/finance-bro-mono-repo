import { createAudioTranscriber } from './audio.ts'
import { createInputServer } from './http.ts'

const {
  INPUT_HTTP_HOST = '127.0.0.1',
  INPUT_HTTP_PORT = '8788',
  INPUT_SERVICE_TOKEN = '',
  INPUT_CLIENT_TOKENS = '',
  WHISPER_URL,
} = process.env

const port = Number(INPUT_HTTP_PORT)
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('Некорректный порт сервиса обработки ввода.')
}
const whisperUrl = WHISPER_URL && URL.parse(WHISPER_URL)
if (!whisperUrl || !['http:', 'https:'].includes(whisperUrl.protocol)) {
  throw new Error('Требуется HTTP URL сервиса Whisper.')
}

const server = createInputServer({
  tokens: [
    INPUT_SERVICE_TOKEN,
    ...INPUT_CLIENT_TOKENS.split(',').map((value) => value.trim()),
  ].filter(Boolean),
  transcribe: createAudioTranscriber(whisperUrl.href),
})

server.on('error', () => {
  console.error('FinanceBro: не удалось запустить обработчик ввода.')
  process.exitCode = 1
})
server.listen(port, INPUT_HTTP_HOST, () => {
  console.log(`FinanceBro: обработчик ввода слушает порт ${port}.`)
})
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => server.close())
}
