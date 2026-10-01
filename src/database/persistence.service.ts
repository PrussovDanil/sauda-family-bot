import { Injectable } from '@nestjs/common';
import type { ExtractedDocument } from '../documents/models/extracted-document';
import type { SaudaLot } from '../sauda/models/sauda-lot';
import { DatabaseError } from './errors/database.error';
import { DatabaseService } from './database.service';
import {
  DocumentRepository,
  type DocumentWriteState,
} from './repositories/document.repository';
import { LotRepository } from './repositories/lot.repository';

export interface LotAnalysisSaveResult {
  lotId: number;
  documentsFound: number;
  processedDocuments: number;
  uniqueDocuments: number;
  newDocuments: number;
  reusedDocuments: number;
  duplicateDocuments: number;
  unsupportedDocuments: number;
  failedDocuments: number;
  unchangedDocuments: number;
  updatedDocuments: number;
  isPartial: boolean;
}

interface ManifestDocument {
  sourceFileId: string;
  title: string;
  position: number;
}

interface StoredDocumentState {
  id: number;
  state: DocumentWriteState;
}

@Injectable()
export class PersistenceService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly lotRepository: LotRepository,
    private readonly documentRepository: DocumentRepository,
  ) {}

  saveLotAnalysis(
    lot: SaudaLot,
    documents: ExtractedDocument[],
  ): LotAnalysisSaveResult {
    return this.databaseService.transaction(() => {
      const storedLot = this.lotRepository.upsertLot(lot);
      const manifest = this.getManifest(lot);
      const resultsBySourceFileId = this.indexResults(documents, manifest);
      const sourceDocuments = this.selectSourceDocuments(documents);
      const storedDocuments = new Map<string, StoredDocumentState>();

      let newDocuments = 0;
      let updatedDocuments = 0;
      let unchangedDocuments = 0;
      for (const [sha256, document] of sourceDocuments) {
        const result = this.documentRepository.upsertDocument(document);
        storedDocuments.set(sha256, {
          id: result.document.id,
          state: result.state,
        });
        if (result.state === 'new') {
          newDocuments += 1;
        } else if (result.state === 'updated') {
          updatedDocuments += 1;
        } else {
          unchangedDocuments += 1;
        }
      }

      let reusedDocuments = 0;
      for (const manifestDocument of manifest) {
        const document = resultsBySourceFileId.get(
          manifestDocument.sourceFileId,
        );
        if (!document?.sha256 || !this.canAttach(document)) {
          continue;
        }

        const storedDocument = storedDocuments.get(document.sha256);
        if (!storedDocument) {
          throw new DatabaseError(
            `Stored document is missing for sourceFileId ${manifestDocument.sourceFileId}`,
          );
        }
        this.documentRepository.attachDocumentToLot({
          lotId: storedLot.id,
          documentId: storedDocument.id,
          sourceFileId: manifestDocument.sourceFileId,
          title: manifestDocument.title,
          position: manifestDocument.position,
        });

        if (document.isDuplicate || storedDocument.state !== 'new') {
          reusedDocuments += 1;
        }
      }

      this.documentRepository.removeLotDocumentLinksNotInManifest(
        storedLot.id,
        manifest.map((document) => document.sourceFileId),
      );

      const unsupportedDocuments = documents.filter(
        (document) => document.status === 'unsupported',
      ).length;
      const explicitFailures = documents.filter(
        (document) => document.status === 'failed',
      ).length;
      const invalidSuccessfulResults = documents.filter(
        (document) =>
          document.status !== 'failed' &&
          document.status !== 'unsupported' &&
          !document.sha256,
      ).length;
      const missingResults = manifest.length - resultsBySourceFileId.size;
      const failedDocuments =
        explicitFailures + invalidSuccessfulResults + missingResults;

      return {
        lotId: storedLot.id,
        documentsFound: manifest.length,
        processedDocuments: documents.length,
        uniqueDocuments: sourceDocuments.size,
        newDocuments,
        reusedDocuments,
        duplicateDocuments: documents.filter((document) => document.isDuplicate)
          .length,
        unsupportedDocuments,
        failedDocuments,
        unchangedDocuments,
        updatedDocuments,
        isPartial: unsupportedDocuments > 0 || failedDocuments > 0,
      };
    });
  }

  private getManifest(lot: SaudaLot): ManifestDocument[] {
    const sourceFileIds = new Set<string>();
    return lot.documents.map((document, position) => {
      let url: URL;
      try {
        url = new URL(document.url);
      } catch {
        throw new DatabaseError(
          `Lot document at position ${position} has an invalid URL`,
        );
      }

      const hostname = url.hostname.toLowerCase();
      if (
        url.protocol !== 'https:' ||
        (hostname !== 'e-qazyna.kz' && !hostname.endsWith('.e-qazyna.kz'))
      ) {
        throw new DatabaseError(
          `Lot document at position ${position} has an unsafe URL`,
        );
      }

      const sourceFileId = url.searchParams.get('FileId');

      if (!sourceFileId) {
        throw new DatabaseError(
          `Lot document at position ${position} has no sourceFileId`,
        );
      }
      if (sourceFileIds.has(sourceFileId)) {
        throw new DatabaseError(
          `Lot document manifest contains duplicate sourceFileId ${sourceFileId}`,
        );
      }
      sourceFileIds.add(sourceFileId);

      const title = document.title.trim();
      if (!title) {
        throw new DatabaseError(
          `Lot document at position ${position} has no title`,
        );
      }

      return {
        sourceFileId,
        title,
        position,
      };
    });
  }

  private indexResults(
    documents: ExtractedDocument[],
    manifest: ManifestDocument[],
  ): Map<string, ExtractedDocument> {
    const manifestSourceFileIds = new Set(
      manifest.map((document) => document.sourceFileId),
    );
    const indexed = new Map<string, ExtractedDocument>();

    for (const document of documents) {
      if (!document.sourceFileId) {
        throw new DatabaseError(
          'Cannot reconcile a processed document without sourceFileId',
        );
      }
      if (!manifestSourceFileIds.has(document.sourceFileId)) {
        throw new DatabaseError(
          `Processed document ${document.sourceFileId} is not present in the lot manifest`,
        );
      }
      if (indexed.has(document.sourceFileId)) {
        throw new DatabaseError(
          `Processed documents contain duplicate sourceFileId ${document.sourceFileId}`,
        );
      }
      indexed.set(document.sourceFileId, document);
    }

    return indexed;
  }

  private selectSourceDocuments(
    documents: ExtractedDocument[],
  ): Map<string, ExtractedDocument> {
    const sourceDocuments = new Map<string, ExtractedDocument>();
    for (const document of documents) {
      if (!document.sha256) {
        continue;
      }

      const current = sourceDocuments.get(document.sha256);
      if (!current || (current.isDuplicate && !document.isDuplicate)) {
        sourceDocuments.set(document.sha256, document);
      }
    }
    return sourceDocuments;
  }

  private canAttach(document: ExtractedDocument): boolean {
    return document.status !== 'failed' && document.status !== 'unsupported';
  }
}
