import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { formatStartupError } from './startup-error';
import { TelegramService } from './telegram/telegram.service';

async function bootstrap(): Promise<void> {
  const applicationContext = await NestFactory.createApplicationContext(
    AppModule,
    { logger: ['error', 'warn'] },
  );
  applicationContext.enableShutdownHooks(['SIGINT', 'SIGTERM']);

  try {
    await applicationContext.get(TelegramService).start();
  } catch (error) {
    await applicationContext.close();
    throw error;
  }
}

void bootstrap().catch((error: unknown) => {
  console.error(`Application startup failed: ${formatStartupError(error)}`);
  process.exitCode = 1;
});
