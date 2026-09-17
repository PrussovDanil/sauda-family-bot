import { join } from 'node:path';

export const DEFAULT_DATABASE_PATH = join(
  process.cwd(),
  'data',
  'sauda-family-bot.sqlite',
);

export const SQLITE_DATABASE_PATH = Symbol('SQLITE_DATABASE_PATH');
