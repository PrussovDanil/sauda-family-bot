import { NestFactory } from '@nestjs/core';
import { DatabaseModule } from '../database/database.module';
import { PersistenceService } from '../database/persistence.service';
import { DocumentsService } from '../documents/documents.service';
import { SaudaService } from '../sauda/sauda.service';

async function bootstrap(): Promise<void> {
  const lotNumber = process.argv[2];
  if (!lotNumber) {
    throw new Error('Usage: pnpm sauda:store <lotNumber>');
  }

  const applicationContext = await NestFactory.createApplicationContext(
    DatabaseModule,
    { logger: false },
  );

  try {
    const saudaService = applicationContext.get(SaudaService);
    const documentsService = applicationContext.get(DocumentsService);
    const persistenceService = applicationContext.get(PersistenceService);
    const lot = await saudaService.getLot(lotNumber);
    const documents = await documentsService.processLotDocuments(lot);
    const result = persistenceService.saveLotAnalysis(lot, documents);

    console.log(
      JSON.stringify({
        lotNumber: lot.lotNumber,
        publicationId: lot.publicationId,
        lotId: result.lotId,
        documentsFound: result.documentsFound,
        uniqueDocuments: result.uniqueDocuments,
        newDocuments: result.newDocuments,
        reusedDocuments: result.reusedDocuments,
      }),
    );
  } finally {
    await applicationContext.close();
  }
}

bootstrap().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Lot storage failed');
  process.exitCode = 1;
});
