export interface ExtractedDocument {
  title: string;
  sourceFileId?: string;
  contentType?: string;
  sizeBytes?: number;
  pageCount?: number;
  text: string;
  preview: string;
  status: 'success' | 'empty' | 'unsupported' | 'failed';
  quality: 'good' | 'poor' | 'empty' | 'unknown';
  qualityScore: number;
  qualityReasons: string[];
  requiresCloudRecognition: boolean;
  error?: string;
}
