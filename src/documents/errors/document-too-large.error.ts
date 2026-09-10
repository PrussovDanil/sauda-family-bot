export class DocumentTooLargeError extends Error {
  constructor() {
    super('Document exceeds the 20 MB size limit');
    this.name = DocumentTooLargeError.name;
  }
}
