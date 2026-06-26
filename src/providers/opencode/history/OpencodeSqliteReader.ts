import { spawnSync as defaultSpawnSync } from 'node:child_process';

import { findNodeExecutable } from '../../../utils/env';

export type StoredRow = Record<string, unknown>;

export interface StoredSessionRows {
  messageRows: StoredRow[];
  partRows: StoredRow[];
}

interface SqliteModule {
  DatabaseSync: new (location: string, options?: Record<string, unknown>) => {
    close(): void;
    prepare(sql: string): {
      all(...params: unknown[]): StoredRow[];
    };
  };
}

export interface OpencodeSqliteReaderDependencies {
  findNodeExecutable?: () => string | null;
  requireSqliteModule?: () => SqliteModule | null;
  spawnSync?: typeof defaultSpawnSync;
}

export const OPENCODE_SQLITE_QUERY_MAX_BUFFER = 100 * 1024 * 1024;
export const OPENCODE_MESSAGE_ROW_SQL = buildOpencodeMessageRowsSql('?');

const OPENCODE_PART_ROW_SQL = buildOpencodePartRowsSql('?');
const OPENCODE_SQLITE_CHILD_SCRIPT = `
const { DatabaseSync } = require('node:sqlite');
const [databasePath, sessionId, messageSql, partSql] = process.argv.slice(1);
let db;
try {
  db = new DatabaseSync(databasePath, { readonly: true });
  const messageRows = db.prepare(messageSql).all(sessionId);
  const partRows = db.prepare(partSql).all(sessionId);
  process.stdout.write(JSON.stringify({ messageRows, partRows }));
} finally {
  if (db) db.close();
}
`.trim();

export async function loadOpencodeSessionRows(
  databasePath: string,
  sessionId: string,
  dependencies: OpencodeSqliteReaderDependencies = {},
): Promise<StoredSessionRows | null> {
  const resolvedDependencies = resolveDependencies(dependencies);

  const viaCurrentProcess = loadSessionRowsWithCurrentProcessSqlite(
    databasePath,
    sessionId,
    resolvedDependencies.requireSqliteModule,
  );
  if (viaCurrentProcess) {
    return viaCurrentProcess;
  }

  const viaNodeProcess = loadSessionRowsWithNodeProcess(
    databasePath,
    sessionId,
    resolvedDependencies.findNodeExecutable,
    resolvedDependencies.spawnSync,
  );
  if (viaNodeProcess) {
    return viaNodeProcess;
  }

  return loadSessionRowsWithSqliteCli(
    databasePath,
    sessionId,
    resolvedDependencies.spawnSync,
  );
}

export interface OpencodeUsageAggregation {
  modelId: string;
  effort?: string;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cachedInputTokens?: number;
  totalTokens: number;
  contributionCount: number;
}

/**
 * Load and aggregate per-message token usage from the OpenCode SQLite database.
 * Returns null when the database cannot be read or no usage data is found.
 * Read-only — does not modify the database.
 */
