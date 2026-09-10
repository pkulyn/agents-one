import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { afterEach, describe, expect, it } from "vitest";
import Database from "../src/main/sqlite";

describe("SQLite compatibility backend", () => {
  const dirs: string[] = [];

  afterEach(() => {
    delete process.env.HERMES_FORCE_BUILTIN_SQLITE;
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("supports the synchronous query and transaction surface used by main", () => {
    process.env.HERMES_FORCE_BUILTIN_SQLITE = "1";
    const dir = mkdtempSync(join(tmpdir(), "hermes-sqlite-"));
    dirs.push(dir);
    const db = new Database(join(dir, "state.db"));
    try {
      db.exec(
        "CREATE TABLE items (id INTEGER PRIMARY KEY, value TEXT NOT NULL)",
      );
      const insert = db.prepare("INSERT INTO items (value) VALUES (?)");
      const tx = db.transaction((values: string[]) => {
        for (const value of values) insert.run(value);
      });
      tx(["one", "two"]);

      expect(db.prepare("SELECT value FROM items ORDER BY id").all()).toEqual([
        { value: "one" },
        { value: "two" },
      ]);
    } finally {
      db.close();
    }
  });
});
