# Sauda Family Bot

Telegram-бот для поиска лотов Sauda E-Qazyna, загрузки PDF-документов,
извлечения текста и сохранения проверенных данных в SQLite.

## Возможности

- поиск лота по номеру и строгий разбор актуальной страницы Sauda;
- безопасная загрузка PDF с проверкой домена, размера и сигнатуры;
- извлечение текста, оценка качества и дедупликация по SHA-256;
- транзакционное сохранение лотов и документов в SQLite;
- Telegram long polling с allowlist и защитой от повторных запросов;
- опциональный структурированный анализ через OpenAI Responses API.

## Установка

Требуются Node.js 24 и pnpm 10.

```bash
pnpm install
cp .env.example .env
```

Заполните `.env`:

- `TELEGRAM_BOT_TOKEN` — токен от BotFather;
- `TELEGRAM_ALLOWED_USER_IDS` — разрешённые Telegram ID через запятую;
- `SQLITE_DATABASE_PATH` — путь к SQLite;
- переменные `OPENAI_*` — только если нужен облачный анализ.

Если Telegram ID неизвестен, запустите бота и отправьте `/id`. Эта команда
доступна до настройки allowlist. Добавьте полученный ID в
`TELEGRAM_ALLOWED_USER_IDS` и перезапустите процесс.

Проект использует дополнительный CA-файл
`.certs/ssl-com-tls-issuing-rsa-ca-r1.pem`. Он локальный и не коммитится.

## Запуск

```bash
pnpm start
```

Используйте постоянные кнопки «Найти лот», «Анализ лота» и «Мой ID». После
выбора действия бот попросит номер лота. Номер также можно отправить обычным
сообщением — это запустит обычный поиск без облачного анализа. Бот сначала
сообщит о начале обработки, затем вернёт факты и статистику документов.

Облачный анализ запускается отдельно:

```text
/analyze 463354
```

Он отключён по умолчанию. Для включения задайте API-ключ, модель и
`OPENAI_ANALYSIS_ENABLED=true`. В OpenAI отправляется только ограниченный набор
фактов и извлечённого текста без URL с токенами. Запросы выполняются через
Responses API со `store: false` и Structured Outputs; результаты кэшируются в
локальной SQLite. См. [официальную документацию OpenAI](https://developers.openai.com/api/docs/guides/structured-outputs).

## CLI

```bash
pnpm sauda:resolve 463354
pnpm sauda:lot 463354
pnpm sauda:documents 463354
pnpm sauda:store 463354
```

## Проверки

```bash
pnpm typecheck
pnpm lint
pnpm test --runInBand
pnpm test:e2e --runInBand
pnpm build
```

Unit-тесты парсеров используют сохранённые HTML fixtures и не обращаются к
живому Sauda.

## Постоянный запуск через systemd

1. Разместите проект в `/opt/sauda-family-bot`.
2. Создайте системного пользователя `sauda-bot` и выдайте ему доступ к проекту
   и каталогу `data`.
3. Установите зависимости и выполните `pnpm build`.
4. Заполните `/opt/sauda-family-bot/.env` и добавьте CA-файл.
5. Скопируйте `deploy/sauda-family-bot.service` в `/etc/systemd/system/`.
6. Выполните:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now sauda-family-bot
sudo systemctl status sauda-family-bot
```

Логи доступны через `journalctl -u sauda-family-bot`. Секреты должны храниться
только в `.env`; файл уже исключён из Git.

## SQLite

При старте миграции применяются автоматически. Перед обновлением остановите
бота и сохраните копию файла SQLite. Не копируйте базу во время активной записи
без SQLite backup API или предварительного WAL checkpoint.

## Безопасность

- не коммитьте `.env`, Telegram/OpenAI ключи, сертификаты и SQLite;
- перевыпускайте опубликованные токены;
- оставляйте allowlist непустым;
- вывод облачного анализа является вспомогательным и требует проверки по
  исходным документам.
