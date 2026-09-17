import { Injectable, OnModuleInit } from '@nestjs/common';
import { DatabaseService } from '../database.service';
import { MigrationError } from '../errors/migration.error';
import { migrations } from './migrations';

@Injectable()
export class MigrationRunnerService implements OnModuleInit {
  constructor(private readonly databaseService: DatabaseService) {}

  onModuleInit(): void {
    const database = this.databaseService.connection;
    database.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
    `);

    for (const migration of migrations) {
      const applied = database
        .prepare('SELECT 1 FROM schema_migrations WHERE version = ?')
        .get(migration.version);
      if (applied) {
        continue;
      }

      try {
        this.databaseService.transaction(() => {
          migration.up(database);
          database
            .prepare(
              'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)',
            )
            .run(migration.version, migration.name, new Date().toISOString());
        });
      } catch (error) {
        throw new MigrationError(`Could not apply migration ${migration.version}`, {
          cause: error,
        });
      }
    }
  }
}
