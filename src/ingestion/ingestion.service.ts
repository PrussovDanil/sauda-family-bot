import { Injectable } from '@nestjs/common';
import {
  PersistenceService,
  type LotAnalysisSaveResult,
} from '../database/persistence.service';
import { DocumentRepository } from '../database/repositories/document.repository';
import { DocumentsService } from '../documents/documents.service';
import { DocumentDownloadError } from '../documents/errors/document-download.error';
import type { DownloadedDocument } from '../documents/models/downloaded-document';
import {
  PDF_EXTRACTION_CACHE_VERSION,
  type DocumentExtractionSnapshot,
  type ExtractedDocument,
} from '../documents/models/extracted-document';
import type { SaudaLot } from '../sauda/models/sauda-lot';
import { SaudaService } from '../sauda/sauda.service';

export interface LotIngestionResult {
  lot: SaudaLot;
  documents: ExtractedDocument[];
  result: LotAnalysisSaveResult;
}

@Injectable()
export class IngestionService {
  constructor(
    private readonly saudaService: SaudaService,
    private readonly documentsService: DocumentsService,
    private readonly documentRepository: DocumentRepository,
    private readonly persistenceService: PersistenceService,
  ) {}

  async ingestLot(lotNumber: string): Promise<LotIngestionResult> {
    const lot = await this.saudaService.getLot(lotNumber);
    const documents = await this.processDocuments(lot);
    const result = this.persistenceService.saveLotAnalysis(lot, documents);
    return { lot, documents, result };
  }

  private async processDocuments(lot: SaudaLot): Promise<ExtractedDocument[]> {
    const processed: ExtractedDocument[] = [];
    const snapshotsBySha256 = new Map<string, DocumentExtractionSnapshot>();

    for (const document of lot.documents) {
      let downloaded: DownloadedDocument;
      try {
        downloaded = await this.downloadWithRetry(document);
      } catch (error) {
        processed.push(
          this.documentsService.createFailureDocument(document, error),
        );
        continue;
      }

      const sameRunSnapshot = snapshotsBySha256.get(downloaded.sha256);
      if (sameRunSnapshot) {
        processed.push(
          this.documentsService.createDocumentFromSnapshot(
            document,
            downloaded,
            sameRunSnapshot,
            true,
          ),
        );
        continue;
      }

      const storedSnapshot =
        this.documentRepository.findReusableExtractionBySha256(
          downloaded.sha256,
          PDF_EXTRACTION_CACHE_VERSION,
        );
      let result: ExtractedDocument;
      if (storedSnapshot) {
        result = this.documentsService.createDocumentFromSnapshot(
          document,
          downloaded,
          storedSnapshot,
          false,
        );
      } else {
        try {
          result =
            await this.documentsService.extractDownloadedDocument(downloaded);
        } catch (error) {
          result = this.documentsService.createFailureDocument(
            document,
            error,
            downloaded,
          );
        }
      }

      snapshotsBySha256.set(downloaded.sha256, result);
      processed.push(result);
    }

    return processed;
  }

  private async downloadWithRetry(
    document: SaudaLot['documents'][number],
  ): Promise<DownloadedDocument> {
    try {
      return await this.documentsService.downloadDocument(document);
    } catch (error) {
      if (!(error instanceof DocumentDownloadError) || !error.retryable) {
        throw error;
      }
      return this.documentsService.downloadDocument(document);
    }
  }
}
