import { Injectable } from '@nestjs/common';
import type {
  DocumentExtractionSnapshot,
  DocumentFailureKind,
  ExtractedDocument,
} from '../../documents/models/extracted-document';
import { DatabaseError } from '../errors/database.error';
import { DatabaseService } from '../database.service';
import type { StoredDocument } from '../models/stored-document';

interface DocumentRow {
  id: number;
  sha256: string;
  content_type: string | null;
  size_bytes: number | null;
  page_count: number | null;
  extracted_text: string | null;
  extraction_status: string;
  extraction_quality: string | null;
  quality_score: number | null;
  quality_reasons_json: string;
  requires_cloud_recognition: number;
  extraction_cache_version: string | null;
  failure_kind: string | null;
  retryable: number | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export type DocumentWriteState = 'new' | 'updated' | 'unchanged';

export interface UpsertDocumentResult {
  document: StoredDocument;
  isNew: boolean;
  state: DocumentWriteState;
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

  findReusableExtractionBySha256(
    sha256: string,
    cacheVersion: string,
  ): DocumentExtractionSnapshot | undefined {
    const row = this.findRowBySha256(sha256);
    if (
      !row ||
      row.extraction_cache_version !== cacheVersion ||
      !this.isReusableExtraction(row)
    ) {
      return undefined;
    }

    let qualityReasons: string[];
    try {
      const parsed: unknown = JSON.parse(row.quality_reasons_json);
      if (
        !Array.isArray(parsed) ||
        !parsed.every((item) => typeof item === 'string')
      ) {
        return undefined;
      }
      qualityReasons = parsed;
    } catch {
      return undefined;
    }

    const text = row.extracted_text ?? '';
    return {
      contentType: row.content_type ?? undefined,
      sizeBytes: row.size_bytes ?? undefined,
      pageCount: row.page_count ?? undefined,
      text,
      preview: text.slice(0, 1000),
      status: row.extraction_status as ExtractedDocument['status'],
      sha256: row.sha256,
      quality: (row.extraction_quality ??
        'unknown') as ExtractedDocument['quality'],
      qualityScore: row.quality_score ?? 0,
      qualityReasons,
      requiresCloudRecognition: row.requires_cloud_recognition === 1,
      ...(row.failure_kind
        ? { failureKind: row.failure_kind as DocumentFailureKind }
        : {}),
      ...(row.retryable !== null ? { retryable: row.retryable === 1 } : {}),
      ...(row.error_message ? { error: row.error_message } : {}),
      extractionCacheVersion: row.extraction_cache_version,
    };
  }

