import type { ExtractedDocument } from '../../documents/models/extracted-document';
import { DatabaseService } from '../database.service';
import { MigrationRunnerService } from '../migrations/migration-runner.service';
import { DocumentRepository } from './document.repository';

function createDocument(sha256: string): ExtractedDocument {
  return {
    title: 'document.pdf',
    sourceFileId: 'source-file',
    contentType: 'application/pdf',
    sizeBytes: 10,
    text: 'Extracted text',
    preview: 'Extracted text',
    status: 'success',
    sha256,
    isDuplicate: false,
    quality: 'good',
    qualityScore: 100,
    qualityReasons: [],
    requiresCloudRecognition: false,
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
    expect(second).toMatchObject({ isNew: false, document: { id: first.document.id } });
    const count = database.connection
      .prepare('SELECT COUNT(*) AS count FROM documents')
      .get() as { count: number };
    expect(count.count).toBe(1);
  });

  it('allows two sourceFileIds to point to one document', () => {
    const document = repository.upsertDocument(createDocument('b'.repeat(64))).document;
    database.connection
      .prepare('INSERT INTO lots (publication_id, lot_number, url, title, parsed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run('publication', '460260', 'https://sauda.e-qazyna.kz/lot', 'Lot', 'now', 'now', 'now');
    const lotId = (
      database.connection.prepare('SELECT id FROM lots WHERE publication_id = ?').get('publication') as {
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
});
