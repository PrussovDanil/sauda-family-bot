import { jest } from '@jest/globals';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import type { Bot } from 'grammy';
import { AppModule } from '../src/app.module';
import { SQLITE_DATABASE_PATH } from '../src/database/database.constants';
import { DatabaseService } from '../src/database/database.service';
import { TELEGRAM_BOT } from '../src/telegram/telegram.constants';
import { TelegramService } from '../src/telegram/telegram.service';

describe('AppModule application context (e2e)', () => {
  it('starts and stops long polling without HTTP or the working SQLite database', async () => {
    let finishPolling: (() => void) | undefined;
    const bot = {
      command: jest.fn(),
      on: jest.fn(),
      catch: jest.fn(),
      start: jest.fn(
        () =>
          new Promise<void>((resolve) => {
            finishPolling = resolve;
          }),
      ),
      stop: jest.fn(async () => finishPolling?.()),
    };
    let applicationContext: TestingModule | undefined;

    try {
      applicationContext = await Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(SQLITE_DATABASE_PATH)
        .useValue(':memory:')
        .overrideProvider(TELEGRAM_BOT)
        .useValue(bot as unknown as Bot)
        .compile();
      await applicationContext.init();

      const database = applicationContext.get(DatabaseService);
      const polling = applicationContext.get(TelegramService).start();
      await Promise.resolve();

      expect(bot.start).toHaveBeenCalledTimes(1);
      expect(bot.command).toHaveBeenCalledWith('start', expect.any(Function));
      expect(bot.on).toHaveBeenCalledWith('message:text', expect.any(Function));

      await applicationContext.close();
      applicationContext = undefined;
      await polling;

      expect(bot.stop).toHaveBeenCalledTimes(1);
      expect(() => database.connection).toThrow(
        'SQLite database has not been initialized',
      );
    } finally {
      await applicationContext?.close();
    }
  });
});
