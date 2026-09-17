import { jest } from '@jest/globals';
import type { SaudaLot } from '../sauda/models/sauda-lot';
import { DocumentDownloaderService } from './downloader/document-downloader.service';
import { PdfTextExtractorService } from './extractors/pdf-text-extractor.service';
import type { DownloadedDocument } from './models/downloaded-document';
import type { ExtractedDocument } from './models/extracted-document';
import { DocumentsService } from './documents.service';

const URL_PREFIX =
  'https://sauda.e-qazyna.kz/ru/MnuFileStoreFileDownload?FileId=';

function createLot(documents: Array<{ title: string; fileId: string }>): SaudaLot {
  return {
    lotNumber: '460260',
    publicationId: 'publication',
    url: 'https://sauda.e-qazyna.kz/ru/lot',
    title: 'Test lot',
    documents: documents.map((document) => ({
      title: document.title,
      url: `${URL_PREFIX}${document.fileId}`,
    })),
    parsedAt: '2026-09-10T00:00:00.000Z',
  };
}

function createDownloadedDocument(
  title: string,
  sourceUrl: string,
  sha256: string,
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

function createExtractedDocument(
  document: DownloadedDocument,
): ExtractedDocument {
  return {
    title: document.title,
    contentType: document.contentType,
    sizeBytes: document.sizeBytes,
    text: 'Extracted text',
    preview: 'Extracted text',
    status: 'success',
    sha256: document.sha256,
    isDuplicate: false,
    quality: 'good',
    qualityScore: 100,
    qualityReasons: [],
    requiresCloudRecognition: false,
  };
}

describe('DocumentsService', () => {
  function createService() {
    const downloader = {
      download: jest.fn<(title: string, sourceUrl: string) => Promise<DownloadedDocument>>(),
    };
    const extractor = {
      extract: jest.fn<(document: DownloadedDocument) => Promise<ExtractedDocument>>(),
    };

    return {
      service: new DocumentsService(
        downloader as unknown as DocumentDownloaderService,
        extractor as unknown as PdfTextExtractorService,
      ),
      downloader,
      extractor,
    };
  }

  it('does not treat equal titles with different content hashes as duplicates', async () => {
    const { service, downloader, extractor } = createService();
    downloader.download.mockImplementation(async (title, sourceUrl) =>
      createDownloadedDocument(
        title,
        sourceUrl,
        sourceUrl.endsWith('first') ? 'a'.repeat(64) : 'b'.repeat(64),
      ),
    );
    extractor.extract.mockImplementation(async (document) =>
      createExtractedDocument(document),
    );

    const result = await service.processLotDocuments(
      createLot([
        { title: 'оценка_.pdf', fileId: 'first' },
        { title: 'оценка_.pdf', fileId: 'second' },
      ]),
    );

    expect(extractor.extract).toHaveBeenCalledTimes(2);
    expect(result.every((document) => !document.isDuplicate)).toBe(true);
  });

  it('marks identical content with different titles as a duplicate without extracting it twice', async () => {
    const { service, downloader, extractor } = createService();
    downloader.download.mockImplementation(async (title, sourceUrl) =>
      createDownloadedDocument(title, sourceUrl, 'c'.repeat(64)),
    );
    extractor.extract.mockImplementation(async (document) =>
      createExtractedDocument(document),
    );

    const result = await service.processLotDocuments(
      createLot([
        { title: 'original.pdf', fileId: 'first' },
        { title: 'copy.pdf', fileId: 'second' },
      ]),
    );

    expect(extractor.extract).toHaveBeenCalledTimes(1);
    expect(result[1]).toMatchObject({
      title: 'copy.pdf',
      status: 'duplicate',
      sha256: 'c'.repeat(64),
      duplicateOfSha256: 'c'.repeat(64),
      isDuplicate: true,
      text: '',
      preview: '',
      requiresCloudRecognition: false,
    });
  });

  it('continues deduplicating documents after a download error', async () => {
    const { service, downloader, extractor } = createService();
    downloader.download
      .mockRejectedValueOnce(new Error('Download failed'))
      .mockImplementation(async (title, sourceUrl) =>
        createDownloadedDocument(title, sourceUrl, 'd'.repeat(64)),
      );
    extractor.extract.mockImplementation(async (document) =>
      createExtractedDocument(document),
    );

    const result = await service.processLotDocuments(
      createLot([
        { title: 'failed.pdf', fileId: 'failed' },
        { title: 'original.pdf', fileId: 'original' },
        { title: 'copy.pdf', fileId: 'copy' },
      ]),
    );

    expect(result.map((document) => document.status)).toEqual([
      'failed',
      'success',
      'duplicate',
    ]);
    expect(extractor.extract).toHaveBeenCalledTimes(1);
  });
});
