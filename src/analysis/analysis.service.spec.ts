import { jest } from '@jest/globals';
import { ConfigService } from '@nestjs/config';
import type { LotIngestionResult } from '../ingestion/ingestion.service';
import { AnalysisRepository } from './analysis.repository';
import { AnalysisService } from './analysis.service';
import { CloudAnalysisError } from './cloud-analysis.error';

const analysis = {
  summary: 'Документы требуют дополнительной проверки.',
  risks: [
    {
      severity: 'medium' as const,
      title: 'Неполные сведения',
      evidence: 'В тексте отсутствует часть реквизитов.',
    },
  ],
  missingInformation: ['Срок обременения'],
  recommendedChecks: ['Сверить оригинал документа'],
  disclaimer: 'Это вспомогательный анализ, а не юридическое заключение.',
};

function createIngestion(): LotIngestionResult {
  return {
    lot: {
      lotNumber: '463354',
      publicationId: '337517033658000000',
      url: 'https://sauda.e-qazyna.kz/ru/list/private-token',
      title: 'Земельный участок',
      status: 'Прием заявок',
      startingPrice: {
        amount: '38610.00',
        currency: 'KZT',
        sourceRaw: '₸ 38 610,00',
      },
      auctionStartsAtRaw: '02.10.2026 10:00',
      documents: [],
      parsedAt: '2026-10-01T00:00:00.000Z',
    },
    documents: [
      {
        title: 'Решение.pdf',
        sourceFileId: 'private-file-id',
        text: 'Проверенный извлечённый текст документа.',
        preview: '',
        status: 'success',
        sha256: 'a'.repeat(64),
        isDuplicate: false,
        quality: 'good',
        qualityScore: 90,
        qualityReasons: [],
        requiresCloudRecognition: false,
      },
    ],
    result: {
      lotId: 1,
      documentsFound: 1,
      processedDocuments: 1,
      uniqueDocuments: 1,
      newDocuments: 1,
      reusedDocuments: 0,
      duplicateDocuments: 0,
      unsupportedDocuments: 0,
      failedDocuments: 0,
      unchangedDocuments: 0,
      updatedDocuments: 0,
      isPartial: false,
    },
  };
}

describe('AnalysisService', () => {
  function createService(overrides: Record<string, string> = {}) {
    const values: Record<string, string> = {
      OPENAI_ANALYSIS_ENABLED: 'true',
      OPENAI_API_KEY: 'test-api-key',
      OPENAI_MODEL: 'test-model',
      ...overrides,
    };
    const config = {
      get: jest.fn((key: string) => values[key]),
    };
    const repository = {
      find: jest.fn<(key: string) => string | undefined>(),
      save: jest.fn(),
    };
    return {
      service: new AnalysisService(
        config as unknown as ConfigService,
        repository as unknown as AnalysisRepository,
      ),
      repository,
    };
  }

  afterEach(() => jest.restoreAllMocks());

  it('stays disabled without explicit opt-in', async () => {
    const { service } = createService({ OPENAI_ANALYSIS_ENABLED: 'false' });

    await expect(service.analyzeLot(createIngestion())).rejects.toBeInstanceOf(
      CloudAnalysisError,
    );
  });

  it('uses Responses structured output without remote storage', async () => {
    const { service, repository } = createService();
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          output: [
            {
              type: 'message',
              content: [
                { type: 'output_text', text: JSON.stringify(analysis) },
              ],
            },
          ],
        }),
        { status: 200 },
      ),
    );

    await expect(service.analyzeLot(createIngestion())).resolves.toMatchObject({
      analysis,
      cached: false,
      model: 'test-model',
    });

    const request = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as {
      store: boolean;
      input: string;
      text: { format: { type: string; strict: boolean } };
    };
    expect(request.store).toBe(false);
    expect(request.text.format).toMatchObject({
      type: 'json_schema',
      strict: true,
    });
    expect(request.input).not.toContain('private-token');
    expect(request.input).not.toContain('private-file-id');
    expect(repository.save).toHaveBeenCalledTimes(1);
  });

  it('returns a validated cached result without calling OpenAI', async () => {
    const { service, repository } = createService();
    repository.find.mockReturnValue(JSON.stringify(analysis));
    const fetchMock = jest.spyOn(global, 'fetch');

    await expect(service.analyzeLot(createIngestion())).resolves.toMatchObject({
      analysis,
      cached: true,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects malformed structured output', async () => {
    const { service } = createService();
    jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          output: [
            {
              content: [
                { type: 'output_text', text: JSON.stringify({ summary: '' }) },
              ],
            },
          ],
        }),
        { status: 200 },
      ),
    );

    await expect(service.analyzeLot(createIngestion())).rejects.toMatchObject({
      name: CloudAnalysisError.name,
      retryable: false,
    });
  });

  it('marks rate limits as retryable without exposing response data', async () => {
    const { service } = createService();
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        new Response('private provider error', { status: 429 }),
      );

    await expect(service.analyzeLot(createIngestion())).rejects.toMatchObject({
      name: CloudAnalysisError.name,
      retryable: true,
      message: 'Cloud analysis service rejected the request',
    });
  });
});