export async function loadOpencodeSessionUsageAggregation(
  databasePath: string,
  sessionId: string,
  dependencies: OpencodeSqliteReaderDependencies = {},
): Promise<OpencodeUsageAggregation[] | null> {
  const rows = await loadOpencodeSessionRows(databasePath, sessionId, dependencies);
  if (!rows) return null;

  const aggregations = new Map<string, OpencodeUsageAggregation>();

  // Scan message rows for usage data in the JSON `data` column
  for (const row of rows.messageRows) {
    const data = parseRowData(row.data);
    if (!data) continue;

    const usage = data.usage;
    if (!usage || typeof usage !== 'object') continue;

    const u = usage as Record<string, unknown>;
    const inputTokens = typeof u.inputTokens === 'number' ? u.inputTokens : 0;
    const outputTokens = typeof u.outputTokens === 'number' ? u.outputTokens : 0;
    const thoughtTokens = typeof u.thoughtTokens === 'number' ? u.thoughtTokens : 0;
    const totalTokens = typeof u.totalTokens === 'number' ? u.totalTokens : 0;
    const cachedRead = typeof u.cachedReadTokens === 'number' ? u.cachedReadTokens : 0;

    if (inputTokens === 0 && outputTokens === 0 && totalTokens === 0) continue;

    const modelId = typeof data.model === 'string' ? data.model : 'unknown';
    const effort = typeof data.effort === 'string' ? data.effort : undefined;

    const key = `${modelId}\u0000${effort ?? ''}`;
    let agg = aggregations.get(key);
    if (!agg) {
      agg = {
        modelId,
        ...(effort ? { effort } : {}),
        inputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        totalTokens: 0,
        contributionCount: 0,
      };
      aggregations.set(key, agg);
    }
    agg.inputTokens += inputTokens;
    agg.outputTokens += outputTokens;
    agg.reasoningTokens += thoughtTokens;
    if (cachedRead > 0) {
      agg.cachedInputTokens = (agg.cachedInputTokens ?? 0) + cachedRead;
    }
    agg.totalTokens += totalTokens > 0 ? totalTokens : inputTokens + outputTokens + thoughtTokens;
    agg.contributionCount += 1;
  }

  // Also scan part rows for usage data (some schemas store it on parts)
  for (const row of rows.partRows) {
    const data = parseRowData(row.data);
    if (!data) continue;

    const usage = data.usage;
    if (!usage || typeof usage !== 'object') continue;

    const u = usage as Record<string, unknown>;
    const inputTokens = typeof u.inputTokens === 'number' ? u.inputTokens : 0;
    const outputTokens = typeof u.outputTokens === 'number' ? u.outputTokens : 0;
    if (inputTokens === 0 && outputTokens === 0) continue;

    const modelId = typeof data.model === 'string' ? data.model : 'unknown';
    const key = `${modelId}\u0000`;
    let agg = aggregations.get(key);
    if (!agg) {
      agg = {
        modelId,
        inputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        totalTokens: 0,
        contributionCount: 0,
      };
      aggregations.set(key, agg);
    }
    agg.inputTokens += inputTokens;
    agg.outputTokens += outputTokens;
    agg.totalTokens += inputTokens + outputTokens;
    agg.contributionCount += 1;
  }

  if (aggregations.size === 0) return null;
  return Array.from(aggregations.values());
}

