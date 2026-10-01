export type DocumentDownloadFailureKind =
  'timeout' | 'network' | 'http' | 'response';

export class DocumentDownloadError extends Error {
  constructor(
    message = 'Document download failed',
    readonly failureKind: DocumentDownloadFailureKind = 'response',
    readonly retryable = false,
    cause?: unknown,
  ) {
    super(message, { cause });
    this.name = DocumentDownloadError.name;
  }
}
