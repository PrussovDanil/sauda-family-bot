import type { ExtractedDocument } from '../documents/models/extracted-document';
import type { SaudaLot } from '../sauda/models/sauda-lot';
import { DatabaseService } from './database.service';
import { MigrationRunnerService } from './migrations/migration-runner.service';
import { PersistenceService } from './persistence.service';
import { DocumentRepository } from './repositories/document.repository';
import { LotRepository } from './repositories/lot.repository';

const lot: SaudaLot = {
  lotNumber: '460260',
  publicationId: 'publication-460260',
  url: 'https://sauda.e-qazyna.kz/ru/lot',
  title: 'Lot',
  documents: [],
  parsedAt: '2026-09-17T00:00:00.000Z',
};

function createDocument(
  sha256: string,
  sourceFileId: string,
  isDuplicate = false,
): ExtractedDocument {
  return {
    title: 'оценка_.pdf',
    sourceFileId,
    contentType: 'application/pdf',
    sizeBytes: 3_139_026,
    text: isDuplicate ? '' : 'Extracted text',
    preview: isDuplicate ? '' : 'Extracted text',
    status: isDuplicate ? 'duplicate' : 'success',
    sha256,
    duplicateOfSha256: isDuplicate ? sha256 : undefined,
    isDuplicate,
    quality: 'good',
    qualityScore: 100,
    qualityReasons: [],
    requiresCloudRecognition: false,
  };
}

describe('PersistenceService', () => {
  let database: DatabaseService;
  let persistence: PersistenceService;

  beforeEach(() => {
    database = new DatabaseService(':memory:');
    database.onModuleInit();
    new MigrationRunnerService(database).onModuleInit();
    persistence = new PersistenceService(
      database,
      new LotRepository(database),
      new DocumentRepository(database),
    );
  });

  afterEach(() => database.onModuleDestroy());

  it('does not create duplicate lots, documents, or links on a repeated save', () => {
    const documents = [
      createDocument('a'.repeat(64), 'first'),
      createDocument('a'.repeat(64), 'second', true),
    ];

    expect(persistence.saveLotAnalysis(lot, documents)).toMatchObject({
      documentsFound: 2,
      uniqueDocuments: 1,
      newDocuments: 1,
      reusedDocuments: 1,
    });
    expect(persistence.saveLotAnalysis(lot, documents)).toMatchObject({
      newDocuments: 0,
      reusedDocuments: 2,
    });

    const counts = database.connection
      .prepare(`
        SELECT
          (SELECT COUNT(*) FROM lots) AS lots,
          (SELECT COUNT(*) FROM documents) AS documents,
          (SELECT COUNT(*) FROM lot_documents) AS lot_documents
      `)
      .get() as { lots: number; documents: number; lot_documents: number };
    expect(counts).toEqual({ lots: 1, documents: 1, lot_documents: 2 });
  });

  it('rolls back the whole save when a document cannot be attached', () => {
    expect(() =>
      persistence.saveLotAnalysis(lot, [
        createDocument('a'.repeat(64), 'first'),
        { ...createDocument('b'.repeat(64), 'second'), sourceFileId: undefined },
      ]),
    ).toThrow('sourceFileId');

    const count = database.connection
      .prepare('SELECT COUNT(*) AS count FROM lots')
      .get() as { count: number };
    expect(count.count).toBe(0);
  });
});
