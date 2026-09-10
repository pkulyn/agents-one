import BetterSqlite3 from "better-sqlite3";
import { DatabaseSync, type StatementSync } from "node:sqlite";

interface DatabaseOptions {
  readonly?: boolean;
}

function isNativeModuleCompatibilityError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /NODE_MODULE_VERSION|ERR_DLOPEN_FAILED|better_sqlite3\.node/i.test(
    message,
  );
}

class BuiltinStatement {
  constructor(private readonly statement: StatementSync) {}

  all(...params: unknown[]): unknown[] {
    return (
      this.statement.all as unknown as (...values: unknown[]) => unknown[]
    ).apply(this.statement, params);
  }

  get(...params: unknown[]): unknown {
    return (
      this.statement.get as unknown as (...values: unknown[]) => unknown
    ).apply(this.statement, params);
  }

  run(...params: unknown[]): {
    changes: number;
    lastInsertRowid: number | bigint;
  } {
    const result = (
      this.statement.run as unknown as (...values: unknown[]) => {
        changes: number | bigint;
        lastInsertRowid: number | bigint;
      }
    ).apply(this.statement, params);
    return {
      changes: Number(result.changes),
      lastInsertRowid: result.lastInsertRowid,
    };
  }
}

class BuiltinDatabase {
  private readonly database: DatabaseSync;

  constructor(filename: string, options: DatabaseOptions = {}) {
    this.database = new DatabaseSync(filename, {
      readOnly: options.readonly === true,
      enableForeignKeyConstraints: true,
    });
  }

  close(): void {
    this.database.close();
  }

  exec(sql: string): void {
    this.database.exec(sql);
  }

  prepare(sql: string): BuiltinStatement {
    return new BuiltinStatement(this.database.prepare(sql));
  }

  transaction<TArgs extends unknown[], TResult>(
    fn: (...args: TArgs) => TResult,
  ): (...args: TArgs) => TResult {
    return (...args: TArgs): TResult => {
      this.database.exec("BEGIN");
      try {
        const result = fn(...args);
        this.database.exec("COMMIT");
        return result;
      } catch (error) {
        try {
          this.database.exec("ROLLBACK");
        } catch {
          // Preserve the original transaction failure.
        }
        throw error;
      }
    };
  }
}

class CompatibleDatabaseFactory {
  constructor(filename: string, options: DatabaseOptions = {}) {
    if (process.env.HERMES_FORCE_BUILTIN_SQLITE !== "1") {
      try {
        return new BetterSqlite3(filename, options);
      } catch (error) {
        if (!isNativeModuleCompatibilityError(error)) throw error;
        console.warn(
          "[sqlite] better-sqlite3 is incompatible with this Electron runtime; using node:sqlite.",
        );
      }
    }
    return new BuiltinDatabase(
      filename,
      options,
    ) as unknown as BetterSqlite3.Database;
  }
}

type CompatibleDatabaseConstructor = new (
  filename: string,
  options?: DatabaseOptions,
) => BetterSqlite3.Database;

const CompatibleDatabase =
  CompatibleDatabaseFactory as unknown as CompatibleDatabaseConstructor;

export default CompatibleDatabase;
