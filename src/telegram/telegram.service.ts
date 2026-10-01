import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type { Bot } from 'grammy';
import { DatabaseError } from '../database/errors/database.error';
import { MigrationError } from '../database/errors/migration.error';
import type { LotAnalysisSaveResult } from '../database/persistence.service';
import {
  IngestionService,
  type LotIngestionResult,
} from '../ingestion/ingestion.service';
import { LotAmbiguousError } from '../sauda/errors/lot-ambiguous.error';
import { LotMismatchError } from '../sauda/errors/lot-mismatch.error';
import { LotNotFoundError } from '../sauda/errors/lot-not-found.error';
import { LotPageParseError } from '../sauda/errors/lot-page-parse.error';
import { LotPageUnavailableError } from '../sauda/errors/lot-page-unavailable.error';
import { SaudaSearchParseError } from '../sauda/errors/sauda-search-parse.error';
import { SaudaUnavailableError } from '../sauda/errors/sauda-unavailable.error';
import { TELEGRAM_BOT } from './telegram.constants';

const LOT_NUMBER_PATTERN = /^\d+$/;
const TELEGRAM_MESSAGE_LIMIT = 4000;
const START_MESSAGE =
  'Отправьте номер лота Sauda E-Qazyna цифрами, например: 460051.';
const INVALID_INPUT_MESSAGE =
  'Некорректный номер лота. Отправьте только цифры без пробелов и знаков.';

type Reply = (text: string) => Promise<unknown>;

@Injectable()
export class TelegramService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelegramService.name);

  private polling = false;

  constructor(
    @Inject(TELEGRAM_BOT) private readonly bot: Bot,
    private readonly ingestionService: IngestionService,
  ) {}

  onModuleInit(): void {
    this.bot.command('start', async (context) => {
      await this.replySafely((text) => context.reply(text), START_MESSAGE);
    });
    this.bot.on('message:text', async (context) => {
      await this.handleLotNumber(context.message.text, (text) =>
        context.reply(text),
      );
    });
    this.bot.catch(() => {
      this.logger.error('Telegram update handling failed');
    });
  }

  async start(): Promise<void> {
    this.polling = true;
    try {
      await this.bot.start();
    } finally {
      this.polling = false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.polling) {
      return;
    }

    try {
      await this.bot.stop();
    } catch {
      this.logger.error('Telegram bot shutdown failed');
    } finally {
      this.polling = false;
    }
  }

  async handleLotNumber(input: string, reply: Reply): Promise<void> {
    const lotNumber = input.trim();
    if (!LOT_NUMBER_PATTERN.test(lotNumber)) {
      await this.replySafely(reply, INVALID_INPUT_MESSAGE);
      return;
    }

    try {
      const ingestion = await this.ingestionService.ingestLot(lotNumber);
      await this.replySafely(reply, this.formatResult(ingestion));
    } catch (error) {
      await this.replySafely(reply, this.getUserErrorMessage(error));
    }
  }

  private formatResult(ingestion: LotIngestionResult): string {
    const { lot, result } = ingestion;
    const price = lot.startingPrice
      ? `${this.safeField(lot.startingPrice.amount)} ${lot.startingPrice.currency}`
      : 'не указана';
    const lines = [
      `Лот №${this.safeField(lot.lotNumber)}`,
      `Название: ${this.safeField(lot.title, 700)}`,
      `Статус: ${this.safeField(lot.status ?? 'не указан')}`,
      `Стартовая цена: ${price}`,
      `Начало торгов: ${this.safeField(lot.auctionStartsAtRaw ?? 'не указано')}`,
      this.formatDocumentSummary(result),
    ];

    if (result.isPartial) {
      lines.push(
        `⚠️ Лот сохранён частично: ошибок документов — ${result.failedDocuments}, неподдерживаемых — ${result.unsupportedDocuments}.`,
      );
    } else {
      lines.push('Лот и документы сохранены успешно.');
    }

    return lines.join('\n').slice(0, TELEGRAM_MESSAGE_LIMIT);
  }

  private formatDocumentSummary(result: LotAnalysisSaveResult): string {
    return [
      `Документы: найдено ${result.documentsFound}`,
      `обработано ${result.processedDocuments}`,
      `новых ${result.newDocuments}`,
      `переиспользовано ${result.reusedDocuments}`,
      `дубликатов ${result.duplicateDocuments}`,
    ].join(', ');
  }

  private getUserErrorMessage(error: unknown): string {
    if (error instanceof LotNotFoundError) {
      return 'Лот с таким номером не найден.';
    }
    if (error instanceof LotAmbiguousError) {
      return 'Для этого номера найдено несколько публикаций. Уточните данные лота.';
    }
    if (
      error instanceof SaudaSearchParseError ||
      error instanceof LotPageParseError ||
      error instanceof LotMismatchError
    ) {
      return 'Структура страницы Sauda изменилась. Попробуйте позже.';
    }
    if (
      error instanceof SaudaUnavailableError ||
      error instanceof LotPageUnavailableError
    ) {
      return 'Sauda временно недоступен. Попробуйте позже.';
    }
    if (error instanceof DatabaseError || error instanceof MigrationError) {
      return 'Не удалось сохранить результат. Попробуйте позже.';
    }
    return 'Не удалось обработать лот. Попробуйте позже.';
  }

  private async replySafely(reply: Reply, text: string): Promise<void> {
    try {
      await reply(text);
    } catch {
      this.logger.error('Telegram reply failed');
    }
  }

  private safeField(value: string, maxLength = 300): string {
    const withoutControlCharacters = Array.from(value, (character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127 ? ' ' : character;
    }).join('');

    return withoutControlCharacters
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, maxLength);
  }
}
