import { Injectable } from '@nestjs/common';
import { PDFParse } from 'pdf-parse';
import type { DownloadedDocument } from '../models/downloaded-document';
import type { ExtractedDocument } from '../models/extracted-document';
import { DocumentTextQualityService } from '../quality/document-text-quality.service';

const PREVIEW_LENGTH = 1000;

interface PdfParser {
  destroy(): Promise<void>;
  getText(): Promise<{ text: string; total: number }>;
}

export function normalizePdfText(value: string): string {
  const lines = value.split(/\r?\n/).map((line) =>
    line.replace(/[\s\u00a0]+/g, ' ').trim(),
  );
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
    const parser = this.createParser(document.buffer);

    try {
      const result = await parser.getText();
      const text = normalizePdfText(result.text);
      const sourceFileId = this.getSourceFileId(document.sourceUrl);
      const quality = this.qualityService.evaluate(text, result.total);

      return {
        title: document.title,
        ...(sourceFileId ? { sourceFileId } : {}),
        contentType: document.contentType,
        sizeBytes: document.sizeBytes,
        pageCount: result.total,
        text,
        preview: text.slice(0, PREVIEW_LENGTH),
        status: text ? 'success' : 'empty',
        quality: quality.quality,
        qualityScore: quality.score,
        qualityReasons: quality.reasons,
        requiresCloudRecognition: quality.requiresCloudRecognition,
      };
    } finally {
      await parser.destroy();
    }
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
}
