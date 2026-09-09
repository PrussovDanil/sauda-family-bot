export class LotPageUnavailableError extends Error {
  constructor(cause?: unknown) {
    super('Sauda lot page is unavailable', { cause });
    this.name = LotPageUnavailableError.name;
  }
}
