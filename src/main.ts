import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { TelegramService } from './telegram/telegram.service';

async function bootstrap(): Promise<void> {
  const applicationContext = await NestFactory.createApplicationContext(
    AppModule,
    { logger: ['error', 'warn'] },
  );
  applicationContext.enableShutdownHooks(['SIGINT', 'SIGTERM']);

  try {
    await applicationContext.get(TelegramService).start();
  } catch {
    await applicationContext.close();
    throw new Error('Application startup failed');
  }
}

void bootstrap().catch(() => {
  console.error('Application startup failed');
  process.exitCode = 1;
});
