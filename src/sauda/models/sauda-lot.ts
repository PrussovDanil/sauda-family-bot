export interface Money {
  amount: string;
  currency: 'KZT';
}

export interface LotDocument {
  title: string;
  url: string;
  extension?: string;
}

export function redactDocumentUrl(value: string): string {
  const url = new URL(value);
  return url
    .toString()
    .replace(/([?&]Token=)[^&#]*/i, '$1[REDACTED]');
}

export interface SaudaLot {
  lotNumber: string;
  publicationId: string;
  url: string;
  title: string;
  auctionType?: string;
  status?: string;
  startingPrice?: Money;
  deposit?: Money;
  auctionStartsAtRaw?: string;
  description?: string;
  address?: string;
  seller?: string;
  documents: LotDocument[];
  parsedAt: string;
}
