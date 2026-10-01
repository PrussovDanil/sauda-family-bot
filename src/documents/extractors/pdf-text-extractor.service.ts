import { Injectable } from '@nestjs/common';
import { PDFParse } from 'pdf-parse';
import {
  PdfExtractionError,
  type PdfExtractionFailureKind,
} from '../errors/pdf-extraction.error';
import type { DownloadedDocument } from '../models/downloaded-document';
import type { ExtractedDocument } from '../models/extracted-document';
import { DocumentTextQualityService } from '../quality/document-text-quality.service';

const PREVIEW_LENGTH = 1000;

interface PdfParser {
  destroy(): Promise<void>;
  getText(): Promise<{ text: string; total: number }>;
}

function classifyPdfExtractionFailure(
  error: unknown,
): PdfExtractionFailureKind {
  const record =
    typeof error === 'object' && error !== null
      ? (error as Record<string, unknown>)
      : undefined;
  const name = typeof record?.name === 'string' ? record.name : '';
  const message = typeof record?.message === 'string' ? record.message : '';
  const details = `${name} ${message}`.toLowerCase();

  if (/password|encrypted|encryption/.test(details)) {
    return 'encrypted';
  }

  if (
    /invalidpdf|missingpdf|formaterror|invalid pdf|pdf structure|xref|cross-reference|truncated|unexpected eof|end of file/.test(
      details,
    )
  ) {
    return 'malformed';
  }

  return 'extraction';
}

export function normalizePdfText(value: string): string {
  const lines = value
    .split(/\r?\n/)
    .map((line) => line.replace(/[\s\u00a0]+/g, ' ').trim());
  const normalized: string[] = [];

  for (const line of lines) {
    if (line || normalized.at(-1) !== '') {
      normalized.push(line);
    }
  }

  return normalized.join('\n').trim();
}

@Injectable()
export class PdfTextExtractorService {
  constructor(private readonly qualityService: DocumentTextQualityService) {}

  async extract(document: DownloadedDocument): Promise<ExtractedDocument> {
    let parser: PdfParser;

    try {
      parser = this.createParser(document.buffer);
    } catch (error) {
      throw this.toExtractionError(error);
    }

    let extracted: ExtractedDocument | undefined;
    let extractionError: PdfExtractionError | undefined;

    try {
      const result = await parser.getText();
      const text = normalizePdfText(result.text);
      const sourceFileId = this.getSourceFileId(document.sourceUrl);
      const quality = this.qualityService.evaluate(text, result.total);

      extracted = {
        title: document.title,
        ...(sourceFileId ? { sourceFileId } : {}),
        contentType: document.contentType,
        sizeBytes: document.sizeBytes,
        sha256: document.sha256,
        isDuplicate: false,
        pageCount: result.total,
        text,
        preview: text.slice(0, PREVIEW_LENGTH),
        status: text ? 'success' : 'empty',
        quality: quality.quality,
        qualityScore: quality.score,
        qualityReasons: quality.reasons,
        requiresCloudRecognition: quality.requiresCloudRecognition,
      };
    } catch (error) {
      extractionError = this.toExtractionError(error);
    }

    try {
      await parser.destroy();
    } catch (error) {
      if (!extractionError) {
        extractionError = new PdfExtractionError('extraction', error);
      }
    }

    if (extractionError) {
      throw extractionError;
    }
    if (!extracted) {
      throw new PdfExtractionError('extraction');
    }

    return extracted;
  }

  private getSourceFileId(sourceUrl: string): string | undefined {
    try {
      return new URL(sourceUrl).searchParams.get('FileId') ?? undefined;
    } catch {
      return undefined;
    }
  }

  protected createParser(buffer: Buffer): PdfParser {
    return new PDFParse({ data: buffer });
  }

  private toExtractionError(error: unknown): PdfExtractionError {
    return error instanceof PdfExtractionError
      ? error
      : new PdfExtractionError(classifyPdfExtractionFailure(error), error);
  }
}
