import { Module } from '@nestjs/common';
import { AnalysisModule } from '../analysis/analysis.module';
import { IngestionModule } from '../ingestion/ingestion.module';
import { telegramBotProvider } from './telegram-bot.provider';
import { TelegramService } from './telegram.service';

@Module({
  imports: [IngestionModule, AnalysisModule],
  providers: [telegramBotProvider, TelegramService],
  exports: [TelegramService],
})
export class TelegramModule {}
