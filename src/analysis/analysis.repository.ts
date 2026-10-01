import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class AnalysisRepository {
  constructor(private readonly databaseService: DatabaseService) {}

  find(cacheKey: string): string | undefined {
    const row = this.databaseService.connection
      .prepare(
        'SELECT result_json FROM cloud_analysis_cache WHERE cache_key = ?',
      )
      .get(cacheKey) as { result_json: string } | undefined;
    return row?.result_json;
  }

  save(
    cacheKey: string,
    model: string,
    promptVersion: string,
    resultJson: string,
  ): void {
    this.databaseService.connection
      .prepare(
        `INSERT INTO cloud_analysis_cache (
          cache_key, model, prompt_version, result_json, created_at
        ) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(cache_key) DO UPDATE SET
          result_json = excluded.result_json,
          created_at = excluded.created_at`,
      )
      .run(
        cacheKey,
        model,
        promptVersion,
        resultJson,
        new Date().toISOString(),
      );
  }
}
