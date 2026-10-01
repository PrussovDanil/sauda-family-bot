export type ExtractionStatus =
  'success' | 'empty' | 'unsupported' | 'failed' | 'duplicate';

export type DocumentFailureKind =
  | 'timeout'
  | 'network'
  | 'http'
  | 'response'
  | 'content'
  | 'encrypted'
  | 'malformed'
  | 'extraction';

export const PDF_EXTRACTION_CACHE_VERSION = 'pdf-text-v1';

export interface ExtractedDocument {
  title: string;
  sourceFileId?: string;
  contentType?: string;
  sizeBytes?: number;
  pageCount?: number;
  text: string;
  preview: string;
  status: ExtractionStatus;
  sha256?: string;
  duplicateOfSha256?: string;
  isDuplicate: boolean;
  quality: 'good' | 'poor' | 'empty' | 'unknown';
  qualityScore: number;
  qualityReasons: string[];
  requiresCloudRecognition: boolean;
  failureKind?: DocumentFailureKind;
  retryable?: boolean;
  error?: string;
  extractionCacheVersion?: string;
}

export type DocumentExtractionSnapshot = Omit<
  ExtractedDocument,
  'title' | 'sourceFileId' | 'duplicateOfSha256' | 'isDuplicate'
>;
