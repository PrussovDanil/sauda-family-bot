export class LotPageParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = LotPageParseError.name;
  }
}
