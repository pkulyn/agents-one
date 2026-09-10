import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

function verifySqlite(label) {
  const Database = require("better-sqlite3");
  const db = new Database(":memory:");
  try {
    const row = db.prepare("select sqlite_version() as version").get();
    if (!row?.version)
      throw new Error(`${label} did not return a SQLite version`);
    return row.version;
  } finally {
    db.close();
  }
}

const nodeSqlite = verifySqlite("Node.js");
const electronPath = require("electron");
const probe = spawnSync(
  electronPath,
  [
    "-e",
    "const Database=require('better-sqlite3');const db=new Database(':memory:');try{const row=db.prepare('select sqlite_version() as version').get();if(!row?.version)throw new Error('missing SQLite version');console.log(JSON.stringify({electron:process.versions.electron,node:process.version,sqlite:row.version}))}finally{db.close()}",
  ],
  {
    encoding: "utf8",
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    windowsHide: true,
  },
);

if (probe.status !== 0) {
  throw new Error(
    `Electron runtime dependency probe failed (${probe.status}): ${probe.stderr.trim()}`,
  );
}

console.log(
  JSON.stringify({
    node: process.version,
    nodeSqlite,
    electron: JSON.parse(probe.stdout.trim()),
  }),
);
