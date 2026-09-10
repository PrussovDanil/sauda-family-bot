import { Injectable } from '@nestjs/common';
import { DocumentDownloadError } from '../errors/document-download.error';
import { DocumentTooLargeError } from '../errors/document-too-large.error';
import { UnsafeDocumentUrlError } from '../errors/unsafe-document-url.error';
import { UnsupportedDocumentTypeError } from '../errors/unsupported-document-type.error';
import type { DownloadedDocument } from '../models/downloaded-document';

const MAX_DOCUMENT_SIZE_BYTES = 20 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_REDIRECTS = 5;
const PDF_CONTENT_TYPE = 'application/pdf';
const OCTET_STREAM_CONTENT_TYPE = 'application/octet-stream';
const LEGACY_OCTET_STREAM_CONTENT_TYPE = 'octet/stream';

@Injectable()
export class DocumentDownloaderService {
  async download(
    title: string,
    sourceUrl: string,
  ): Promise<DownloadedDocument> {
    let currentUrl = this.assertSafeUrl(sourceUrl);

    for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount++) {
      const response = await this.fetchWithTimeout(currentUrl);

      if (this.isRedirect(response.status)) {
        if (redirectCount === MAX_REDIRECTS) {
          throw new DocumentDownloadError('Document redirect limit exceeded');
        }

        const location = response.headers.get('location');
        if (!location) {
          throw new DocumentDownloadError('Document redirect has no location');
        }

        currentUrl = this.assertSafeUrl(new URL(location, currentUrl).toString());
        continue;
      }

      if (!response.ok) {
        throw new DocumentDownloadError(
          `Document download failed with HTTP ${response.status}`,
        );
      }

      this.assertContentLength(response.headers.get('content-length'));
      const buffer = await this.readBody(response);
      const contentType = this.getContentType(response.headers.get('content-type'));
      this.assertPdf(contentType, buffer);

      return {
        title,
        sourceUrl,
        finalUrl: currentUrl,
        contentType,
        sizeBytes: buffer.length,
        buffer,
      };
    }

    throw new DocumentDownloadError();
  }

  private assertSafeUrl(value: string): string {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new UnsafeDocumentUrlError();
    }

    const hostname = url.hostname.toLowerCase();
    if (
      url.protocol !== 'https:' ||
      (hostname !== 'e-qazyna.kz' && !hostname.endsWith('.e-qazyna.kz'))
    ) {
      throw new UnsafeDocumentUrlError();
    }

    return url.toString();
  }

  private async fetchWithTimeout(url: string): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      return await fetch(url, {
        headers: { accept: 'application/pdf, application/octet-stream' },
        redirect: 'manual',
        signal: controller.signal,
      });
    } catch (error) {
      throw new DocumentDownloadError('Document request failed', error);
    } finally {
      clearTimeout(timeout);
    }
  }

  private assertContentLength(contentLength: string | null): void {
    if (!contentLength) {
      return;
    }

    const size = Number(contentLength);
    if (!Number.isSafeInteger(size) || size < 0) {
      throw new DocumentDownloadError('Document has an invalid Content-Length');
    }
    if (size > MAX_DOCUMENT_SIZE_BYTES) {
      throw new DocumentTooLargeError();
    }
  }

  private async readBody(response: Response): Promise<Buffer> {
    if (!response.body) {
      throw new DocumentDownloadError('Document response has no body');
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let sizeBytes = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        sizeBytes += value.byteLength;
        if (sizeBytes > MAX_DOCUMENT_SIZE_BYTES) {
          await reader.cancel();
          throw new DocumentTooLargeError();
        }
        chunks.push(value);
      }
    } catch (error) {
      if (error instanceof DocumentTooLargeError) {
        throw error;
      }
      throw new DocumentDownloadError('Document response stream failed', error);
    } finally {
      reader.releaseLock();
    }

    return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), sizeBytes);
  }

  private getContentType(contentType: string | null): string {
    return contentType?.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  }

  private assertPdf(contentType: string, buffer: Buffer): void {
    if (contentType === PDF_CONTENT_TYPE) {
      return;
    }
    if (
      (contentType === OCTET_STREAM_CONTENT_TYPE ||
        contentType === LEGACY_OCTET_STREAM_CONTENT_TYPE) &&
      buffer.subarray(0, 5).toString('ascii') === '%PDF-'
    ) {
      return;
    }

    throw new UnsupportedDocumentTypeError(contentType, buffer.length);
  }

  private isRedirect(status: number): boolean {
    return status >= 300 && status < 400;
  }
}
