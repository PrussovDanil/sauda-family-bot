import { Module } from '@nestjs/common';
import { SaudaModule } from '../sauda/sauda.module';
import { DocumentDownloaderService } from './downloader/document-downloader.service';
import { DocumentsService } from './documents.service';
import { PdfTextExtractorService } from './extractors/pdf-text-extractor.service';
import { DocumentTextQualityService } from './quality/document-text-quality.service';

@Module({
  imports: [SaudaModule],
  providers: [
    DocumentDownloaderService,
    DocumentTextQualityService,
    PdfTextExtractorService,
    DocumentsService,
  ],
  exports: [DocumentsService],
})
export class DocumentsModule {}
