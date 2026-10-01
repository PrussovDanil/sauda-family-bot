import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Bot } from 'grammy';
import {
  AnalysisService,
  type CloudAnalysisResult,
} from '../analysis/analysis.service';
import { CloudAnalysisError } from '../analysis/cloud-analysis.error';
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
  'Отправьте номер лота цифрами. Для облачного анализа используйте например /analyze 463354.';
const INVALID_INPUT_MESSAGE =
  'Некорректный номер лота. Отправьте только цифры без пробелов и знаков.';
const BUSY_MESSAGE =
  'Предыдущий запрос ещё обрабатывается. Дождитесь его завершения.';

type Reply = (text: string) => Promise<unknown>;

@Injectable()
export class TelegramService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelegramService.name);

  private readonly activeUsers = new Set<number>();

  private polling = false;

  constructor(
    @Inject(TELEGRAM_BOT) private readonly bot: Bot,
    private readonly ingestionService: IngestionService,
    private readonly analysisService: AnalysisService,
    private readonly configService: ConfigService,
  ) {}

  onModuleInit(): void {
    this.bot.command('id', async (context) => {
      await this.handleId(context.from?.id, (text) => context.reply(text));
    });
    this.bot.command('start', async (context) => {
      const reply = (text: string) => context.reply(text);
      if (await this.authorize(context.from?.id, reply)) {
        await this.replySafely(reply, START_MESSAGE);
      }
    });
    this.bot.command('analyze', async (context) => {
      await this.handleAnalyzeCommand(
        String(context.match ?? ''),
        (text) => context.reply(text),
        context.from?.id,
      );
    });
    this.bot.on('message:text', async (context) => {
      await this.handleLotNumber(
        context.message.text,
        (text) => context.reply(text),
        context.from?.id,
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

  async handleLotNumber(
    input: string,
    reply: Reply,
    userId: number | undefined,
  ): Promise<void> {
    await this.processLot(input, reply, userId, false);
  }

  async handleAnalyzeCommand(
    input: string,
    reply: Reply,
    userId: number | undefined,
  ): Promise<void> {
    await this.processLot(input, reply, userId, true);
  }

  async handleId(userId: number | undefined, reply: Reply): Promise<void> {
    await this.replySafely(
      reply,
      userId === undefined
        ? 'Не удалось определить ваш Telegram ID.'
        : `Ваш Telegram ID: ${userId}`,
    );
  }

  private async processLot(
    input: string,
    reply: Reply,
    userId: number | undefined,
    withAnalysis: boolean,
  ): Promise<void> {
    if (!(await this.authorize(userId, reply)) || userId === undefined) {
      return;
    }

    const lotNumber = input.trim();
    if (!LOT_NUMBER_PATTERN.test(lotNumber)) {
      await this.replySafely(reply, INVALID_INPUT_MESSAGE);
      return;
    }
    if (this.activeUsers.has(userId)) {
      await this.replySafely(reply, BUSY_MESSAGE);
      return;
    }

    this.activeUsers.add(userId);
    await this.replySafely(
      reply,
      withAnalysis
        ? `Обрабатываю лот №${lotNumber} и готовлю облачный анализ…`
        : `Обрабатываю лот №${lotNumber}…`,
    );
    try {
      const ingestion = await this.ingestionService.ingestLot(lotNumber);
      await this.replySafely(reply, this.formatResult(ingestion));
      if (withAnalysis) {
        const analysis = await this.analysisService.analyzeLot(ingestion);
        await this.replySafely(reply, this.formatAnalysis(analysis));
      }
    } catch (error) {
      await this.replySafely(reply, this.getUserErrorMessage(error));
    } finally {
      this.activeUsers.delete(userId);
    }
  }

  private async authorize(
    userId: number | undefined,
    reply: Reply,
  ): Promise<boolean> {
    const allowedIds = new Set(
      (this.configService.get<string>('TELEGRAM_ALLOWED_USER_IDS') ?? '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
    );
    if (userId !== undefined && allowedIds.has(String(userId))) {
      return true;
    }

    await this.replySafely(reply, 'У вас нет доступа к этому боту.');
    return false;
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
    lines.push(
      result.isPartial
        ? `⚠️ Лот сохранён частично: ошибок документов — ${result.failedDocuments}, неподдерживаемых — ${result.unsupportedDocuments}.`
        : 'Лот и документы сохранены успешно.',
    );
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

  private formatAnalysis(result: CloudAnalysisResult): string {
    const labels = { high: 'высокий', medium: 'средний', low: 'низкий' };
    const lines = [
      `Облачный анализ${result.cached ? ' (из кэша)' : ''}:`,
      this.safeField(result.analysis.summary, 1200),
    ];
    if (result.analysis.risks.length > 0) {
      lines.push('Риски:');
      for (const risk of result.analysis.risks) {
        lines.push(
          `• ${labels[risk.severity]} — ${this.safeField(risk.title, 250)}: ${this.safeField(risk.evidence, 600)}`,
        );
      }
    }
    if (result.analysis.recommendedChecks.length > 0) {
      lines.push('Что проверить:');
      lines.push(
        ...result.analysis.recommendedChecks.map(
          (check) => `• ${this.safeField(check, 500)}`,
        ),
      );
    }
    lines.push(this.safeField(result.analysis.disclaimer, 700));
    return lines.join('\n').slice(0, TELEGRAM_MESSAGE_LIMIT);
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
    if (error instanceof CloudAnalysisError) {
      return this.analysisService.isEnabled()
        ? 'Облачный анализ временно недоступен. Лот и документы уже сохранены.'
        : 'Облачный анализ отключён администратором.';
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
