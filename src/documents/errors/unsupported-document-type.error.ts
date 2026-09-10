export class UnsupportedDocumentTypeError extends Error {
  constructor(
    readonly contentType: string,
    readonly sizeBytes: number,
  ) {
    super(`Document is not a supported PDF (${contentType || 'missing Content-Type'})`);
    this.name = UnsupportedDocumentTypeError.name;
  }
}
