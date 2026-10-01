export class UnsupportedDocumentTypeError extends Error {
  readonly failureKind = 'content' as const;

  constructor(
    readonly contentType: string,
    readonly sizeBytes: number,
    readonly reason: 'content-type' | 'signature' = 'content-type',
  ) {
    super(
      reason === 'signature'
        ? 'Document content is not a valid PDF'
        : `Document is not a supported PDF (${contentType || 'missing Content-Type'})`,
    );
    this.name = UnsupportedDocumentTypeError.name;
  }
}
