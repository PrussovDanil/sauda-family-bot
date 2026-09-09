import { NestFactory } from '@nestjs/core';
import { SaudaModule } from './sauda.module';
import { SaudaService } from './sauda.service';

async function bootstrap(): Promise<void> {
  const lotNumber = process.argv[2];
  if (!lotNumber) {
    throw new Error('Usage: npm run sauda:lot -- <lotNumber>');
  }

  const applicationContext = await NestFactory.createApplicationContext(
    SaudaModule,
    { logger: false },
  );

  try {
    const saudaService = applicationContext.get(SaudaService);
    console.log(JSON.stringify(await saudaService.getLot(lotNumber), null, 2));
  } finally {
    await applicationContext.close();
  }
}

bootstrap().catch((error: unknown) => {
  void error;
  process.exitCode = 1;
});
