export class DocumentDownloadError extends Error {
  constructor(message = 'Document download failed', cause?: unknown) {
    super(message, { cause });
    this.name = DocumentDownloadError.name;
  }
}
