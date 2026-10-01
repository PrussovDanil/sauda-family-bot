import { jest } from '@jest/globals';
import type { LotAnalysisSaveResult } from '../database/persistence.service';
import { PersistenceService } from '../database/persistence.service';
import { DocumentRepository } from '../database/repositories/document.repository';
import { DocumentsService } from '../documents/documents.service';
import { DocumentDownloadError } from '../documents/errors/document-download.error';
import { PdfTextExtractorService } from '../documents/extractors/pdf-text-extractor.service';
import { DocumentDownloaderService } from '../documents/downloader/document-downloader.service';
import type { DownloadedDocument } from '../documents/models/downloaded-document';
import {
  PDF_EXTRACTION_CACHE_VERSION,
  type DocumentExtractionSnapshot,
  type ExtractedDocument,
} from '../documents/models/extracted-document';
import type { SaudaLot } from '../sauda/models/sauda-lot';
import { SaudaService } from '../sauda/sauda.service';
import { IngestionService } from './ingestion.service';

const URL_PREFIX =
  'https://sauda.e-qazyna.kz/ru/MnuFileStoreFileDownload?FileId=';

function createLot(fileIds = ['first']): SaudaLot {
  return {
    lotNumber: '460260',
    publicationId: 'publication-460260',
    url: 'https://sauda.e-qazyna.kz/ru/lot/1',
    title: 'Test lot',
    status: 'Published',
    startingPrice: {
      amount: '1000.00',
      currency: 'KZT',
      sourceRaw: '1 000,00 ₸',
    },
    auctionStartsAtRaw: '2026-10-01 10:00',
    documents: fileIds.map((fileId) => ({
      title: `${fileId}.pdf`,
      url: `${URL_PREFIX}${fileId}`,
    })),
    parsedAt: '2026-10-01T00:00:00.000Z',
  };
}

function createDownloadedDocument(
  title: string,
  sourceUrl: string,
  sha256 = 'a'.repeat(64),
): DownloadedDocument {
  return {
    title,
    sourceUrl,
    finalUrl: sourceUrl,
    contentType: 'application/pdf',
    sizeBytes: 10,
    buffer: Buffer.from('%PDF-test'),
    sha256,
  };
}

function createSnapshot(
  overrides: Partial<DocumentExtractionSnapshot> = {},
): DocumentExtractionSnapshot {
  return {
    contentType: 'application/pdf',
    sizeBytes: 10,
    pageCount: 2,
    text: 'Extracted text',
    preview: 'Extracted text',
    status: 'success',
    sha256: 'a'.repeat(64),
    quality: 'good',
    qualityScore: 100,
    qualityReasons: [],
    requiresCloudRecognition: false,
    extractionCacheVersion: PDF_EXTRACTION_CACHE_VERSION,
    ...overrides,
  };
}

function createSaveResult(): LotAnalysisSaveResult {
  return {
    lotId: 1,
    documentsFound: 1,
    processedDocuments: 1,
    uniqueDocuments: 1,
    newDocuments: 0,
    reusedDocuments: 1,
    duplicateDocuments: 0,
    unsupportedDocuments: 0,
    failedDocuments: 0,
    unchangedDocuments: 1,
    updatedDocuments: 0,
    isPartial: false,
  };
}

