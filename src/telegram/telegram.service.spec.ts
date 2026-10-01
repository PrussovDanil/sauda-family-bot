import { jest } from '@jest/globals';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Bot } from 'grammy';
import {
  AnalysisService,
  type CloudAnalysisResult,
} from '../analysis/analysis.service';
import { DatabaseError } from '../database/errors/database.error';
import type { LotAnalysisSaveResult } from '../database/persistence.service';
import { IngestionService } from '../ingestion/ingestion.service';
import type { LotIngestionResult } from '../ingestion/ingestion.service';
import { LotAmbiguousError } from '../sauda/errors/lot-ambiguous.error';
import { LotMismatchError } from '../sauda/errors/lot-mismatch.error';
import { LotNotFoundError } from '../sauda/errors/lot-not-found.error';
import { LotPageParseError } from '../sauda/errors/lot-page-parse.error';
import { LotPageUnavailableError } from '../sauda/errors/lot-page-unavailable.error';
import { SaudaSearchParseError } from '../sauda/errors/sauda-search-parse.error';
import { SaudaUnavailableError } from '../sauda/errors/sauda-unavailable.error';
import { TelegramService } from './telegram.service';

function createSaveResult(
  overrides: Partial<LotAnalysisSaveResult> = {},
): LotAnalysisSaveResult {
  return {
    lotId: 1,
    documentsFound: 2,
    processedDocuments: 2,
    uniqueDocuments: 2,
    newDocuments: 1,
    reusedDocuments: 1,
    duplicateDocuments: 0,
    unsupportedDocuments: 0,
    failedDocuments: 0,
    unchangedDocuments: 1,
    updatedDocuments: 0,
    isPartial: false,
    ...overrides,
  };
}

function createIngestionResult(
  result = createSaveResult(),
): LotIngestionResult {
  return {
    lot: {
      lotNumber: '460051',
      publicationId: 'publication-460051',
      url: 'https://sauda.e-qazyna.kz/lot?Token=secret-token',
      title: 'Нежилое помещение',
      status: 'Прием заявок',
      startingPrice: {
        amount: '30229644.00',
        currency: 'KZT',
        sourceRaw: '₸ 30 229 644,00',
      },
      auctionStartsAtRaw: '10.09.2026 10:00',
      documents: [],
      parsedAt: '2026-10-01T00:00:00.000Z',
    },
    documents: [],
    result,
  };
}

