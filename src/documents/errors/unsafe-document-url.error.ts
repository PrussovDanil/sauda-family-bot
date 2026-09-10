export class UnsafeDocumentUrlError extends Error {
  constructor() {
    super('Document URL is not allowed');
    this.name = UnsafeDocumentUrlError.name;
  }
}
