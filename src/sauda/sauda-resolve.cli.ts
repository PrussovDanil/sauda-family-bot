import { NestFactory } from '@nestjs/core';
import { SaudaLotResolverService } from './sauda-lot-resolver.service';
import { SaudaModule } from './sauda.module';

async function bootstrap(): Promise<void> {
  const lotNumber = process.argv[2];

  if (!lotNumber) {
    throw new Error('Usage: npm run sauda:resolve -- <lotNumber>');
  }

  const applicationContext = await NestFactory.createApplicationContext(
    SaudaModule,
    { logger: false },
  );

  try {
    const resolver = applicationContext.get(SaudaLotResolverService);
    const reference = await resolver.resolve(lotNumber);
    console.log(JSON.stringify(reference, null, 2));
  } finally {
    await applicationContext.close();
  }
}

bootstrap().catch((error: unknown) => {
  void error;
  process.exitCode = 1;
});
