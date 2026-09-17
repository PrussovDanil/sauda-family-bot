import { Injectable } from '@nestjs/common';
import type { ExtractedDocument } from '../documents/models/extracted-document';
import type { SaudaLot } from '../sauda/models/sauda-lot';
import { DatabaseError } from './errors/database.error';
import { DatabaseService } from './database.service';
import { DocumentRepository } from './repositories/document.repository';
import { LotRepository } from './repositories/lot.repository';

export interface LotAnalysisSaveResult {
  lotId: number;
  documentsFound: number;
  uniqueDocuments: number;
  newDocuments: number;
  reusedDocuments: number;
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
      const storedDocuments = new Map<string, { id: number; isNew: boolean }>();
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

      for (const [sha256, document] of sourceDocuments) {
        const result = this.documentRepository.upsertDocument(document);
        storedDocuments.set(sha256, {
          id: result.document.id,
          isNew: result.isNew,
        });
      }

      let newDocuments = 0;
      let reusedDocuments = 0;
      for (const [position, document] of documents.entries()) {
        if (!document.sha256) {
          continue;
        }
        if (!document.sourceFileId) {
          throw new DatabaseError('Cannot attach a document without sourceFileId');
        }

        const storedDocument = storedDocuments.get(document.sha256)!;
        this.documentRepository.attachDocumentToLot({
          lotId: storedLot.id,
          documentId: storedDocument.id,
          sourceFileId: document.sourceFileId,
          title: document.title,
          position,
        });

        if (storedDocument.isNew && !document.isDuplicate) {
          newDocuments += 1;
        } else {
          reusedDocuments += 1;
        }
      }

      return {
        lotId: storedLot.id,
        documentsFound: documents.length,
        uniqueDocuments: sourceDocuments.size,
        newDocuments,
        reusedDocuments,
      };
    });
  }
}
