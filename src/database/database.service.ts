import { Inject, Injectable, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { DatabaseSync } from 'node:sqlite';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import {
  DEFAULT_DATABASE_PATH,
  SQLITE_DATABASE_PATH,
} from './database.constants';
import { DatabaseError } from './errors/database.error';

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private database?: DatabaseSync;

  private readonly databasePath: string;

  constructor(
    @Optional() @Inject(SQLITE_DATABASE_PATH) databasePath?: string,
  ) {
    this.databasePath =
      databasePath ?? process.env.SQLITE_DATABASE_PATH ?? DEFAULT_DATABASE_PATH;
  }

  onModuleInit(): void {
    if (this.database) {
      return;
    }

    try {
      if (this.databasePath !== ':memory:') {
        mkdirSync(dirname(this.databasePath), { recursive: true });
      }
      this.database = new DatabaseSync(this.databasePath);
      this.database.exec('PRAGMA foreign_keys = ON;');
      this.database.exec('PRAGMA journal_mode = WAL;');
      this.database.exec('PRAGMA busy_timeout = 5000;');
    } catch (error) {
      throw new DatabaseError('Could not open SQLite database', { cause: error });
    }
  }

  onModuleDestroy(): void {
    this.database?.close();
    this.database = undefined;
  }

  get connection(): DatabaseSync {
    if (!this.database) {
      throw new DatabaseError('SQLite database has not been initialized');
    }
    return this.database;
  }

  transaction<T>(operation: () => T): T {
    const database = this.connection;
    database.exec('BEGIN IMMEDIATE');
    try {
      const result = operation();
      database.exec('COMMIT');
      return result;
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  }
}
