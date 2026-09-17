import { NestFactory } from '@nestjs/core';
import { DocumentsModule } from '../documents/documents.module';
import { DocumentsService } from '../documents/documents.service';
import { SaudaService } from '../sauda/sauda.service';

async function bootstrap(): Promise<void> {
  const lotNumber = process.argv[2];
  if (!lotNumber) {
    throw new Error('Usage: pnpm sauda:documents <lotNumber>');
  }

  const applicationContext = await NestFactory.createApplicationContext(
    DocumentsModule,
    { logger: false },
  );

  try {
    const saudaService = applicationContext.get(SaudaService);
    const documentsService = applicationContext.get(DocumentsService);
    const lot = await saudaService.getLot(lotNumber);
    console.log(`Found documents: ${lot.documents.length}`);

    const documents = await documentsService.processLotDocuments(lot);

    for (const document of documents) {
      console.log(
        JSON.stringify(
          {
            title: document.title,
            sourceFileId: document.sourceFileId,
            contentType: document.contentType,
            sizeBytes: document.sizeBytes,
            pageCount: document.pageCount,
            status: document.status,
            ...(document.sha256 ? { sha256: document.sha256.slice(0, 12) } : {}),
            isDuplicate: document.isDuplicate,
            ...(document.duplicateOfSha256
              ? { duplicateOf: document.duplicateOfSha256.slice(0, 12) }
              : {}),
            quality: document.quality,
            qualityScore: document.qualityScore,
            qualityReasons: document.qualityReasons,
            requiresCloudRecognition: document.requiresCloudRecognition,
            preview: document.preview,
            ...(document.error ? { error: document.error } : {}),
          },
          null,
          2,
        ),
      );
    }

    console.log(
      JSON.stringify({
        documentsFound: documents.length,
        uniqueDocuments: documents.filter((document) => !document.isDuplicate)
          .length,
        duplicateDocuments: documents.filter((document) => document.isDuplicate)
          .length,
        requiresCloudRecognition: documents.filter(
          (document) => document.requiresCloudRecognition,
        ).length,
      }),
    );
  } finally {
    await applicationContext.close();
  }
}

bootstrap().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Document processing failed');
  process.exitCode = 1;
});
