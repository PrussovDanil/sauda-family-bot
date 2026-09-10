import { jest } from '@jest/globals';
import type { DownloadedDocument } from '../models/downloaded-document';
import { DocumentTextQualityService } from '../quality/document-text-quality.service';
import { normalizePdfText, PdfTextExtractorService } from './pdf-text-extractor.service';

class TestPdfTextExtractorService extends PdfTextExtractorService {
  constructor(
    private readonly parser: {
      destroy(): Promise<void>;
      getText(): Promise<{ text: string; total: number }>;
    },
  ) {
    super(new DocumentTextQualityService());
  }

  protected override createParser(): {
    destroy(): Promise<void>;
    getText(): Promise<{ text: string; total: number }>;
  } {
    return this.parser;
  }
}

const document: DownloadedDocument = {
  title: 'document.pdf',
  sourceUrl:
    'https://sauda.e-qazyna.kz/ru/MnuFileStoreFileDownload?FileId=test-file',
  finalUrl: 'https://sauda.e-qazyna.kz/ru/MnuFileStoreFileDownload',
  contentType: 'application/pdf',
  sizeBytes: 10,
  buffer: Buffer.from('%PDF-1.7'),
};

describe('PdfTextExtractorService', () => {
  it('normalizes whitespace while preserving paragraph breaks', () => {
    expect(normalizePdfText(' first  line \n\n\n second\u00a0line ')).toBe(
      'first line\n\nsecond line',
    );
  });

  it('returns text, page count, and a bounded preview', async () => {
    const destroy = jest.fn<Promise<void>, []>().mockResolvedValue(undefined);
    const extractor = new TestPdfTextExtractorService({
      destroy,
      getText: async () => ({ text: 'x'.repeat(1001), total: 2 }),
    });

    await expect(extractor.extract(document)).resolves.toEqual({
      title: 'document.pdf',
      sourceFileId: 'test-file',
      contentType: 'application/pdf',
      sizeBytes: 10,
      pageCount: 2,
      text: 'x'.repeat(1001),
      preview: 'x'.repeat(1000),
      status: 'success',
      quality: 'good',
      qualityScore: 100,
      qualityReasons: [],
      requiresCloudRecognition: false,
    });
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('returns empty for a scanned PDF without a text layer', async () => {
    const extractor = new TestPdfTextExtractorService({
      destroy: async () => undefined,
      getText: async () => ({ text: ' \n\n ', total: 1 }),
    });

    await expect(extractor.extract(document)).resolves.toMatchObject({
      preview: '',
      status: 'empty',
      text: '',
      quality: 'empty',
      requiresCloudRecognition: true,
    });
  });
});
