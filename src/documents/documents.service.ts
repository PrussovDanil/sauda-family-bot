import { Injectable } from '@nestjs/common';
import type { SaudaLot } from '../sauda/models/sauda-lot';
import { DocumentDownloaderService } from './downloader/document-downloader.service';
import { UnsupportedDocumentTypeError } from './errors/unsupported-document-type.error';
import { PdfTextExtractorService } from './extractors/pdf-text-extractor.service';
import type { ExtractedDocument } from './models/extracted-document';

@Injectable()
export class DocumentsService {
  constructor(
    private readonly downloader: DocumentDownloaderService,
    private readonly extractor: PdfTextExtractorService,
  ) {}

  async processLotDocuments(lot: SaudaLot): Promise<ExtractedDocument[]> {
    const extracted: ExtractedDocument[] = [];

    for (const document of lot.documents) {
      try {
        const downloaded = await this.downloader.download(
          document.title,
          document.url,
        );
        extracted.push(await this.extractor.extract(downloaded));
      } catch (error) {
        const unsupportedDetails =
          error instanceof UnsupportedDocumentTypeError
            ? {
                contentType: error.contentType,
                sizeBytes: error.sizeBytes,
                status: 'unsupported' as const,
              }
            : { status: 'failed' as const };

        extracted.push({
          title: document.title,
          ...this.getSourceFileId(document.url),
          ...unsupportedDetails,
          text: '',
          preview: '',
          quality: 'unknown',
          qualityScore: 0,
          qualityReasons: ['text-extraction-did-not-run'],
          requiresCloudRecognition: true,
          error: this.getSafeErrorMessage(error),
        });
      }
    }

    return extracted;
  }

  private getSourceFileId(sourceUrl: string): { sourceFileId?: string } {
    try {
      const sourceFileId = new URL(sourceUrl).searchParams.get('FileId');
      return sourceFileId ? { sourceFileId } : {};
    } catch {
      return {};
    }
  }

  private getSafeErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'Document processing failed';
  }
}
