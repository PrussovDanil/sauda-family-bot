export interface DownloadedDocument {
  title: string;
  sourceUrl: string;
  finalUrl: string;
  contentType: string;
  sizeBytes: number;
  buffer: Buffer;
  sha256: string;
}
