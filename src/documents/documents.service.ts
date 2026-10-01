import { Injectable } from '@nestjs/common';
import type { SaudaLot } from '../sauda/models/sauda-lot';
import { DocumentDownloaderService } from './downloader/document-downloader.service';
import { DocumentDownloadError } from './errors/document-download.error';
import { DocumentTooLargeError } from './errors/document-too-large.error';
import { PdfExtractionError } from './errors/pdf-extraction.error';
import { UnsafeDocumentUrlError } from './errors/unsafe-document-url.error';
import { UnsupportedDocumentTypeError } from './errors/unsupported-document-type.error';
import { PdfTextExtractorService } from './extractors/pdf-text-extractor.service';
import type { DownloadedDocument } from './models/downloaded-document';
import type {
  DocumentExtractionSnapshot,
  DocumentFailureKind,
  ExtractedDocument,
} from './models/extracted-document';
import { PDF_EXTRACTION_CACHE_VERSION } from './models/extracted-document';

type LotDocument = SaudaLot['documents'][number];

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
      let downloaded: DownloadedDocument | undefined;

      try {
        downloaded = await this.downloadDocument(document);
        const original = originalsBySha256.get(downloaded.sha256);
        if (original) {
          extracted.push(
            this.createDocumentFromSnapshot(
              document,
              downloaded,
              original,
              true,
            ),
          );
          continue;
        }

        const result = await this.extractDownloadedDocument(downloaded);
        originalsBySha256.set(downloaded.sha256, result);
        extracted.push(result);
      } catch (error) {
        const result = this.createFailureDocument(document, error, downloaded);

        if (downloaded) {
          originalsBySha256.set(downloaded.sha256, result);
        }
        extracted.push(result);
      }
    }

    return extracted;
  }

  downloadDocument(document: LotDocument): Promise<DownloadedDocument> {
    return this.downloader.download(document.title, document.url);
  }

  async extractDownloadedDocument(
    downloaded: DownloadedDocument,
  ): Promise<ExtractedDocument> {
    const extracted = await this.extractor.extract(downloaded);
    return {
      ...extracted,
      extractionCacheVersion: PDF_EXTRACTION_CACHE_VERSION,
    };
  }

  createDocumentFromSnapshot(
    document: LotDocument,
    downloaded: DownloadedDocument,
    snapshot: DocumentExtractionSnapshot,
    isDuplicate: boolean,
  ): ExtractedDocument {
    return {
      title: document.title,
      ...this.getSourceFileId(document.url),
      contentType: downloaded.contentType,
      sizeBytes: downloaded.sizeBytes,
      pageCount: snapshot.pageCount,
      text: snapshot.text,
      preview: snapshot.preview,
      status: snapshot.status,
      sha256: downloaded.sha256,
      ...(isDuplicate ? { duplicateOfSha256: downloaded.sha256 } : {}),
      isDuplicate,
      quality: snapshot.quality,
      qualityScore: snapshot.qualityScore,
      qualityReasons: [...snapshot.qualityReasons],
      requiresCloudRecognition: snapshot.requiresCloudRecognition,
      ...(snapshot.failureKind ? { failureKind: snapshot.failureKind } : {}),
      ...(snapshot.retryable !== undefined
        ? { retryable: snapshot.retryable }
        : {}),
      ...(snapshot.error ? { error: snapshot.error } : {}),
      ...(snapshot.extractionCacheVersion
        ? { extractionCacheVersion: snapshot.extractionCacheVersion }
        : {}),
    };
  }

  createFailureDocument(
    document: LotDocument,
    error: unknown,
    downloaded?: DownloadedDocument,
  ): ExtractedDocument {
    const unsupportedDetails =
      error instanceof UnsupportedDocumentTypeError
        ? {
            contentType: error.contentType,
            sizeBytes: error.sizeBytes,
            status: 'unsupported' as const,
          }
        : { status: 'failed' as const };
    const failureDetails = this.getFailureDetails(error);
    const isDeterministicPdfFailure =
      failureDetails.retryable === false &&
      (failureDetails.failureKind === 'malformed' ||
        failureDetails.failureKind === 'encrypted');

    return {
      title: document.title,
      ...this.getSourceFileId(document.url),
      ...unsupportedDetails,
      ...(downloaded
        ? {
            contentType: downloaded.contentType,
            sizeBytes: downloaded.sizeBytes,
            sha256: downloaded.sha256,
          }
        : {}),
      text: '',
      preview: '',
      isDuplicate: false,
      quality: 'unknown',
      qualityScore: 0,
      qualityReasons: ['text-extraction-did-not-run'],
      requiresCloudRecognition: true,
      ...failureDetails,
      error: this.getSafeErrorMessage(error),
      ...(isDeterministicPdfFailure
        ? { extractionCacheVersion: PDF_EXTRACTION_CACHE_VERSION }
        : {}),
    };
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
    if (
      error instanceof DocumentDownloadError ||
      error instanceof DocumentTooLargeError ||
      error instanceof PdfExtractionError ||
      error instanceof UnsafeDocumentUrlError ||
      error instanceof UnsupportedDocumentTypeError
    ) {
      return error.message;
    }

    return 'Document processing failed';
  }

  private getFailureDetails(error: unknown): {
    failureKind?: DocumentFailureKind;
    retryable?: boolean;
  } {
    if (error instanceof DocumentDownloadError) {
      return {
        failureKind: error.failureKind,
        retryable: error.retryable,
      };
    }

    if (
      error instanceof PdfExtractionError ||
      error instanceof UnsupportedDocumentTypeError
    ) {
      return { failureKind: error.failureKind, retryable: false };
    }

    if (
      error instanceof DocumentTooLargeError ||
      error instanceof UnsafeDocumentUrlError
    ) {
      return { failureKind: 'content', retryable: false };
    }

    return {};
  }
}
