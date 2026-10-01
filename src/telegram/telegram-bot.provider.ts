import type { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Bot } from 'grammy';
import { TELEGRAM_BOT } from './telegram.constants';

export const telegramBotProvider: Provider = {
  provide: TELEGRAM_BOT,
  inject: [ConfigService],
  useFactory: (configService: ConfigService): Bot => {
    const token = configService.get<string>('TELEGRAM_BOT_TOKEN')?.trim();
    if (!token) {
      throw new Error('TELEGRAM_BOT_TOKEN is required');
    }
    return new Bot(token);
  },
};