function parseRowData(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  if (typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (isPlainObject(parsed)) return parsed as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  return null;
}

function resolveDependencies(
  dependencies: OpencodeSqliteReaderDependencies,
): Required<OpencodeSqliteReaderDependencies> {
  return {
    findNodeExecutable,
    requireSqliteModule,
    spawnSync: defaultSpawnSync,
    ...dependencies,
  };
}

function requireSqliteModule(): SqliteModule | null {
  try {
    if (typeof module === 'undefined' || typeof module.require !== 'function') {
      return null;
    }

    const sqlite = module.require('node:sqlite') as unknown;
    return isSqliteModule(sqlite) ? sqlite : null;
  } catch {
    return null;
  }
}

function isSqliteModule(value: unknown): value is SqliteModule {
  return (
    isPlainObject(value)
    && typeof value.DatabaseSync === 'function'
  );
}

function loadSessionRowsWithCurrentProcessSqlite(
  databasePath: string,
  sessionId: string,
  requireSqlite: () => SqliteModule | null,
): StoredSessionRows | null {
  const sqlite = requireSqlite();
  if (!sqlite) {
    return null;
  }

  let db: InstanceType<SqliteModule['DatabaseSync']> | null = null;
  try {
    db = new sqlite.DatabaseSync(databasePath, { readonly: true });
    const messageRows = db.prepare(OPENCODE_MESSAGE_ROW_SQL).all(sessionId);
    const partRows = db.prepare(OPENCODE_PART_ROW_SQL).all(sessionId);
    return { messageRows, partRows };
  } catch {
    return null;
  } finally {
    db?.close();
  }
}

function loadSessionRowsWithNodeProcess(
  databasePath: string,
  sessionId: string,
  findNode: () => string | null,
  spawnSync: typeof defaultSpawnSync,
): StoredSessionRows | null {
  const nodePath = findNode();
  if (!nodePath) {
    return null;
  }

  const result = spawnSync(
    nodePath,
    [
      '-e',
      OPENCODE_SQLITE_CHILD_SCRIPT,
      databasePath,
      sessionId,
      OPENCODE_MESSAGE_ROW_SQL,
      OPENCODE_PART_ROW_SQL,
    ],
    {
      encoding: 'utf8',
      maxBuffer: OPENCODE_SQLITE_QUERY_MAX_BUFFER,
      windowsHide: true,
    },
  );

  if (result.error || result.status !== 0) {
    return null;
  }

  return parseStoredSessionRows(getSpawnStdout(result.stdout));
}

function loadSessionRowsWithSqliteCli(
  databasePath: string,
  sessionId: string,
  spawnSync: typeof defaultSpawnSync,
): StoredSessionRows | null {
  const escapedSessionId = escapeSqlLiteral(sessionId);
  const messageRows = runSqlite3JsonQuery(
    databasePath,
    buildOpencodeMessageRowsSql(`'${escapedSessionId}'`),
    spawnSync,
  );
  const partRows = runSqlite3JsonQuery(
    databasePath,
    buildOpencodePartRowsSql(`'${escapedSessionId}'`),
    spawnSync,
  );

  if (!messageRows || !partRows) {
    return null;
  }

  return { messageRows, partRows };
}

function runSqlite3JsonQuery(
  databasePath: string,
  sql: string,
  spawnSync: typeof defaultSpawnSync,
): StoredRow[] | null {
  const result = spawnSync(
    'sqlite3',
    ['-json', databasePath, sql],
    {
      encoding: 'utf8',
      maxBuffer: OPENCODE_SQLITE_QUERY_MAX_BUFFER,
      windowsHide: true,
    },
  );

  if (result.error || result.status !== 0) {
    return null;
  }

  return parseStoredRows(getSpawnStdout(result.stdout));
}

function parseStoredSessionRows(value: string): StoredSessionRows | null {
  try {
    const parsed = JSON.parse(value || '{}') as unknown;
    if (!isPlainObject(parsed)) {
      return null;
    }

    const messageRows = parseStoredRowsValue(parsed.messageRows);
    const partRows = parseStoredRowsValue(parsed.partRows);
    return messageRows && partRows ? { messageRows, partRows } : null;
  } catch {
    return null;
  }
}

function parseStoredRows(value: string): StoredRow[] | null {
  try {
    return parseStoredRowsValue(JSON.parse(value || '[]') as unknown);
  } catch {
    return null;
  }
}

function parseStoredRowsValue(value: unknown): StoredRow[] | null {
  return Array.isArray(value)
    ? value.filter((row): row is StoredRow => isPlainObject(row))
    : null;
}

function getSpawnStdout(stdout: string | Buffer | null | undefined): string {
  return typeof stdout === 'string'
    ? stdout
    : stdout?.toString('utf8') ?? '';
}

function escapeSqlLiteral(value: string): string {
  return value.replaceAll('\'', '\'\'');
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function buildOpencodeMessageRowsSql(sessionIdExpression: string): string {
  return `
with message_json as (
  select
    id,
    time_created,
    data,
    json_valid(data) as data_valid
  from message
  where session_id = ${sessionIdExpression}
)
select
  id,
  time_created,
  data_valid,
  case when data_valid then json_extract(data, '$.role') end as role,
  case when data_valid then json_extract(data, '$.time.created') end as data_time_created,
  case when data_valid then json_extract(data, '$.time.completed') end as data_time_completed
from message_json
order by time_created asc, id asc;`.trim();
}

function buildOpencodePartRowsSql(sessionIdExpression: string): string {
  return `
select id, message_id, data
from part
where session_id = ${sessionIdExpression}
order by message_id asc, id asc;`.trim();
}
