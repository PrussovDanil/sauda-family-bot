export type ExtractionStatus =
  | 'success'
  | 'empty'
  | 'unsupported'
  | 'failed'
  | 'duplicate';

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
  error?: string;
}
