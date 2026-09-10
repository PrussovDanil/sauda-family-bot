import { NestFactory } from '@nestjs/core';
import { redactDocumentUrl } from '../models/sauda-lot';
import { SaudaModule } from '../sauda.module';
import { SaudaService } from '../sauda.service';

async function bootstrap(): Promise<void> {
  const lotNumber = process.argv[2];
  if (!lotNumber) {
    throw new Error('Usage: pnpm sauda:lot <lotNumber>');
  }

  const applicationContext = await NestFactory.createApplicationContext(
    SaudaModule,
    { logger: false },
  );

  try {
    const saudaService = applicationContext.get(SaudaService);
    const lot = await saudaService.getLot(lotNumber);
    console.log(
      JSON.stringify(
        {
          ...lot,
          documents: lot.documents.map((document) => ({
            ...document,
            url: redactDocumentUrl(document.url),
          })),
        },
        null,
        2,
      ),
    );
  } finally {
    await applicationContext.close();
  }
}

bootstrap().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
