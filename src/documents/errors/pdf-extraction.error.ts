export type PdfExtractionFailureKind = 'encrypted' | 'malformed' | 'extraction';

const ERROR_MESSAGES: Record<PdfExtractionFailureKind, string> = {
  encrypted: 'PDF is encrypted and cannot be processed',
  malformed: 'PDF is malformed or truncated',
  extraction: 'PDF text extraction failed',
};

export class PdfExtractionError extends Error {
  readonly retryable = false;

  constructor(
    readonly failureKind: PdfExtractionFailureKind,
    cause?: unknown,
  ) {
    super(ERROR_MESSAGES[failureKind], { cause });
    this.name = PdfExtractionError.name;
  }
}
