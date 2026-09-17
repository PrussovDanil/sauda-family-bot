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
    const originalsBySha256 = new Map<string, ExtractedDocument>();

    for (const document of lot.documents) {
      try {
        const downloaded = await this.downloader.download(
          document.title,
          document.url,
        );
        const original = originalsBySha256.get(downloaded.sha256);
        if (original) {
          extracted.push({
            title: document.title,
            ...this.getSourceFileId(document.url),
            contentType: downloaded.contentType,
            sizeBytes: downloaded.sizeBytes,
            status: 'duplicate',
            sha256: downloaded.sha256,
            duplicateOfSha256: downloaded.sha256,
            isDuplicate: true,
            text: '',
            preview: '',
            quality: original.quality,
            qualityScore: original.qualityScore,
            qualityReasons: original.qualityReasons,
            requiresCloudRecognition: false,
          });
          continue;
        }

        const result = await this.extractor.extract(downloaded);
        originalsBySha256.set(downloaded.sha256, result);
        extracted.push(result);
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
          isDuplicate: false,
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
