export class LotAmbiguousError extends Error {
  constructor(
    readonly lotNumber: string,
    readonly publicationIds: string[],
  ) {
    super(
      `Sauda lot ${lotNumber} matches multiple publications: ${publicationIds.join(', ')}`,
    );
    this.name = LotAmbiguousError.name;
  }
}
