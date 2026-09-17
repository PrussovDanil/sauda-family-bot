import { Injectable } from '@nestjs/common';
import type { ExtractedDocument } from '../../documents/models/extracted-document';
import { DatabaseError } from '../errors/database.error';
import { DatabaseService } from '../database.service';
import type { StoredDocument } from '../models/stored-document';

interface DocumentRow {
  id: number;
  sha256: string;
  extraction_status: string;
  created_at: string;
  updated_at: string;
}

export interface UpsertDocumentResult {
  document: StoredDocument;
  isNew: boolean;
}

export interface LotDocumentParams {
  lotId: number;
  documentId: number;
  sourceFileId: string;
  title: string;
  position: number;
}

@Injectable()
export class DocumentRepository {
  constructor(private readonly databaseService: DatabaseService) {}

  findBySha256(sha256: string): StoredDocument | undefined {
    const row = this.databaseService.connection
      .prepare('SELECT * FROM documents WHERE sha256 = ?')
      .get(sha256) as DocumentRow | undefined;
    return row ? this.toStoredDocument(row) : undefined;
  }

  upsertDocument(document: ExtractedDocument): UpsertDocumentResult {
    if (!document.sha256) {
      throw new DatabaseError('Cannot store a document without SHA-256');
    }

    const existing = this.findBySha256(document.sha256);
    const now = new Date().toISOString();
    this.databaseService.connection
      .prepare(`
        INSERT INTO documents (
          sha256, content_type, size_bytes, page_count, extracted_text,
          extraction_status, extraction_quality, quality_score,
          quality_reasons_json, requires_cloud_recognition, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(sha256) DO UPDATE SET
          content_type = excluded.content_type,
          size_bytes = excluded.size_bytes,
          page_count = excluded.page_count,
          extracted_text = excluded.extracted_text,
          extraction_status = excluded.extraction_status,
          extraction_quality = excluded.extraction_quality,
          quality_score = excluded.quality_score,
          quality_reasons_json = excluded.quality_reasons_json,
          requires_cloud_recognition = excluded.requires_cloud_recognition,
          updated_at = excluded.updated_at
      `)
      .run(
        document.sha256,
        document.contentType ?? null,
        document.sizeBytes ?? null,
        document.pageCount ?? null,
        document.text,
        document.status,
        document.quality,
        document.qualityScore,
        JSON.stringify(document.qualityReasons),
        document.requiresCloudRecognition ? 1 : 0,
        now,
        now,
      );

    return {
      document: this.findBySha256(document.sha256)!,
      isNew: !existing,
    };
  }

  attachDocumentToLot(params: LotDocumentParams): void {
    this.databaseService.connection
      .prepare(`
        INSERT INTO lot_documents (
          lot_id, document_id, source_file_id, title, position, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(lot_id, source_file_id) DO UPDATE SET
          document_id = excluded.document_id,
          title = excluded.title,
          position = excluded.position
      `)
      .run(
        params.lotId,
        params.documentId,
        params.sourceFileId,
        params.title,
        params.position,
        new Date().toISOString(),
      );
  }

  findDocumentsForLot(lotId: number): StoredDocument[] {
    const rows = this.databaseService.connection
      .prepare(`
        SELECT documents.*
        FROM documents
        INNER JOIN lot_documents ON lot_documents.document_id = documents.id
        WHERE lot_documents.lot_id = ?
        ORDER BY lot_documents.position ASC
      `)
      .all(lotId) as unknown as DocumentRow[];
    return rows.map((row) => this.toStoredDocument(row));
  }

  private toStoredDocument(row: DocumentRow): StoredDocument {
    return {
      id: row.id,
      sha256: row.sha256,
      extractionStatus: row.extraction_status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
