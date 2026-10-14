import { jest } from '@jest/globals';
import { ConfigService } from '@nestjs/config';
import type { LotIngestionResult } from '../ingestion/ingestion.service';
import { AnalysisRepository } from './analysis.repository';
import { AnalysisService } from './analysis.service';
import { CloudAnalysisError } from './cloud-analysis.error';
import { ChatGptAuthService } from './chatgpt-auth.service';

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
      description: 'Описание участка.',
      seller: 'Проверенный продавец',
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
      save: jest.fn<
        (
          cacheKey: string,
          model: string,
          promptVersion: string,
          resultJson: string,
        ) => void
      >(),
    };
    const chatGptAuth = {
      isConfigured: jest.fn(() => values.OPENAI_AUTH_MODE === 'chatgpt'),
      getAccessToken: jest
        .fn<() => Promise<string>>()
        .mockResolvedValue('oauth-token'),
    };
    return {
      service: new AnalysisService(
        config as unknown as ConfigService,
        repository as unknown as AnalysisRepository,
        chatGptAuth as unknown as ChatGptAuthService,
      ),
      repository,
      chatGptAuth,
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

  it('uses OAuth token and requires a completed response stream', async () => {
    const { service, chatGptAuth } = createService({
      OPENAI_AUTH_MODE: 'chatgpt',
      OPENAI_API_KEY: '',
    });
    const events = [
      { type: 'response.output_text.delta', delta: JSON.stringify(analysis) },
      { type: 'response.completed' },
    ];
    const body = events
      .map((event) => `data: ${JSON.stringify(event)}\n\n`)
      .join('');
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(body, { status: 200 }));

    await expect(service.analyzeLot(createIngestion())).resolves.toMatchObject({
      analysis,
      cached: false,
    });

    expect(chatGptAuth.getAccessToken).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({
      authorization: 'Bearer oauth-token',
    });
    const request = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as {
      store: boolean;
      stream: boolean;
      input: Array<{ role: string; content: string }>;
    };
    expect(request).toMatchObject({ store: false, stream: true });
    expect(request.input).toEqual([expect.objectContaining({ role: 'user' })]);
    expect(request.input[0].content).not.toContain('private-token');
  });

  it('rejects an interrupted OAuth response stream', async () => {
    const { service } = createService({
      OPENAI_AUTH_MODE: 'chatgpt',
      OPENAI_API_KEY: '',
    });
    jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        `data: ${JSON.stringify({
          type: 'response.output_text.delta',
          delta: JSON.stringify(analysis),
        })}\n\n`,
        { status: 200 },
      ),
    );

    await expect(service.analyzeLot(createIngestion())).rejects.toMatchObject({
      name: CloudAnalysisError.name,
      retryable: true,
      message: 'Cloud analysis response is incomplete',
    });
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

  it('reuses a saved result when the same lot is analyzed again', async () => {
    const { service, repository } = createService();
    let cachedResult: string | undefined;
    repository.find.mockImplementation(() => cachedResult);
    repository.save.mockImplementation(
      (_key, _model, _promptVersion, resultJson: string) => {
        cachedResult = resultJson;
      },
    );
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          output: [
            {
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
      cached: false,
    });
    await expect(service.analyzeLot(createIngestion())).resolves.toMatchObject({
      cached: true,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(repository.save).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      'description',
      (ingestion: LotIngestionResult) => {
        ingestion.lot.description = 'Изменённое описание';
      },
    ],
    [
      'seller',
      (ingestion: LotIngestionResult) => {
        ingestion.lot.seller = 'Другой продавец';
      },
    ],
    [
      'document title',
      (ingestion: LotIngestionResult) => {
        ingestion.documents[0].title = 'Другой документ.pdf';
      },
    ],
    [
      'document text',
      (ingestion: LotIngestionResult) => {
        ingestion.documents[0].text = 'Изменённый текст документа.';
      },
    ],
  ])('changes the cache key when %s changes', async (_field, mutate) => {
    const { service, repository } = createService();
    repository.find.mockReturnValue(JSON.stringify(analysis));

    await service.analyzeLot(createIngestion());
    const changedIngestion = createIngestion();
    mutate(changedIngestion);
    await service.analyzeLot(changedIngestion);

    expect(repository.find).toHaveBeenCalledTimes(2);
    expect(repository.find.mock.calls[0][0]).not.toBe(
      repository.find.mock.calls[1][0],
    );
  });

  it('changes the cache key when the configured model changes', async () => {
    const first = createService({ OPENAI_MODEL: 'first-model' });
    const second = createService({ OPENAI_MODEL: 'second-model' });
    first.repository.find.mockReturnValue(JSON.stringify(analysis));
    second.repository.find.mockReturnValue(JSON.stringify(analysis));

    await first.service.analyzeLot(createIngestion());
    await second.service.analyzeLot(createIngestion());

    expect(first.repository.find.mock.calls[0][0]).not.toBe(
      second.repository.find.mock.calls[0][0],
    );
  });

  it('replaces an invalid cached result with a fresh response', async () => {
    const { service, repository } = createService();
    repository.find.mockReturnValue('{"summary":"incomplete"}');
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          output: [
            {
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
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(repository.save).toHaveBeenCalledTimes(1);
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

  it('normalizes a malformed successful response body', async () => {
    const { service } = createService();
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response('not-json', { status: 200 }));

    await expect(service.analyzeLot(createIngestion())).rejects.toMatchObject({
      name: CloudAnalysisError.name,
      retryable: false,
      message: 'Cloud analysis returned invalid data',
    });
  });

  it('normalizes cache lookup failures as retryable errors', async () => {
    const { service, repository } = createService();
    repository.find.mockImplementation(() => {
      throw new Error('private database details');
    });

    await expect(service.analyzeLot(createIngestion())).rejects.toMatchObject({
      name: CloudAnalysisError.name,
      retryable: true,
      message: 'Cloud analysis cache lookup failed',
    });
  });

  it('normalizes cache save failures after a valid response', async () => {
    const { service, repository } = createService();
    repository.save.mockImplementation(() => {
      throw new Error('private database details');
    });
    jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          output: [
            {
              content: [
                { type: 'output_text', text: JSON.stringify(analysis) },
              ],
            },
          ],
        }),
        { status: 200 },
      ),
    );

    await expect(service.analyzeLot(createIngestion())).rejects.toMatchObject({
      name: CloudAnalysisError.name,
      retryable: true,
      message: 'Cloud analysis cache save failed',
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
