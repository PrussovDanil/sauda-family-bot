import type { ExtractedDocument } from '../../documents/models/extracted-document';
import { PDF_EXTRACTION_CACHE_VERSION } from '../../documents/models/extracted-document';
import { DatabaseService } from '../database.service';
import { MigrationRunnerService } from '../migrations/migration-runner.service';
import { DocumentRepository } from './document.repository';

function createDocument(
  sha256: string,
  overrides: Partial<ExtractedDocument> = {},
): ExtractedDocument {
  return {
    title: 'document.pdf',
    sourceFileId: 'source-file',
    contentType: 'application/pdf',
    sizeBytes: 10,
    pageCount: 2,
    text: 'Extracted text',
    preview: 'Extracted text',
    status: 'success',
    sha256,
    isDuplicate: false,
    quality: 'good',
    qualityScore: 100,
    qualityReasons: [],
    requiresCloudRecognition: false,
    ...overrides,
  };
}

describe('DocumentRepository', () => {
  let database: DatabaseService;
  let repository: DocumentRepository;

  beforeEach(() => {
    database = new DatabaseService(':memory:');
    database.onModuleInit();
    new MigrationRunnerService(database).onModuleInit();
    repository = new DocumentRepository(database);
  });

  afterEach(() => database.onModuleDestroy());

  it('keeps SHA-256 unique when a document is saved again', () => {
    const first = repository.upsertDocument(createDocument('a'.repeat(64)));
    const second = repository.upsertDocument(createDocument('a'.repeat(64)));

    expect(first.isNew).toBe(true);
    expect(second).toMatchObject({
      isNew: false,
      state: 'unchanged',
      document: { id: first.document.id },
    });
    const count = database.connection
      .prepare('SELECT COUNT(*) AS count FROM documents')
      .get() as { count: number };
    expect(count.count).toBe(1);
  });

  it('allows two sourceFileIds to point to one document', () => {
    const document = repository.upsertDocument(
      createDocument('b'.repeat(64)),
    ).document;
    database.connection
      .prepare(
        'INSERT INTO lots (publication_id, lot_number, url, title, parsed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        'publication',
        '460260',
        'https://sauda.e-qazyna.kz/lot',
        'Lot',
        'now',
        'now',
        'now',
      );
    const lotId = (
      database.connection
        .prepare('SELECT id FROM lots WHERE publication_id = ?')
        .get('publication') as {
        id: number;
      }
    ).id;

    repository.attachDocumentToLot({
      lotId,
      documentId: document.id,
      sourceFileId: 'source-one',
      title: 'first.pdf',
      position: 0,
    });
    repository.attachDocumentToLot({
      lotId,
      documentId: document.id,
      sourceFileId: 'source-two',
      title: 'second.pdf',
      position: 1,
    });

    expect(repository.findDocumentsForLot(lotId)).toHaveLength(2);
  });

  it('does not overwrite a good extraction with failed, poorer, or duplicate data', () => {
    const sha256 = 'c'.repeat(64);
    repository.upsertDocument(createDocument(sha256));

    const inferiorDocuments: ExtractedDocument[] = [
      createDocument(sha256, {
        status: 'failed',
        text: '',
        quality: 'unknown',
        qualityScore: 0,
        requiresCloudRecognition: true,
      }),
      createDocument(sha256, {
        quality: 'poor',
        qualityScore: 40,
        requiresCloudRecognition: true,
      }),
      createDocument(sha256, {
        isDuplicate: true,
        duplicateOfSha256: sha256,
        text: 'Longer duplicate text must not replace the original extraction',
      }),
    ];

    for (const document of inferiorDocuments) {
      expect(repository.upsertDocument(document).state).toBe('unchanged');
    }

    const row = database.connection
      .prepare(
        `
        SELECT extraction_status, extraction_quality, quality_score,
               extracted_text, requires_cloud_recognition
        FROM documents WHERE sha256 = ?
      `,
      )
      .get(sha256);
    expect(row).toEqual({
      extraction_status: 'success',
      extraction_quality: 'good',
      quality_score: 100,
      extracted_text: 'Extracted text',
      requires_cloud_recognition: 0,
    });
  });

  it('updates a failed extraction when a better result becomes available', () => {
    const sha256 = 'd'.repeat(64);
    repository.upsertDocument(
      createDocument(sha256, {
        status: 'failed',
        text: '',
        preview: '',
        quality: 'unknown',
        qualityScore: 0,
        requiresCloudRecognition: true,
      }),
    );

    expect(repository.upsertDocument(createDocument(sha256)).state).toBe(
      'updated',
    );
    expect(repository.findBySha256(sha256)).toMatchObject({
      extractionStatus: 'success',
    });
  });

  it('returns only a complete version-compatible good extraction from cache', () => {
    const sha256 = 'e'.repeat(64);
    repository.upsertDocument(
      createDocument(sha256, {
        extractionCacheVersion: PDF_EXTRACTION_CACHE_VERSION,
      }),
    );

    expect(
      repository.findReusableExtractionBySha256(
        sha256,
        PDF_EXTRACTION_CACHE_VERSION,
      ),
    ).toMatchObject({
      sha256,
      status: 'success',
      quality: 'good',
      text: 'Extracted text',
    });
    expect(
      repository.findReusableExtractionBySha256(sha256, 'pdf-text-v2'),
    ).toBeUndefined();
  });

  it('does not reuse poor or transient failed extraction state', () => {
    const poorSha = 'f'.repeat(64);
    const transientSha = '1'.repeat(64);
    repository.upsertDocument(
      createDocument(poorSha, {
        quality: 'poor',
        qualityScore: 40,
        requiresCloudRecognition: true,
        extractionCacheVersion: PDF_EXTRACTION_CACHE_VERSION,
      }),
    );
    repository.upsertDocument(
      createDocument(transientSha, {
        status: 'failed',
        text: '',
        preview: '',
        quality: 'unknown',
        qualityScore: 0,
        requiresCloudRecognition: true,
        failureKind: 'network',
        retryable: true,
        extractionCacheVersion: PDF_EXTRACTION_CACHE_VERSION,
      }),
    );

    expect(
      repository.findReusableExtractionBySha256(
        poorSha,
        PDF_EXTRACTION_CACHE_VERSION,
      ),
    ).toBeUndefined();
    expect(
      repository.findReusableExtractionBySha256(
        transientSha,
        PDF_EXTRACTION_CACHE_VERSION,
      ),
    ).toBeUndefined();
  });

  it('reuses version-compatible deterministic PDF failures', () => {
    const sha256 = '2'.repeat(64);
    repository.upsertDocument(
      createDocument(sha256, {
        status: 'failed',
        text: '',
        preview: '',
        quality: 'unknown',
        qualityScore: 0,
        requiresCloudRecognition: true,
        failureKind: 'malformed',
        retryable: false,
        error: 'PDF is malformed or truncated',
        extractionCacheVersion: PDF_EXTRACTION_CACHE_VERSION,
      }),
    );

    expect(
      repository.findReusableExtractionBySha256(
        sha256,
        PDF_EXTRACTION_CACHE_VERSION,
      ),
    ).toMatchObject({
      status: 'failed',
      failureKind: 'malformed',
      retryable: false,
    });
  });
});
