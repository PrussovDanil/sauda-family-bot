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
import { ChatGptAuthService } from './chatgpt-auth.service';

const PROMPT_VERSION = 'lot-risk-review-v1';
const SCHEMA_VERSION = 'cloud-analysis-v1';
const MAX_DOCUMENT_CHARS = 12_000;
const MAX_INPUT_CHARS = 40_000;
const API_KEY_TIMEOUT_MS = 45_000;
const CHATGPT_TIMEOUT_MS = 180_000;

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
    private readonly chatGptAuth: ChatGptAuthService,
  ) {}

  isEnabled(): boolean {
    return this.configService.get<string>('OPENAI_ANALYSIS_ENABLED') === 'true';
  }

  async analyzeLot(
    ingestion: LotIngestionResult,
  ): Promise<CloudAnalysisResult> {
    const authMode =
      this.configService.get<string>('OPENAI_AUTH_MODE') ?? 'api_key';
    const apiKey = this.configService.get<string>('OPENAI_API_KEY')?.trim();
    const model = this.configService.get<string>('OPENAI_MODEL')?.trim();
    if (
      !this.isEnabled() ||
      !model ||
      (authMode === 'api_key' && !apiKey) ||
      (authMode === 'chatgpt' && !this.chatGptAuth.isConfigured())
    ) {
      throw new CloudAnalysisError('Cloud analysis is not configured');
    }

    const input = this.buildInput(ingestion);
    const cacheKey = this.createCacheKey(input, model);
    let cachedJson: string | undefined;
    try {
      cachedJson = this.repository.find(cacheKey);
    } catch (error) {
      throw new CloudAnalysisError('Cloud analysis cache lookup failed', true, {
        cause: error,
      });
    }
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
      const credential =
        authMode === 'chatgpt'
          ? await this.chatGptAuth.getAccessToken()
          : apiKey!;
      response = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${credential}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model,
          store: false,
          ...(authMode === 'chatgpt' ? { stream: true } : {}),
          instructions:
            'Analyze only the supplied verified auction facts and extracted document text. Do not invent facts or perform financial calculations. Clearly identify uncertainty. Respond in Russian.',
          input:
            authMode === 'chatgpt' ? [{ role: 'user', content: input }] : input,
          text: {
            format: {
              type: 'json_schema',
              name: 'sauda_lot_analysis',
              strict: true,
              schema: cloudAnalysisJsonSchema,
            },
          },
        }),
        signal: AbortSignal.timeout(
          authMode === 'chatgpt' ? CHATGPT_TIMEOUT_MS : API_KEY_TIMEOUT_MS,
        ),
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

    const outputText =
      authMode === 'chatgpt'
        ? await this.extractStreamOutputText(response)
        : await this.extractJsonOutputText(response);
    let analysis: CloudAnalysis;
    try {
      analysis = cloudAnalysisSchema.parse(JSON.parse(outputText));
    } catch (error) {
      throw new CloudAnalysisError(
        'Cloud analysis returned invalid data',
        false,
        {
          cause: error,
        },
      );
    }

    try {
      this.repository.save(
        cacheKey,
        model,
        PROMPT_VERSION,
        JSON.stringify(analysis),
      );
    } catch (error) {
      throw new CloudAnalysisError('Cloud analysis cache save failed', true, {
        cause: error,
      });
    }
    return { analysis, cached: false, model };
  }

  private async extractJsonOutputText(response: Response): Promise<string> {
    try {
      return this.extractOutputText(await response.json());
    } catch (error) {
      if (error instanceof CloudAnalysisError) throw error;
      throw new CloudAnalysisError(
        'Cloud analysis returned invalid data',
        false,
        {
          cause: error,
        },
      );
    }
  }

  private async extractStreamOutputText(response: Response): Promise<string> {
    if (!response.body) {
      throw new CloudAnalysisError(
        'Cloud analysis response is incomplete',
        true,
      );
    }
    const reader = response.body
      .pipeThrough(new TextDecoderStream())
      .getReader();
    let buffer = '';
    let text = '';
    let completed = false;
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += chunk.value;
        const events = buffer.split(/\r?\n\r?\n/);
        buffer = events.pop() ?? '';
        for (const eventBlock of events) {
          for (const line of eventBlock.split(/\r?\n/)) {
            if (!line.startsWith('data:')) continue;
            const data = line.slice(5).trim();
            if (!data || data === '[DONE]') continue;
            const event = JSON.parse(data) as {
              type?: string;
              delta?: unknown;
            };
            if (
              event.type === 'response.output_text.delta' &&
              typeof event.delta === 'string'
            ) {
              text += event.delta;
            } else if (event.type === 'response.completed') {
              completed = true;
            } else if (
              event.type === 'response.failed' ||
              event.type === 'response.incomplete' ||
              event.type === 'error'
            ) {
              throw new CloudAnalysisError(
                'Cloud analysis service rejected the request',
                true,
              );
            }
          }
        }
      }
    } catch (error) {
      if (error instanceof CloudAnalysisError) throw error;
      throw new CloudAnalysisError(
        'Cloud analysis returned invalid data',
        true,
        {
          cause: error,
        },
      );
    }
    if (!completed || !text) {
      throw new CloudAnalysisError(
        'Cloud analysis response is incomplete',
        true,
      );
    }
    return text;
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
        `Документ ${index + 1}: ${document.title}\n${text.slice(0, MAX_DOCUMENT_CHARS)}`,
      );
    }

    return sections.join('\n\n').slice(0, MAX_INPUT_CHARS);
  }

  private createCacheKey(input: string, model: string): string {
    const identity = {
      promptVersion: PROMPT_VERSION,
      schemaVersion: SCHEMA_VERSION,
      model,
      input,
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
