# Отчёт технического прототипа

Дата проверки: 2026-10-01

## Совместимость целевого устройства

| Проверка | Результат |
| --- | --- |
| Модель iPhone | iPhone 15 (по экрану «Об этом устройстве»); теперь виден Mac по USB. |
| Версия iOS | 26.6.1 (по экрану «Об этом устройстве»). |
| WidgetKit Control | iOS 26.6.1 выше минимума iOS 18; доступность на устройстве и установку Control ещё не проверяли. |
| Русский офлайн-speech | Выбрана ветка iOS 26+: проверить `SpeechTranscriber`, затем `DictationTranscriber`, их `supportedLocales`/`installedLocales` и фактическое распознавание `ru-RU` офлайн. |
| Control на заблокированном экране | Не проверено на физическом iPhone. Подтверждения сценария нет. |
| Запись без сети | Не проверена на физическом iPhone. Подтверждения сценария нет. |

## Ограничения API, требующие проверки

- Документация WidgetKit предупреждает: на заблокированном устройстве кнопки и переключатели виджетов не выполняют действие, пока пользователь не пройдёт аутентификацию и не разблокирует устройство. Поэтому путь без разблокировки — открытый риск; подтвердить его может только тест на целевом iPhone.
- Для `AudioRecordingIntent` Apple требует запустить Live Activity вместе с записью и поддерживать её активной до завершения записи.

## Среда разработки

- Mac: MacBook Pro `MacBookPro18,4`, Apple M1 Max.
- macOS: 15.5 (24F74). Повторная проверка 2026-10-06: на томе данных свободно 111 GB.
- Active developer directory: `/Library/Developer/CommandLineTools`.
- Полная Xcode не установлена; `xcodebuild -version` сообщает, что выбран каталог Command Line Tools. iOS SDK и `devicectl` отсутствуют. При первой проверке iPhone был виден по USB; повторная проверка 2026-10-06 его не обнаружила.
- App Store показывает Xcode 27, требующую macOS 26.6 или новее; для целевой iOS 26.6.1 она не нужна.
- `softwareupdate --list` предлагает macOS Sequoia 15.8.1. Выбрана более лёгкая ветка: Xcode 26.3 содержит iOS 26.2 SDK, поддерживает отладку устройств на iOS 15 и новее и требует macOS 15.6 или новее. После обновления до Sequoia 15.8.1 эта Xcode подходит для целевого iPhone. Установка macOS и Xcode ещё не запускалась.
- Последняя повторная USB-проверка iPhone не нашла; подключение проверить снова после установки Xcode.

Источники: [WidgetKit Controls](https://developer.apple.com/documentation/widgetkit/adding-interactivity-to-widgets-and-live-activities), [AudioRecordingIntent](https://developer.apple.com/documentation/appintents/audiorecordingintent), [требования Xcode](https://developer.apple.com/xcode/system-requirements), [SpeechTranscriber](https://developer.apple.com/documentation/speech/speechtranscriber).

## Вывод

Модель и iOS установлены; выбрана API-ветка, задача 1.1 закрыта. Технический прототип ещё не создан и не собран. Ни запуск с экрана блокировки, ни офлайн-распознавание русского не подтверждены. Следующий шаг — обновить Sequoia до 15.8.1 и установить Xcode 26.3; финансовый MVP до положительной проверки прототипа не начинать.

## Данные, нужные для продолжения

Для продолжения: установить обновление **macOS Sequoia 15.8.1** через **Системные настройки → Основные → Обновление ПО** и перезагрузить Mac. Затем скачать **Xcode 26.3** из [Apple Developer Downloads](https://developer.apple.com/download/all/?q=Xcode), открыть её и принять лицензию. После этого выбрать Xcode через `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer`. Подключить iPhone; если Xcode запросит доверие или Developer Mode, подтвердить это на самом телефоне.
