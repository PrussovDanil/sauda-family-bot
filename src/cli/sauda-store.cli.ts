import { NestFactory } from '@nestjs/core';
import { IngestionModule } from '../ingestion/ingestion.module';
import { IngestionService } from '../ingestion/ingestion.service';
import { createStoreOutput, getStoreExitCode } from './sauda-store-output';

async function bootstrap(): Promise<void> {
  const lotNumber = process.argv[2];
  if (!lotNumber) {
    throw new Error('Usage: pnpm sauda:store <lotNumber>');
  }

  const applicationContext = await NestFactory.createApplicationContext(
    IngestionModule,
    { logger: false },
  );

  try {
    const ingestionService = applicationContext.get(IngestionService);
    const { lot, result } = await ingestionService.ingestLot(lotNumber);

    console.log(JSON.stringify(createStoreOutput(lot, result)));
    process.exitCode = getStoreExitCode(result);
  } finally {
    await applicationContext.close();
  }
}

bootstrap().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Lot storage failed');
  process.exitCode = 1;
});
