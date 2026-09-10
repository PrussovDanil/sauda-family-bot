import { jest } from '@jest/globals';
import { DocumentDownloaderService } from './document-downloader.service';
import { DocumentTooLargeError } from '../errors/document-too-large.error';
import { UnsafeDocumentUrlError } from '../errors/unsafe-document-url.error';
import { UnsupportedDocumentTypeError } from '../errors/unsupported-document-type.error';

const DOCUMENT_URL =
  'https://sauda.e-qazyna.kz/ru/MnuFileStoreFileDownload?FileId=test-file';

describe('DocumentDownloaderService', () => {
  const service = new DocumentDownloaderService();
  let fetchMock: jest.SpiedFunction<typeof fetch>;

  beforeEach(() => {
    fetchMock = jest.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchMock.mockRestore();
  });

  it('downloads an application/pdf response into memory', async () => {
    fetchMock.mockResolvedValue(
      new Response(Buffer.from('%PDF-1.7'), {
        headers: { 'content-length': '8', 'content-type': 'application/pdf' },
      }),
    );

    await expect(service.download('document.pdf', DOCUMENT_URL)).resolves.toMatchObject({
      contentType: 'application/pdf',
      finalUrl: DOCUMENT_URL,
      sizeBytes: 8,
      title: 'document.pdf',
    });
  });

  it('accepts octet-stream only when the PDF signature is present', async () => {
    fetchMock.mockResolvedValue(
      new Response(Buffer.from('%PDF-1.7'), {
        headers: { 'content-type': 'application/octet-stream' },
      }),
    );

    await expect(service.download('document.bin', DOCUMENT_URL)).resolves.toMatchObject({
      contentType: 'application/octet-stream',
    });
  });

  it('accepts Sauda legacy octet/stream only when the PDF signature is present', async () => {
    fetchMock.mockResolvedValue(
      new Response(Buffer.from('%PDF-1.7'), {
        headers: { 'content-type': 'octet/stream' },
      }),
    );

    await expect(service.download('document.bin', DOCUMENT_URL)).resolves.toMatchObject({
      contentType: 'octet/stream',
    });
  });

  it('rejects an octet-stream response without a PDF signature', async () => {
    fetchMock.mockResolvedValue(
      new Response(Buffer.from('not a PDF'), {
        headers: { 'content-type': 'application/octet-stream' },
      }),
    );

    await expect(service.download('document.bin', DOCUMENT_URL)).rejects.toBeInstanceOf(
      UnsupportedDocumentTypeError,
    );
  });

  it('rejects unsafe URLs before making a request', async () => {
    await expect(
      service.download('document.pdf', 'https://127.0.0.1/document.pdf'),
    ).rejects.toBeInstanceOf(UnsafeDocumentUrlError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a too-large Content-Length before reading the body', async () => {
    fetchMock.mockResolvedValue(
      new Response(null, {
        headers: { 'content-length': String(20 * 1024 * 1024 + 1) },
      }),
    );

    await expect(service.download('document.pdf', DOCUMENT_URL)).rejects.toBeInstanceOf(
      DocumentTooLargeError,
    );
  });

  it('stops a streamed response that exceeds the size limit without Content-Length', async () => {
    const oversizedStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(20 * 1024 * 1024 + 1));
        controller.close();
      },
    });
    fetchMock.mockResolvedValue(
      new Response(oversizedStream, {
        headers: { 'content-type': 'application/pdf' },
      }),
    );

    await expect(service.download('document.pdf', DOCUMENT_URL)).rejects.toBeInstanceOf(
      DocumentTooLargeError,
    );
  });

  it('validates every redirect destination', async () => {
    fetchMock.mockResolvedValue(
      new Response(null, {
        headers: { location: 'https://localhost/document.pdf' },
        status: 302,
      }),
    );

    await expect(service.download('document.pdf', DOCUMENT_URL)).rejects.toBeInstanceOf(
      UnsafeDocumentUrlError,
    );
  });
});