describe('TelegramService', () => {
  function createService() {
    const bot = {
      command: jest.fn(),
      hears: jest.fn(),
      on: jest.fn(),
      catch: jest.fn(),
      start: jest.fn<() => Promise<void>>(),
      stop: jest.fn<() => Promise<void>>(),
    };
    bot.start.mockResolvedValue();
    bot.stop.mockResolvedValue();
    const ingestion = {
      ingestLot: jest.fn<(lotNumber: string) => Promise<LotIngestionResult>>(),
    };
    ingestion.ingestLot.mockResolvedValue(createIngestionResult());
    const analysis = {
      analyzeLot:
        jest.fn<
          (ingestion: LotIngestionResult) => Promise<CloudAnalysisResult>
        >(),
      isEnabled: jest.fn(() => false),
    };
    const config = {
      get: jest.fn((key: string) =>
        key === 'TELEGRAM_ALLOWED_USER_IDS' ? '42' : undefined,
      ),
    };

    return {
      service: new TelegramService(
        bot as unknown as Bot,
        ingestion as unknown as IngestionService,
        analysis as unknown as AnalysisService,
        config as unknown as ConfigService,
      ),
      bot,
      ingestion,
      analysis,
      config,
    };
  }

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('registers grammY command, text, and error handlers', () => {
    const { service, bot } = createService();

    service.onModuleInit();

    expect(bot.command).toHaveBeenCalledWith('id', expect.any(Function));
    expect(bot.command).toHaveBeenCalledWith('start', expect.any(Function));
    expect(bot.command).toHaveBeenCalledWith('analyze', expect.any(Function));
    expect(bot.hears).toHaveBeenCalledTimes(3);
    expect(bot.on).toHaveBeenCalledWith('message:text', expect.any(Function));
    expect(bot.catch).toHaveBeenCalledWith(expect.any(Function));
  });

  it('returns the sender Telegram ID without using ingestion', async () => {
    const { service, ingestion } = createService();
    const reply = jest.fn<(text: string) => Promise<unknown>>();
    reply.mockResolvedValue(undefined);

    await service.handleId(123456789, reply);

    expect(reply).toHaveBeenCalledWith('Ваш Telegram ID: 123456789');
    expect(ingestion.ingestLot).not.toHaveBeenCalled();
  });

  it('uses the analysis flow after the user selects the button', async () => {
    const { service, ingestion, analysis } = createService();
    analysis.analyzeLot.mockResolvedValue({
      analysis: {
        summary: 'Краткий анализ.',
        risks: [],
        missingInformation: [],
        recommendedChecks: [],
        disclaimer: 'Проверьте исходные документы.',
      },
      cached: false,
      model: 'test-model',
    });
    const reply = jest.fn<(text: string) => Promise<unknown>>();
    reply.mockResolvedValue(undefined);

    await service.selectAction('analyze', reply, 42);
    await service.handleTextMessage('463354', reply, 42);

    expect(ingestion.ingestLot).toHaveBeenCalledWith('463354');
    expect(analysis.analyzeLot).toHaveBeenCalledTimes(1);
    expect(reply).toHaveBeenCalledWith(
      expect.stringContaining('Облачный анализ'),
    );
  });

  it('validates input before calling the ingestion flow', async () => {
    const { service, ingestion } = createService();
    const reply = jest.fn<(text: string) => Promise<unknown>>();
    reply.mockResolvedValue(undefined);

    await service.handleLotNumber('460051-1', reply, 42);

    expect(ingestion.ingestLot).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith(expect.stringContaining('Некорректный'));
  });

  it('formats only verified lot facts and persistence counters', async () => {
    const { service, ingestion } = createService();
    const reply = jest.fn<(text: string) => Promise<unknown>>();
    reply.mockResolvedValue(undefined);

    await service.handleLotNumber(' 460051 ', reply, 42);

    expect(ingestion.ingestLot).toHaveBeenCalledWith('460051');
    const message = reply.mock.calls.at(-1)?.[0] ?? '';
    expect(message).toContain('Лот №460051');
    expect(message).toContain('Стартовая цена: 30229644.00 KZT');
    expect(message).toContain('найдено 2, обработано 2');
    expect(message).toContain('сохранены успешно');
    expect(message).not.toContain('secret-token');
    expect(message).not.toContain('https://');
  });

  it('clearly reports a partial document result', async () => {
    const { service, ingestion } = createService();
    ingestion.ingestLot.mockResolvedValue(
      createIngestionResult(
        createSaveResult({
          processedDocuments: 1,
          failedDocuments: 1,
          unsupportedDocuments: 1,
          isPartial: true,
        }),
      ),
    );
    const reply = jest.fn<(text: string) => Promise<unknown>>();
    reply.mockResolvedValue(undefined);

    await service.handleLotNumber('460051', reply, 42);

    expect(reply).toHaveBeenCalledWith(
      expect.stringContaining('⚠️ Лот сохранён частично'),
    );
    expect(reply).toHaveBeenCalledWith(
      expect.stringContaining('ошибок документов — 1'),
    );
  });

  it.each([
    [new LotNotFoundError('460051'), 'не найден'],
    [new LotAmbiguousError('460051', ['one', 'two']), 'несколько публикаций'],
    [new SaudaSearchParseError('private markup details'), 'структура страницы'],
    [new LotPageParseError('private markup details'), 'структура страницы'],
    [new LotMismatchError('460051', '460052'), 'структура страницы'],
    [new SaudaUnavailableError(new Error('TLS private details')), 'недоступен'],
    [
      new LotPageUnavailableError(new Error('timeout private details')),
      'недоступен',
    ],
    [new DatabaseError('sqlite private details'), 'Не удалось сохранить'],
  ])('maps domain failure to a safe response', async (error, expected) => {
    const { service, ingestion } = createService();
    ingestion.ingestLot.mockRejectedValue(error);
    const reply = jest.fn<(text: string) => Promise<unknown>>();
    reply.mockResolvedValue(undefined);

    await service.handleLotNumber('460051', reply, 42);

    const message = reply.mock.calls.at(-1)?.[0] ?? '';
    expect(message.toLowerCase()).toContain(expected.toLowerCase());
    expect(message).not.toContain(error.message);
    expect(message).not.toContain('private details');
  });

  it('contains Telegram API reply failures without exposing details', async () => {
    const { service } = createService();
    const reply = jest.fn<(text: string) => Promise<unknown>>();
    reply.mockRejectedValue(new Error('Telegram token leaked here'));

    await expect(
      service.handleLotNumber('460051', reply, 42),
    ).resolves.toBeUndefined();
    expect(Logger.prototype.error).toHaveBeenCalledWith(
      'Telegram reply failed',
    );
  });

  it('denies users outside the configured allowlist', async () => {
    const { service, ingestion } = createService();
    const reply = jest.fn<(text: string) => Promise<unknown>>();
    reply.mockResolvedValue(undefined);

    await service.handleLotNumber('460051', reply, 99);

    expect(ingestion.ingestLot).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith('У вас нет доступа к этому боту.');
  });

  it('rejects a concurrent request from the same user', async () => {
    const { service, ingestion } = createService();
    let finish: (() => void) | undefined;
    ingestion.ingestLot.mockImplementation(
      () =>
        new Promise<LotIngestionResult>((resolve) => {
          finish = () => resolve(createIngestionResult());
        }),
    );
    const firstReply = jest.fn<(text: string) => Promise<unknown>>();
    const secondReply = jest.fn<(text: string) => Promise<unknown>>();
    firstReply.mockResolvedValue(undefined);
    secondReply.mockResolvedValue(undefined);

    const first = service.handleLotNumber('460051', firstReply, 42);
    await Promise.resolve();
    await service.handleLotNumber('460052', secondReply, 42);
    finish?.();
    await first;

    expect(secondReply).toHaveBeenCalledWith(
      expect.stringContaining('ещё обрабатывается'),
    );
  });

  it('stops long polling during module shutdown', async () => {
    const { service, bot } = createService();
    let finishPolling: (() => void) | undefined;
    bot.start.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishPolling = resolve;
        }),
    );
    bot.stop.mockImplementation(async () => finishPolling?.());

    const polling = service.start();
    await Promise.resolve();
    await service.onModuleDestroy();
    await polling;

    expect(bot.start).toHaveBeenCalledTimes(1);
    expect(bot.stop).toHaveBeenCalledTimes(1);
  });
});
