import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import type { LotIngestionResult } from '../ingestion/ingestion.service';
import {
  cloudAnalysisJsonSchema,
  cloudAnalysisSchema,
  type CloudAnalysis,
} from './analysis.schema';
import { AnalysisRepository } from './analysis.repository';
import { CloudAnalysisError } from './cloud-analysis.error';

const PROMPT_VERSION = 'lot-risk-review-v1';
const MAX_DOCUMENT_CHARS = 12_000;
const MAX_INPUT_CHARS = 40_000;

export interface CloudAnalysisResult {
  analysis: CloudAnalysis;
  cached: boolean;
  model: string;
}

@Injectable()
export class AnalysisService {
  constructor(
    private readonly configService: ConfigService,
    private readonly repository: AnalysisRepository,
  ) {}

  isEnabled(): boolean {
    return this.configService.get<string>('OPENAI_ANALYSIS_ENABLED') === 'true';
  }

  async analyzeLot(
    ingestion: LotIngestionResult,
  ): Promise<CloudAnalysisResult> {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY')?.trim();
    const model = this.configService.get<string>('OPENAI_MODEL')?.trim();
    if (!this.isEnabled() || !apiKey || !model) {
      throw new CloudAnalysisError('Cloud analysis is not configured');
    }

    const input = this.buildInput(ingestion);
    const cacheKey = this.createCacheKey(ingestion, model);
    const cachedJson = this.repository.find(cacheKey);
    if (cachedJson) {
      try {
        return {
          analysis: cloudAnalysisSchema.parse(JSON.parse(cachedJson)),
          cached: true,
          model,
        };
      } catch {
        // Ignore an incompatible cache entry and replace it with a fresh result.
      }
    }

    let response: Response;
    try {
      response = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model,
          store: false,
          instructions:
            'Analyze only the supplied verified auction facts and extracted document text. Do not invent facts or perform financial calculations. Clearly identify uncertainty. Respond in Russian.',
          input,
          text: {
            format: {
              type: 'json_schema',
              name: 'sauda_lot_analysis',
              strict: true,
              schema: cloudAnalysisJsonSchema,
            },
          },
        }),
        signal: AbortSignal.timeout(45_000),
      });
    } catch (error) {
      throw new CloudAnalysisError('Cloud analysis request failed', true, {
        cause: error,
      });
    }

    if (!response.ok) {
      throw new CloudAnalysisError(
        'Cloud analysis service rejected the request',
        response.status === 429 || response.status >= 500,
      );
    }

    const payload: unknown = await response.json();
    const outputText = this.extractOutputText(payload);
    let analysis: CloudAnalysis;
    try {
      analysis = cloudAnalysisSchema.parse(JSON.parse(outputText));
    } catch (error) {
      throw new CloudAnalysisError('Cloud analysis returned invalid data', false, {
        cause: error,
      });
    }

    this.repository.save(
      cacheKey,
      model,
      PROMPT_VERSION,
      JSON.stringify(analysis),
    );
    return { analysis, cached: false, model };
  }

  private buildInput(ingestion: LotIngestionResult): string {
    const { lot, documents } = ingestion;
    const sections = [
      `Лот: ${lot.lotNumber}`,
      `Название: ${lot.title}`,
      `Статус: ${lot.status ?? 'не указан'}`,
      `Стартовая цена: ${lot.startingPrice?.amount ?? 'не указана'} ${lot.startingPrice?.currency ?? ''}`.trim(),
      `Начало торгов: ${lot.auctionStartsAtRaw ?? 'не указано'}`,
      `Описание: ${lot.description ?? 'не указано'}`,
      `Продавец: ${lot.seller ?? 'не указан'}`,
    ];

    for (const [index, document] of documents.entries()) {
      const text = document.text?.trim();
      if (!text) {
        continue;
      }
      sections.push(
        `Документ ${index + 1}: ${document.sourceTitle}\n${text.slice(0, MAX_DOCUMENT_CHARS)}`,
      );
    }

    return sections.join('\n\n').slice(0, MAX_INPUT_CHARS);
  }

  private createCacheKey(
    ingestion: LotIngestionResult,
    model: string,
  ): string {
    const identity = {
      promptVersion: PROMPT_VERSION,
      model,
      publicationId: ingestion.lot.publicationId,
      lotParsedAt: ingestion.lot.parsedAt,
      documents: ingestion.documents.map((document) => ({
        sha256: document.sha256,
        status: document.status,
      })),
    };
    return createHash('sha256').update(JSON.stringify(identity)).digest('hex');
  }

  private extractOutputText(payload: unknown): string {
    if (!payload || typeof payload !== 'object' || !('output' in payload)) {
      throw new CloudAnalysisError('Cloud analysis response is incomplete');
    }
    const output = (payload as { output: unknown }).output;
    if (!Array.isArray(output)) {
      throw new CloudAnalysisError('Cloud analysis response is incomplete');
    }
    for (const item of output) {
      if (!item || typeof item !== 'object' || !('content' in item)) {
        continue;
      }
      const content = (item as { content: unknown }).content;
      if (!Array.isArray(content)) {
        continue;
      }
      for (const part of content) {
        if (
          part &&
          typeof part === 'object' &&
          'type' in part &&
          part.type === 'output_text' &&
          'text' in part &&
          typeof part.text === 'string'
        ) {
          return part.text;
        }
      }
    }
    throw new CloudAnalysisError('Cloud analysis response has no output text');
  }
}
