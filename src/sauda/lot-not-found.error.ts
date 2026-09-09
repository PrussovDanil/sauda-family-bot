export class LotNotFoundError extends Error {
  constructor(lotNumber: string) {
    super(`Sauda lot ${lotNumber} was not found`);
    this.name = LotNotFoundError.name;
  }
}
