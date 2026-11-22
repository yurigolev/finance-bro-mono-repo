import { mainKeyboard, menu } from '../ui.ts'

const help = [
  '<b>💸 Расход</b> — <code>480 кофе</code> или <code>квартира 40 тыс.</code>',
  '<b>💰 Доход</b> — <code>20 000 зарплата</code>. Тип определяется по категории. Если совпадения нет или подходят оба типа, бот попросит выбрать.',
  '<b>📅 Прошлая дата</b> — <code>вчера 480 кофе</code>, <code>в понедельник 480 кофе</code> или <code>18 ноября 480 кофе</code>',
  '<b>🎙 Голосом</b> — «В прошлый вторник потратил 480 рублей на кофе». Перед записью бот покажет дату.',
  '<b>🧾 История</b> — расходы и доходы по дням. В карточке можно изменить дату, категорию или удалить запись.',
  '<b>📊 Статистика</b> — итоги за сегодня. Категории и словарь — в настройках.',
  '<b>🎯 Бюджеты</b> — лимиты на месяц и расходы по категориям.',
  '<b>🌐 Часовой пояс</b> — <code>/timezone</code>. Для смены отправьте <code>/timezone Asia/Yekaterinburg</code>.',
].join('\n\n')

export function helpScreen(start = false) {
  const title = start ? '💰 FinanceBro' : menu.help
  return {
    html: `<b>${title}</b>\n\n${help}`,
    options: { ...mainKeyboard, parse_mode: 'HTML' as const },
  }
}
