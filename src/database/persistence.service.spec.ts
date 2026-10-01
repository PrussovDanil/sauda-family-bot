import { jest } from '@jest/globals';
import type { ExtractedDocument } from '../documents/models/extracted-document';
import type { SaudaLot } from '../sauda/models/sauda-lot';
import { DatabaseService } from './database.service';
import { MigrationRunnerService } from './migrations/migration-runner.service';
import { PersistenceService } from './persistence.service';
import { DocumentRepository } from './repositories/document.repository';
import { LotRepository } from './repositories/lot.repository';

const DOCUMENT_URL_PREFIX =
  'https://sauda.e-qazyna.kz/ru/MnuFileStoreFileDownload?FileId=';

function createLot(sourceFileIds: string[]): SaudaLot {
  return {
    lotNumber: '460260',
    publicationId: 'publication-460260',
    url: 'https://sauda.e-qazyna.kz/ru/lot',
    title: 'Lot',
    documents: sourceFileIds.map((sourceFileId) => ({
      title: `${sourceFileId}.pdf`,
      url: `${DOCUMENT_URL_PREFIX}${sourceFileId}`,
    })),
    parsedAt: '2026-09-17T00:00:00.000Z',
  };
}

function createDocument(
  sha256: string | undefined,
  sourceFileId: string,
  overrides: Partial<ExtractedDocument> = {},
): ExtractedDocument {
  return {
    title: `${sourceFileId}.pdf`,
    sourceFileId,
    contentType: 'application/pdf',
    sizeBytes: 3_139_026,
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

describe('PersistenceService', () => {
  let database: DatabaseService;
  let documentRepository: DocumentRepository;
  let persistence: PersistenceService;

  beforeEach(() => {
    database = new DatabaseService(':memory:');
    database.onModuleInit();
    new MigrationRunnerService(database).onModuleInit();
    documentRepository = new DocumentRepository(database);
    persistence = new PersistenceService(
      database,
      new LotRepository(database),
      documentRepository,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
    database.onModuleDestroy();
  });

  it('is idempotent and supports two sourceFileIds sharing one SHA-256', () => {
    const lot = createLot(['first', 'second']);
    const documents = [
      createDocument('a'.repeat(64), 'first'),
      createDocument('a'.repeat(64), 'second', {
        isDuplicate: true,
        duplicateOfSha256: 'a'.repeat(64),
      }),
    ];

    expect(persistence.saveLotAnalysis(lot, documents)).toMatchObject({
      documentsFound: 2,
      processedDocuments: 2,
      uniqueDocuments: 1,
      newDocuments: 1,
      reusedDocuments: 1,
      duplicateDocuments: 1,
      unsupportedDocuments: 0,
      failedDocuments: 0,
      unchangedDocuments: 0,
      updatedDocuments: 0,
      isPartial: false,
    });
    expect(persistence.saveLotAnalysis(lot, documents)).toMatchObject({
      newDocuments: 0,
      reusedDocuments: 2,
      unchangedDocuments: 1,
      updatedDocuments: 0,
      isPartial: false,
    });

    expect(readCounts(database)).toEqual({
      lots: 1,
      documents: 1,
      lotDocuments: 2,
    });
  });

  it('removes stale lot-document links without deleting orphaned documents', () => {
    persistence.saveLotAnalysis(createLot(['first', 'stale']), [
      createDocument('a'.repeat(64), 'first'),
      createDocument('b'.repeat(64), 'stale'),
    ]);

    persistence.saveLotAnalysis(createLot(['first']), [
      createDocument('a'.repeat(64), 'first'),
    ]);

    expect(readLinkedSourceFileIds(database)).toEqual(['first']);
    expect(readCounts(database)).toMatchObject({
      documents: 2,
      lotDocuments: 1,
    });
  });

  it('does not reconcile links when the manifest is not trustworthy', () => {
    persistence.saveLotAnalysis(createLot(['first']), [
      createDocument('a'.repeat(64), 'first'),
    ]);
    const unsafeLot: SaudaLot = {
      ...createLot([]),
      documents: [
        {
          title: 'external.pdf',
          url: 'https://example.com/document.pdf?FileId=external',
        },
      ],
    };

    expect(() => persistence.saveLotAnalysis(unsafeLot, [])).toThrow(
      'unsafe URL',
    );
    expect(readLinkedSourceFileIds(database)).toEqual(['first']);
  });

  it('preserves the previous link when a current sourceFileId fails temporarily', () => {
    persistence.saveLotAnalysis(createLot(['first']), [
      createDocument('a'.repeat(64), 'first'),
    ]);

    const result = persistence.saveLotAnalysis(createLot(['first']), [
      createDocument('b'.repeat(64), 'first', {
        status: 'failed',
        text: '',
        preview: '',
        quality: 'unknown',
        qualityScore: 0,
        qualityReasons: ['text-extraction-did-not-run'],
        requiresCloudRecognition: true,
        failureKind: 'extraction',
        retryable: false,
        error: 'PDF text extraction failed',
      }),
    ]);

    expect(result).toMatchObject({
      failedDocuments: 1,
      isPartial: true,
    });
    expect(readLinkedHashes(database)).toEqual(['a'.repeat(64)]);
  });

  it('reports an updated document when extraction quality improves', () => {
    const sha256 = 'c'.repeat(64);
    persistence.saveLotAnalysis(createLot(['first']), [
      createDocument(sha256, 'first', {
        status: 'failed',
        text: '',
        preview: '',
        quality: 'unknown',
        qualityScore: 0,
        qualityReasons: ['text-extraction-did-not-run'],
        requiresCloudRecognition: true,
      }),
    ]);

    const result = persistence.saveLotAnalysis(createLot(['first']), [
      createDocument(sha256, 'first'),
    ]);

    expect(result).toMatchObject({
      newDocuments: 0,
      reusedDocuments: 1,
      unchangedDocuments: 0,
      updatedDocuments: 1,
      isPartial: false,
    });
    expect(readLinkedHashes(database)).toEqual([sha256]);
  });

  it('counts unsupported, failed, and missing results without hiding them', () => {
    const result = persistence.saveLotAnalysis(
      createLot(['good', 'unsupported', 'failed', 'missing']),
      [
        createDocument('a'.repeat(64), 'good'),
        createDocument(undefined, 'unsupported', {
          status: 'unsupported',
          text: '',
          preview: '',
          quality: 'unknown',
          qualityScore: 0,
          qualityReasons: ['text-extraction-did-not-run'],
          requiresCloudRecognition: true,
          failureKind: 'content',
          retryable: false,
        }),
        createDocument(undefined, 'failed', {
          status: 'failed',
          text: '',
          preview: '',
          quality: 'unknown',
          qualityScore: 0,
          qualityReasons: ['text-extraction-did-not-run'],
          requiresCloudRecognition: true,
          failureKind: 'network',
          retryable: true,
        }),
      ],
    );

    expect(result).toMatchObject({
      documentsFound: 4,
      processedDocuments: 3,
      newDocuments: 1,
      unsupportedDocuments: 1,
      failedDocuments: 2,
      isPartial: true,
    });
    expect(readLinkedSourceFileIds(database)).toEqual(['good']);
  });

  it('rolls back all writes when a multi-step attach fails', () => {
    jest
      .spyOn(documentRepository, 'attachDocumentToLot')
      .mockImplementation(() => {
        throw new Error('simulated attach failure');
      });

    expect(() =>
      persistence.saveLotAnalysis(createLot(['first']), [
        createDocument('a'.repeat(64), 'first'),
      ]),
    ).toThrow('simulated attach failure');

    expect(readCounts(database)).toEqual({
      lots: 0,
      documents: 0,
      lotDocuments: 0,
    });
  });

  it('rolls back when a processed document cannot be reconciled to the manifest', () => {
    expect(() =>
      persistence.saveLotAnalysis(createLot(['first']), [
        {
          ...createDocument('a'.repeat(64), 'first'),
          sourceFileId: undefined,
        },
      ]),
    ).toThrow('sourceFileId');

    expect(readCounts(database)).toEqual({
      lots: 0,
      documents: 0,
      lotDocuments: 0,
    });
  });
});

function readCounts(database: DatabaseService): {
  lots: number;
  documents: number;
  lotDocuments: number;
} {
  return database.connection
    .prepare(
      `
      SELECT
        (SELECT COUNT(*) FROM lots) AS lots,
        (SELECT COUNT(*) FROM documents) AS documents,
        (SELECT COUNT(*) FROM lot_documents) AS lotDocuments
    `,
    )
    .get() as { lots: number; documents: number; lotDocuments: number };
}

function readLinkedSourceFileIds(database: DatabaseService): string[] {
  const rows = database.connection
    .prepare('SELECT source_file_id FROM lot_documents ORDER BY position ASC')
    .all() as unknown as Array<{ source_file_id: string }>;
  return rows.map((row) => row.source_file_id);
}

function readLinkedHashes(database: DatabaseService): string[] {
  const rows = database.connection
    .prepare(
      `
      SELECT documents.sha256
      FROM lot_documents
      INNER JOIN documents ON documents.id = lot_documents.document_id
      ORDER BY lot_documents.position ASC
    `,
    )
    .all() as unknown as Array<{ sha256: string }>;
  return rows.map((row) => row.sha256);
}