  upsertDocument(document: ExtractedDocument): UpsertDocumentResult {
    if (!document.sha256) {
      throw new DatabaseError('Cannot store a document without SHA-256');
    }

    const existing = this.findBySha256(document.sha256);
    const now = new Date().toISOString();
    if (!existing) {
      this.databaseService.connection
        .prepare(
          `
        INSERT INTO documents (
          sha256, content_type, size_bytes, page_count, extracted_text,
          extraction_status, extraction_quality, quality_score,
          quality_reasons_json, requires_cloud_recognition,
          extraction_cache_version, failure_kind, retryable, error_message,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
        )
        .run(
          ...this.getDocumentWriteValues(document, document.sha256, now),
          now,
        );

      return {
        document: this.findBySha256(document.sha256)!,
        isNew: true,
        state: 'new',
      };
    }

    const existingRow = this.findRowBySha256(document.sha256)!;
    if (!this.isExtractionImprovement(existingRow, document)) {
      return {
        document: existing,
        isNew: false,
        state: 'unchanged',
      };
    }

    this.databaseService.connection
      .prepare(
        `
        UPDATE documents SET
          content_type = ?,
          size_bytes = ?,
          page_count = ?,
          extracted_text = ?,
          extraction_status = ?,
          extraction_quality = ?,
          quality_score = ?,
          quality_reasons_json = ?,
          requires_cloud_recognition = ?,
          extraction_cache_version = ?,
          failure_kind = ?,
          retryable = ?,
          error_message = ?,
          updated_at = ?
        WHERE sha256 = ?
      `,
      )
      .run(
        document.contentType ?? null,
        document.sizeBytes ?? null,
        document.pageCount ?? null,
        document.text,
        document.status,
        document.quality,
        document.qualityScore,
        JSON.stringify(document.qualityReasons),
        document.requiresCloudRecognition ? 1 : 0,
        document.extractionCacheVersion ?? null,
        document.failureKind ?? null,
        document.retryable === undefined ? null : document.retryable ? 1 : 0,
        document.error ?? null,
        now,
        document.sha256,
      );

    return {
      document: this.findBySha256(document.sha256)!,
      isNew: false,
      state: 'updated',
    };
  }

  attachDocumentToLot(params: LotDocumentParams): void {
    this.databaseService.connection
      .prepare(
        `
        INSERT INTO lot_documents (
          lot_id, document_id, source_file_id, title, position, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(lot_id, source_file_id) DO UPDATE SET
          document_id = excluded.document_id,
          title = excluded.title,
          position = excluded.position
      `,
      )
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
      .prepare(
        `
        SELECT documents.*
        FROM documents
        INNER JOIN lot_documents ON lot_documents.document_id = documents.id
        WHERE lot_documents.lot_id = ?
        ORDER BY lot_documents.position ASC
      `,
      )
      .all(lotId) as unknown as DocumentRow[];
    return rows.map((row) => this.toStoredDocument(row));
  }

  removeLotDocumentLinksNotInManifest(
    lotId: number,
    sourceFileIds: string[],
  ): number {
    if (sourceFileIds.length === 0) {
      return Number(
        this.databaseService.connection
          .prepare('DELETE FROM lot_documents WHERE lot_id = ?')
          .run(lotId).changes,
      );
    }

    const placeholders = sourceFileIds.map(() => '?').join(', ');
    return Number(
      this.databaseService.connection
        .prepare(
          `
          DELETE FROM lot_documents
          WHERE lot_id = ?
            AND source_file_id NOT IN (${placeholders})
        `,
        )
        .run(lotId, ...sourceFileIds).changes,
    );
  }

  private findRowBySha256(sha256: string): DocumentRow | undefined {
    return this.databaseService.connection
      .prepare('SELECT * FROM documents WHERE sha256 = ?')
      .get(sha256) as DocumentRow | undefined;
  }

  private getDocumentWriteValues(
    document: ExtractedDocument,
    sha256: string,
    now: string,
  ): [
    string,
    string | null,
    number | null,
    number | null,
    string,
    string,
    string,
    number,
    string,
    number,
    string | null,
    string | null,
    number | null,
    string | null,
    string,
  ] {
    return [
      sha256,
      document.contentType ?? null,
      document.sizeBytes ?? null,
      document.pageCount ?? null,
      document.text,
      document.status,
      document.quality,
      document.qualityScore,
      JSON.stringify(document.qualityReasons),
      document.requiresCloudRecognition ? 1 : 0,
      document.extractionCacheVersion ?? null,
      document.failureKind ?? null,
      document.retryable === undefined ? null : document.retryable ? 1 : 0,
      document.error ?? null,
      now,
    ];
  }

  private isExtractionImprovement(
    existing: DocumentRow,
    incoming: ExtractedDocument,
  ): boolean {
    if (incoming.isDuplicate) {
      return false;
    }

    const existingRank = this.getExtractionRank(
      existing.extraction_status,
      existing.extraction_quality,
    );
    const incomingRank = this.getExtractionRank(
      incoming.status,
      incoming.quality,
    );
    if (incomingRank !== existingRank) {
      return incomingRank > existingRank;
    }

    const existingScore = existing.quality_score ?? 0;
    if (incoming.qualityScore !== existingScore) {
      return incoming.qualityScore > existingScore;
    }

    const existingTextLength = existing.extracted_text?.length ?? 0;
    if (incoming.text.length !== existingTextLength) {
      return incoming.text.length > existingTextLength;
    }

    if (existing.page_count === null && incoming.pageCount !== undefined) {
      return true;
    }

    return (
      incoming.extractionCacheVersion !== undefined &&
      incoming.extractionCacheVersion !== existing.extraction_cache_version
    );
  }

  private isReusableExtraction(row: DocumentRow): boolean {
    // Poor/textless results are reprocessed. Only stable malformed/encrypted
    // failures are cached; network and other transient failures remain retryable.
    if (row.content_type === null || row.size_bytes === null) {
      return false;
    }

    if (
      row.extraction_status === 'success' &&
      row.extraction_quality === 'good' &&
      row.quality_score !== null &&
      row.page_count !== null &&
      row.extracted_text !== null &&
      row.extracted_text.length > 0
    ) {
      return true;
    }

    return (
      row.extraction_status === 'failed' &&
      row.retryable === 0 &&
      row.error_message !== null &&
      (row.failure_kind === 'malformed' || row.failure_kind === 'encrypted')
    );
  }

  private getExtractionRank(status: string, quality: string | null): number {
    if (status === 'success' && quality === 'good') {
      return 4;
    }
    if (status === 'success' && quality === 'poor') {
      return 3;
    }
    if (status === 'empty' || quality === 'empty') {
      return 2;
    }
    if (status === 'success') {
      return 1;
    }
    return 0;
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