describe('IngestionService', () => {
  function createService(lot = createLot()) {
    const sauda = {
      getLot: jest.fn<(lotNumber: string) => Promise<SaudaLot>>(),
    };
    sauda.getLot.mockResolvedValue(lot);
    const downloader = {
      download:
        jest.fn<
          (title: string, sourceUrl: string) => Promise<DownloadedDocument>
        >(),
    };
    downloader.download.mockImplementation(async (title, sourceUrl) =>
      createDownloadedDocument(title, sourceUrl),
    );
    const extractor = {
      extract:
        jest.fn<(document: DownloadedDocument) => Promise<ExtractedDocument>>(),
    };
    extractor.extract.mockImplementation(async (document) => ({
      title: document.title,
      sourceFileId: new URL(document.sourceUrl).searchParams.get('FileId')!,
      contentType: document.contentType,
      sizeBytes: document.sizeBytes,
      pageCount: 2,
      text: 'Extracted text',
      preview: 'Extracted text',
      status: 'success',
      sha256: document.sha256,
      isDuplicate: false,
      quality: 'good',
      qualityScore: 100,
      qualityReasons: [],
      requiresCloudRecognition: false,
    }));
    const documents = new DocumentsService(
      downloader as unknown as DocumentDownloaderService,
      extractor as unknown as PdfTextExtractorService,
    );
    const repository = {
      findReusableExtractionBySha256:
        jest.fn<
          (
            sha256: string,
            cacheVersion: string,
          ) => DocumentExtractionSnapshot | undefined
        >(),
    };
    const saveResult = createSaveResult();
    const persistence = {
      saveLotAnalysis:
        jest.fn<
          (
            lot: SaudaLot,
            documents: ExtractedDocument[],
          ) => LotAnalysisSaveResult
        >(),
    };
    persistence.saveLotAnalysis.mockReturnValue(saveResult);

    return {
      service: new IngestionService(
        sauda as unknown as SaudaService,
        documents,
        repository as unknown as DocumentRepository,
        persistence as unknown as PersistenceService,
      ),
      sauda,
      downloader,
      extractor,
      repository,
      persistence,
      saveResult,
    };
  }

  it('reuses a compatible cross-run extraction by SHA-256 before PDF extraction', async () => {
    const context = createService();
    context.repository.findReusableExtractionBySha256.mockReturnValue(
      createSnapshot(),
    );

    const result = await context.service.ingestLot('460260');

    expect(context.extractor.extract).not.toHaveBeenCalled();
    expect(
      context.repository.findReusableExtractionBySha256,
    ).toHaveBeenCalledWith('a'.repeat(64), PDF_EXTRACTION_CACHE_VERSION);
    expect(result.result).toBe(context.saveResult);
    expect(result.documents[0]).toMatchObject({
      sourceFileId: 'first',
      status: 'success',
      isDuplicate: false,
    });
  });

  it('extracts identical files only once in the same run', async () => {
    const context = createService(createLot(['first', 'second']));

    const result = await context.service.ingestLot('460260');

    expect(context.extractor.extract).toHaveBeenCalledTimes(1);
    expect(
      context.repository.findReusableExtractionBySha256,
    ).toHaveBeenCalledTimes(1);
    expect(result.documents[1]).toMatchObject({
      sourceFileId: 'second',
      isDuplicate: true,
      duplicateOfSha256: 'a'.repeat(64),
    });
  });

  it('retries a transient document download once', async () => {
    const context = createService();
    context.downloader.download
      .mockRejectedValueOnce(
        new DocumentDownloadError(
          'Document network request failed',
          'network',
          true,
        ),
      )
      .mockImplementation(async (title, sourceUrl) =>
        createDownloadedDocument(title, sourceUrl),
      );

    const result = await context.service.ingestLot('460260');

    expect(context.downloader.download).toHaveBeenCalledTimes(2);
    expect(result.documents[0].status).toBe('success');
  });

  it('reuses a version-compatible deterministic encrypted failure', async () => {
    const context = createService();
    context.repository.findReusableExtractionBySha256.mockReturnValue(
      createSnapshot({
        pageCount: undefined,
        text: '',
        preview: '',
        status: 'failed',
        quality: 'unknown',
        qualityScore: 0,
        qualityReasons: ['text-extraction-did-not-run'],
        requiresCloudRecognition: true,
        failureKind: 'encrypted',
        retryable: false,
        error: 'PDF is encrypted and cannot be processed',
      }),
    );

    const result = await context.service.ingestLot('460260');

    expect(context.extractor.extract).not.toHaveBeenCalled();
    expect(result.documents[0]).toMatchObject({
      status: 'failed',
      failureKind: 'encrypted',
      retryable: false,
    });
  });
});
