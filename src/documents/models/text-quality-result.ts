export interface TextQualityResult {
  quality: 'good' | 'poor' | 'empty' | 'unknown';
  score: number;
  reasons: string[];
  requiresCloudRecognition: boolean;
  metrics: {
    textLength: number;
    charactersPerPage?: number;
    replacementCharacterRatio: number;
    controlCharacterRatio: number;
    singleCharacterLineRatio: number;
    readableWordRatio: number;
  };
}
