import { createHash } from "crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import * as tar from "tar";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "../src/main/sqlite";

import {
  AGENTS_ONE_BACKUP_SCHEMA_VERSION,
  collectAgentsOneBackupFiles,
  exportAgentsOneBackupTo,
  inspectAgentsOneBackup,
  recoverInterruptedAgentsOneRestore,
  restoreAgentsOneBackupFrom,
  sanitizeDesktopConfig,
} from "../src/main/agents-one-backup";

let testRoot: string;
let sourceHome: string;
let targetHome: string;

function writeFixture(relativePath: string, value: string | Buffer): void {
  const path = join(sourceHome, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value);
}

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

interface TestBackupManifest {
  files: Array<{ path: string; size: number; sha256: string }>;
}

async function rewriteBackupPayload(
  sourceArchive: string,
  destinationArchive: string,
  relativePath: string,
  value: string | Buffer,
): Promise<void> {
  const unpacked = mkdtempSync(join(testRoot, "rewrite-backup-"));
  await tar.extract({ cwd: unpacked, file: sourceArchive });
  const payloadPath = join(unpacked, "payload", ...relativePath.split("/"));
  mkdirSync(dirname(payloadPath), { recursive: true });
  writeFileSync(payloadPath, value);

  const manifestPath = join(unpacked, "manifest.json");
  const manifest = readJson(manifestPath) as unknown as TestBackupManifest;
  const entry = manifest.files.find((file) => file.path === relativePath);
  if (!entry) throw new Error(`Missing backup manifest entry: ${relativePath}`);
  entry.size = readFileSync(payloadPath).length;
  entry.sha256 = sha256(payloadPath);
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  await tar.create(
    {
      cwd: unpacked,
      file: destinationArchive,
      gzip: true,
      portable: true,
    },
    ["manifest.json", "payload"],
  );
}

function createStateDatabase(relativePath: string, marker: string): void {
  const path = join(sourceHome, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  const database = new Database(path);
  try {
    database.exec(
      "CREATE TABLE backup_fixture (id INTEGER PRIMARY KEY, marker TEXT NOT NULL)",
    );
    database
      .prepare("INSERT INTO backup_fixture (marker) VALUES (?)")
      .run(marker);
  } finally {
    database.close();
  }
}

function readStateMarker(path: string): string {
  const database = new Database(path, { readonly: true });
  try {
    const row = database
      .prepare("SELECT marker FROM backup_fixture ORDER BY id LIMIT 1")
      .get() as { marker: string };
    return row.marker;
  } finally {
    database.close();
  }
}

function stagedImageAttachmentPath(home: string): string {
  return join(home, "desktop-staging", "native-1", "image.png");
}

function stagedImageContinuation(home: string): Array<Record<string, unknown>> {
  return [
    {
      kind: "user",
      content: `请查看附件，原路径为 ${stagedImageAttachmentPath(home)}`,
      attachments: [
        {
          id: "staged-native-image",
          kind: "image",
          name: "image.png",
          mime: "image/png",
          size: Buffer.from("image-fixture").length,
          path: stagedImageAttachmentPath(home),
        },
      ],
    },
  ];
}

function readContinuationAttachmentPath(databasePath: string): string {
  const database = new Database(databasePath, { readonly: true });
  try {
    const row = database
      .prepare(
        "SELECT prefix_json FROM desktop_session_continuations WHERE session_id = ?",
      )
      .get("native-1") as { prefix_json: string };
    const continuation = JSON.parse(row.prefix_json) as Array<{
      attachments?: Array<{ path?: string }>;
    }>;
    return continuation[0]?.attachments?.[0]?.path || "";
  } finally {
    database.close();
  }
}

function readContinuationContent(databasePath: string): string {
  const database = new Database(databasePath, { readonly: true });
  try {
    const row = database
      .prepare(
        "SELECT prefix_json FROM desktop_session_continuations WHERE session_id = ?",
      )
      .get("native-1") as { prefix_json: string };
    const continuation = JSON.parse(row.prefix_json) as Array<{
      content?: string;
    }>;
    return continuation[0]?.content || "";
  } finally {
    database.close();
  }
}

function readOverlayAttachmentPath(home: string): string {
  const overlay = readJson(join(home, "desktop/session-overlays.json")) as {
    sessions?: Record<
      string,
      Array<{ attachments?: Array<{ path?: string }> }>
    >;
  };
  return overlay.sessions?.["native-1"]?.[0]?.attachments?.[0]?.path || "";
}

function readOverlayContent(home: string): string {
  const overlay = readJson(join(home, "desktop/session-overlays.json")) as {
    sessions?: Record<string, Array<{ content?: string }>>;
  };
  return overlay.sessions?.["native-1"]?.[0]?.content || "";
}

function writeRestoreTransactionFixture(
  phase: "prepared" | "committed",
  affectedPaths: string[],
  existingPaths: string[],
): string {
  const transactionRoot = join(targetHome, ".restore-transaction");
  mkdirSync(join(transactionRoot, "snapshot"), { recursive: true });
  writeFileSync(
    join(transactionRoot, "journal.json"),
    `${JSON.stringify(
      { version: 1, phase, affectedPaths, existingPaths },
      null,
      2,
    )}\n`,
  );
  return transactionRoot;
}

function seedAgentsOneHome(): void {
  writeFixture(
    "desktop.json",
    JSON.stringify({
      connectionMode: "remote",
      remoteUrl: "https://agents.example.test/api",
      unsafeRemoteUrl:
        "https://user:password@unsafe.example.test/api?token=query-secret",
      remoteApiKey: "desktop-api-key-canary",
      remoteDashboardToken: "dashboard-token-canary",
      futureCredential: "root-secret-canary",
      Authorization: "Bearer authorization-secret-canary",
      sessionToken: "session-token-canary",
      apiServerKey: "api-server-key-canary",
      locale: "zh-CN",
      futureSafeSetting: { enabled: true },
      agentRuntimes: [
        {
          id: "codex-local",
          name: "Codex 本地",
          kind: "codex",
          location: "local",
          enabled: true,
          config: { transport: "cli" },
        },
        {
          id: "family-relay",
          name: "家庭 Relay",
          kind: "pi",
          location: "remote",
          enabled: true,
          config: {
            transport: "http",
            endpoint:
              "https://user:password@relay.example.test/agents-one/v1?sig=secret",
            bearerToken: "nested-token-canary",
          },
        },
      ],
      agentRuntimeAppearances: {
        "codex-local": {
          name: "Codex 实施",
          color: "#123456",
          avatar: "data:image/png;base64,YXZhdGFy",
        },
      },
    }),
  );
  writeFixture("active_profile", "research\n");
  writeFixture(
    "models.json",
    JSON.stringify([
      {
        id: "model-1",
        name: "自定义模型",
        provider: "custom",
        model: "model-1",
        baseUrl: "https://models.example.test/v1",
        unsafeBaseUrl: "https://user:password@models.example.test/v1?sig=x",
        futureApiKey: "model-secret-canary",
        createdAt: 1,
      },
    ]),
  );
  writeFixture(
    "config.yaml",
    [
      "model:",
      '  provider: "custom"',
      '  default: "model-1"',
      '  base_url: "https://models.example.test/v1"',
      '  api_key: "yaml-model-secret-canary"',
      "  context_length: 64000",
      "memory:",
      '  provider: "local"',
      "network:",
      '  proxy: "http://proxy.example.test:8080"',
      '  unsafe_proxy: "http://user:password@proxy.example.test:8080"',
      "api_server:",
      '  token: "yaml-api-token-canary"',
      'API_SERVER_KEY: "legacy-server-key-canary"',
      'authorization: "bearer-canary"',
      'private_key: "private-key-canary"',
      "secrets:",
      '  provider: "command"',
      '  command: "vault-secret-command-canary"',
      "",
    ].join("\n"),
  );
  writeFixture(
    "profile-meta.json",
    JSON.stringify({ name: "默认智能体", color: "#654321" }),
  );
  createStateDatabase("state.db", "default-profile-state-db");
  const defaultState = new Database(join(sourceHome, "state.db"));
  try {
    defaultState.exec(`
      CREATE TABLE desktop_session_continuations (
        session_id TEXT PRIMARY KEY,
        prefix_json TEXT NOT NULL,
        created_at REAL NOT NULL DEFAULT (strftime('%s', 'now')),
        updated_at REAL NOT NULL DEFAULT (strftime('%s', 'now'))
      )
    `);
    defaultState
      .prepare(
        "INSERT INTO desktop_session_continuations (session_id, prefix_json) VALUES (?, ?)",
      )
      .run("native-1", JSON.stringify(stagedImageContinuation(sourceHome)));
  } finally {
    defaultState.close();
  }
  writeFixture(
    "desktop/project-folders.json",
    JSON.stringify({
      folders: [
        {
          path: "D:\\Projects\\Alpha",
          name: "核心项目",
          pinned: true,
        },
      ],
    }),
  );
  writeFixture(
    "desktop/runtime-conversations.json",
    JSON.stringify({
      conversations: [
        {
          id: "runtime-conv-1",
          title: "备份恢复测试",
          runtimeId: "codex-local",
          runtimeName: "Codex 实施",
          runtimeKind: "codex",
          runtimeLocation: "local",
          workspace: "D:\\Projects\\Alpha",
          activeRuntimeRunId: "source-runtime-run",
          messages: [
            { id: "u1", role: "user", content: "请检查项目", createdAt: 1 },
            { id: "a1", role: "agent", content: "检查完成", createdAt: 2 },
          ],
          updatedAt: 2,
        },
      ],
    }),
  );
  writeFixture(
    "desktop/quick-chats.json",
    JSON.stringify({
      version: 1,
      chats: [
        {
          id: "quick-chat-1",
          title: "轻量聊天",
          runtimeId: "codex-local",
          runtimeName: "Codex 实施",
          createdAt: 1,
          updatedAt: 2,
          messages: [
            { id: "q1", role: "user", content: "快速问答", createdAt: 1 },
            { id: "q2", role: "agent", content: "快速回复", createdAt: 2 },
          ],
        },
      ],
    }),
  );
  writeFixture(
    "desktop/task-collaborations.json",
    JSON.stringify({
      version: 1,
      records: [
        {
          taskId: "runtime-conv-1",
          title: "备份恢复测试",
          assignments: [
            { id: "implement", role: "实施", runtimeId: "codex-local" },
          ],
        },
      ],
    }),
  );
  writeFixture(
    "desktop/task-schedules.json",
    JSON.stringify({
      version: 5,
      schedules: [
        {
          id: "schedule-1",
          title: "迁移后不得自动执行",
          enabled: true,
          pendingRuns: 3,
          activeRuntimeRunId: "source-schedule-run",
        },
      ],
    }),
  );
  writeFixture(
    "desktop/archives.json",
    JSON.stringify({
      version: 1,
      items: [
        {
          id: "task:archived-1",
          kind: "task",
          targetId: "archived-1",
          title: "已归档任务",
          archivedAt: 3,
        },
      ],
    }),
  );
  writeFixture(
    "desktop/remote-session-cache.json",
    JSON.stringify({ version: 1, sessions: [{ id: "remote-1" }] }),
  );
  writeFixture(
    "desktop/sessions.json",
    JSON.stringify({ sessions: [{ id: "native-1", title: "原生对话" }] }),
  );
  writeFixture(
    "desktop/session-overlays.json",
    JSON.stringify({
      sessions: { "native-1": stagedImageContinuation(sourceHome) },
    }),
  );
  // Retired stores remain user-owned recovery evidence. Backup treats them as
  // opaque files without making the current app depend on their schemas.
  writeFixture(
    "desktop/task-center.json",
    JSON.stringify({ version: 5, tasks: [{ id: "legacy-task-1" }] }),
  );
  writeFixture(
    "desktop/project-control.json",
    JSON.stringify({ version: 1, projects: [{ id: "legacy-project-1" }] }),
  );
  writeFixture("desktop/runtime-inputs/input-1/spec.txt", "fixture evidence");
  writeFixture(
    "desktop/pi-sessions/pi-1/session.jsonl",
    '{"type":"message"}\n',
  );
  writeFixture(
    "desktop-staging/native-1/image.png",
    Buffer.from("image-fixture"),
  );

  writeFixture(
    "profiles/research/profile-meta.json",
    JSON.stringify({ name: "研究智能体", color: "#abcdef" }),
  );
  createStateDatabase("profiles/research/state.db", "named-profile-state-db");
  writeFixture(
    "profiles/research/config.yaml",
    [
      "model:",
      '  provider: "openrouter"',
      '  default: "research-model"',
      "  context_length: 32000",
      "network:",
      "  force_ipv4: true",
      "",
    ].join("\n"),
  );
  writeFixture(
    "profiles/research/desktop/runtime-conversations.json",
    JSON.stringify({ conversations: [{ id: "research-conv", messages: [] }] }),
  );
  writeFixture(
    "profiles/research/desktop/project-folders.json",
    JSON.stringify({ folders: [{ path: "D:\\Research", name: "研究项目" }] }),
  );

  // Credentials and volatile Hermes engine data must never enter an Agents One
  // migration archive. The canaries make accidental inclusion easy to detect.
  writeFixture(".env", "OPENAI_API_KEY=env-secret-canary\n");
  writeFixture(
    "auth.json",
    JSON.stringify({ access_token: "oauth-secret-canary" }),
  );
  writeFixture(
    "profiles/research/.env",
    "API_SERVER_KEY=profile-secret-canary\n",
  );
  writeFixture("logs/gateway.log", "Authorization: Bearer log-secret-canary\n");
}

beforeEach(() => {
  testRoot = mkdtempSync(join(tmpdir(), "agents-one-backup-"));
  sourceHome = join(testRoot, "source home 中文");
  targetHome = join(testRoot, "target home 中文");
  mkdirSync(sourceHome, { recursive: true });
  mkdirSync(targetHome, { recursive: true });
  seedAgentsOneHome();
});

afterEach(() => {
  rmSync(testRoot, { recursive: true, force: true });
});

describe("Agents One backup inventory", () => {
  it("collects current desktop/profile data without credentials or logs", () => {
    const serialized = JSON.stringify(collectAgentsOneBackupFiles(sourceHome))
      .replace(/\\\\/g, "/")
      .toLowerCase();

    // The raw desktop.json is deliberately not returned here; export adds a
    // separately materialized, sanitized copy after collection.
    expect(serialized).not.toContain("desktop.json");
    expect(serialized).toContain("active_profile");
    expect(serialized).toContain("state.db");
    expect(serialized).toContain("desktop/project-folders.json");
    expect(serialized).toContain("desktop/runtime-conversations.json");
    expect(serialized).toContain("desktop/task-collaborations.json");
    expect(serialized).toContain("desktop/task-schedules.json");
    expect(serialized).toContain("desktop/archives.json");
    expect(serialized).toContain("desktop/task-center.json");
    expect(serialized).toContain("desktop/project-control.json");
    expect(serialized).toContain("desktop/runtime-inputs/input-1/spec.txt");
    expect(serialized).toContain("desktop-staging/native-1/image.png");
    expect(serialized).toContain("profiles/research/profile-meta.json");
    expect(serialized).toContain("profiles/research/state.db");

    expect(serialized).not.toContain(".env");
    expect(serialized).not.toContain("auth.json");
    expect(serialized).not.toContain("logs/gateway.log");
    expect(serialized).not.toContain(".agents-one-backup");
  });

  it("exposes a positive integer schema version", () => {
    expect(Number.isInteger(AGENTS_ONE_BACKUP_SCHEMA_VERSION)).toBe(true);
    expect(AGENTS_ONE_BACKUP_SCHEMA_VERSION).toBeGreaterThan(0);
  });
});

describe("Agents One desktop configuration sanitization", () => {
  it("preserves runtime appearance and unknown safe settings without mutating the input", () => {
    const input = readJson(join(sourceHome, "desktop.json"));
    const original = JSON.stringify(input);
    const sanitized = sanitizeDesktopConfig(input) as Record<string, unknown>;
    const serialized = JSON.stringify(sanitized);

    expect(input).toEqual(JSON.parse(original));
    expect(sanitized).toMatchObject({
      connectionMode: "remote",
      remoteUrl: "https://agents.example.test/api",
      locale: "zh-CN",
      futureSafeSetting: { enabled: true },
      agentRuntimeAppearances: {
        "codex-local": {
          name: "Codex 实施",
          color: "#123456",
          avatar: "data:image/png;base64,YXZhdGFy",
        },
      },
    });
    expect(serialized).toContain("codex-local");
    expect(serialized).toContain("family-relay");
    expect(serialized).not.toContain("desktop-api-key-canary");
    expect(serialized).not.toContain("dashboard-token-canary");
    expect(serialized).not.toContain("nested-token-canary");
    expect(serialized).not.toContain("root-secret-canary");
    expect(serialized).not.toContain("authorization-secret-canary");
    expect(serialized).not.toContain("session-token-canary");
    expect(serialized).not.toContain("api-server-key-canary");
    expect(serialized).not.toContain("user:password");
    expect(serialized).not.toContain("query-secret");
  });

  it("returns an empty safe object for malformed input", () => {
    expect(sanitizeDesktopConfig(null)).toEqual({});
    expect(sanitizeDesktopConfig(["not", "an", "object"])).toEqual({});
    expect(sanitizeDesktopConfig("not-json")).toEqual({});
  });
});

describe("Agents One backup round trip", { timeout: 30_000 }, () => {
  it("rejects a skill that embeds a bearer credential without disclosing it", async () => {
    const archivePath = join(testRoot, "skill-secret.agents-one-backup");
    const credential = "live-test-token-1234567890-abcdef";
    writeFixture(
      "skills/remote-agent/SKILL.md",
      `Use Authorization: Bearer ${credential} when calling the service.\n`,
    );

    const result = await exportAgentsOneBackupTo(archivePath, { sourceHome });

    expect(result).toMatchObject({
      success: false,
      error: expect.stringMatching(/技能文件.*硬编码凭据/),
    });
    expect(result.error).not.toContain(credential);
    expect(existsSync(archivePath)).toBe(false);
  });

  it("allows skills that reference credentials through environment variables", async () => {
    const archivePath = join(testRoot, "safe-skill.agents-one-backup");
    writeFixture(
      "skills/remote-agent/SKILL.md",
      "Use Authorization: Bearer ${AGENTS_ONE_GATEWAY_TOKEN} at runtime.\n",
    );

    const result = await exportAgentsOneBackupTo(archivePath, { sourceHome });

    expect(result, result.error).toMatchObject({ success: true });
  });

  it("keeps the event loop responsive while inspecting a large valid backup", async () => {
    const archivePath = join(testRoot, "large-valid.agents-one-backup");
    const database = new Database(join(sourceHome, "state.db"));
    try {
      database.exec(
        "CREATE TABLE inspection_payload (id INTEGER PRIMARY KEY, content BLOB NOT NULL)",
      );
      database
        .prepare(
          "INSERT INTO inspection_payload (content) VALUES (zeroblob(?))",
        )
        .run(12 * 1024 * 1024);
    } finally {
      database.close();
    }
    writeFixture(
      "desktop-staging/large-inspection/payload.bin",
      Buffer.alloc(12 * 1024 * 1024, 0x5a),
    );
    for (let index = 0; index < 256; index += 1) {
      writeFixture(
        `desktop-staging/large-inspection/items/${index}.txt`,
        `inspection-${index}`,
      );
    }
    const exported = await exportAgentsOneBackupTo(archivePath, {
      sourceHome,
    });
    expect(exported, exported.error).toMatchObject({ success: true });

    let heartbeatCount = 0;
    let maximumGapMs = 0;
    let previousHeartbeat = Date.now();
    const heartbeat = setInterval(() => {
      const now = Date.now();
      maximumGapMs = Math.max(maximumGapMs, now - previousHeartbeat);
      previousHeartbeat = now;
      heartbeatCount += 1;
    }, 10);
    try {
      const inspection = await inspectAgentsOneBackup(archivePath, {
        targetHome,
      });
      await new Promise((resolveTick) => setTimeout(resolveTick, 20));
      expect(inspection).toMatchObject({ success: true });
    } finally {
      clearInterval(heartbeat);
    }
    expect(heartbeatCount).toBeGreaterThan(2);
    expect(maximumGapMs).toBeLessThan(2_000);
  }, 30_000);

  it("refuses to save a backup inside the Agents One data directory", async () => {
    const protectedPath = join(sourceHome, "desktop.json");
    const before = sha256(protectedPath);

    const result = await exportAgentsOneBackupTo(protectedPath, {
      sourceHome,
    });

    expect(result).toMatchObject({
      success: false,
      error: expect.stringMatching(/数据目录/),
    });
    expect(sha256(protectedPath)).toBe(before);
    expect(readJson(protectedPath)).toMatchObject({ locale: "zh-CN" });
  });

  it("rejects files that are not an Agents One backup during inspection", async () => {
    const archivePath = join(testRoot, "hermes-or-random-backup.tar.gz");
    writeFileSync(archivePath, "not an Agents One archive");

    const inspection = await inspectAgentsOneBackup(archivePath, {
      targetHome,
    });

    expect(inspection).toMatchObject({
      success: false,
      error: expect.any(String),
    });
    expect(existsSync(join(targetHome, "desktop.json"))).toBe(false);
  });

  it("reports target conflicts during inspection without changing either side", async () => {
    const archivePath = join(testRoot, "inspect.agents-one-backup");
    const exported = await exportAgentsOneBackupTo(archivePath, { sourceHome });
    expect(exported, exported.error).toMatchObject({ success: true });

    const existingPaths = [
      "desktop.json",
      "state.db",
      "desktop/runtime-conversations.json",
    ];
    for (const relativePath of existingPaths) {
      const path = join(targetHome, relativePath);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, `existing:${relativePath}`);
    }
    const before = new Map(
      existingPaths.map((relativePath) => [
        relativePath,
        sha256(join(targetHome, relativePath)),
      ]),
    );

    const inspection = await inspectAgentsOneBackup(archivePath, {
      targetHome,
    });

    expect(inspection).toMatchObject({
      success: true,
      summary: expect.objectContaining({
        conflictCount: existingPaths.length,
        warnings: expect.arrayContaining([
          expect.stringMatching(/凭据|授权|密钥/),
          expect.stringMatching(/项目|路径/),
        ]),
      }),
    });
    for (const relativePath of existingPaths) {
      expect(sha256(join(targetHome, relativePath))).toBe(
        before.get(relativePath),
      );
    }
  });

  it("exports, inspects, and restores default plus named-profile data", async () => {
    const archivePath = join(testRoot, "Agents One 迁移.agents-one-backup");
    const sourceDesktopHash = sha256(join(sourceHome, "desktop.json"));

    const exported = await exportAgentsOneBackupTo(archivePath, {
      sourceHome,
      appVersion: "0.1.0-test",
    });

    expect(exported).toMatchObject({ success: true, path: archivePath });
    expect(existsSync(archivePath)).toBe(true);
    expect(sha256(join(sourceHome, "desktop.json"))).toBe(sourceDesktopHash);

    const inspection = await inspectAgentsOneBackup(archivePath, {
      targetHome,
    });
    expect(inspection).toMatchObject({
      success: true,
      summary: expect.objectContaining({
        appVersion: "0.1.0-test",
        profileCount: 2,
        projectCount: 2,
        taskCount: 3,
        chatCount: 4,
        collaborationCount: 1,
      }),
    });

    writeFileSync(join(targetHome, "unrelated-user-file.txt"), "keep me");
    writeFileSync(
      join(targetHome, "config.yaml"),
      [
        "api_server:",
        '  token: "target-api-token-preserved"',
        "secrets:",
        '  provider: "command"',
        '  command: "target-vault-command-preserved"',
        "model:",
        '  provider: "old"',
        "",
      ].join("\n"),
    );
    writeFileSync(join(targetHome, "state.db-wal"), "stale-wal");
    writeFileSync(join(targetHome, "state.db-shm"), "stale-shm");
    const restored = await restoreAgentsOneBackupFrom(archivePath, {
      targetHome,
    });
    expect(restored).toMatchObject({
      success: true,
      requiresRestart: true,
    });

    const restoredDesktop = readJson(join(targetHome, "desktop.json"));
    const restoredDesktopText = JSON.stringify(restoredDesktop);
    expect(restoredDesktop).toMatchObject({
      locale: "zh-CN",
      futureSafeSetting: { enabled: true },
      agentRuntimeAppearances: {
        "codex-local": expect.objectContaining({ name: "Codex 实施" }),
      },
    });
    expect(
      (restoredDesktop.agentRuntimes as Array<Record<string, unknown>>).find(
        (runtime) => runtime.id === "family-relay",
      ),
    ).toMatchObject({ enabled: false, needsReauthorization: true });
    expect(restoredDesktopText).not.toContain("desktop-api-key-canary");
    expect(restoredDesktopText).not.toContain("dashboard-token-canary");
    expect(restoredDesktopText).not.toContain("nested-token-canary");
    expect(restoredDesktopText).not.toContain("root-secret-canary");
    const restoredModelsText = readFileSync(
      join(targetHome, "models.json"),
      "utf8",
    );
    expect(restoredModelsText).toContain("自定义模型");
    expect(restoredModelsText).not.toContain("model-secret-canary");
    const restoredConfig = readFileSync(
      join(targetHome, "config.yaml"),
      "utf8",
    );
    expect(restoredConfig).toContain("model-1");
    expect(restoredConfig).toContain("context_length: 64000");
    expect(restoredConfig).not.toContain("proxy.example.test:8080");
    expect(restoredConfig).toContain("target-api-token-preserved");
    expect(restoredConfig).toContain("target-vault-command-preserved");
    expect(restoredConfig).not.toContain("yaml-model-secret-canary");
    expect(restoredConfig).not.toContain("yaml-api-token-canary");
    expect(restoredConfig).not.toContain("vault-secret-command-canary");
    expect(restoredConfig).not.toContain("legacy-server-key-canary");
    expect(restoredConfig).not.toContain("bearer-canary");
    expect(restoredConfig).not.toContain("private-key-canary");
    expect(restoredConfig).not.toContain("user:password");
    const restoredResearchConfig = readFileSync(
      join(targetHome, "profiles/research/config.yaml"),
      "utf8",
    );
    expect(restoredResearchConfig).toContain("research-model");
    expect(restoredResearchConfig).toContain("force_ipv4: true");

    expect(readFileSync(join(targetHome, "active_profile"), "utf8")).toBe(
      "research\n",
    );
    expect(
      readJson(join(targetHome, "desktop/runtime-conversations.json")),
    ).toMatchObject({
      conversations: [
        expect.objectContaining({
          id: "runtime-conv-1",
          workspace: "D:\\Projects\\Alpha",
          messages: [
            expect.objectContaining({ role: "user", content: "请检查项目" }),
            expect.objectContaining({ role: "agent", content: "检查完成" }),
          ],
        }),
      ],
    });
    expect(
      (
        readJson(join(targetHome, "desktop/runtime-conversations.json"))
          .conversations as Array<Record<string, unknown>>
      )[0],
    ).not.toHaveProperty("activeRuntimeRunId");
    expect(
      readJson(join(targetHome, "desktop/task-collaborations.json")),
    ).toMatchObject({
      records: [
        expect.objectContaining({
          taskId: "runtime-conv-1",
          assignments: [expect.objectContaining({ runtimeId: "codex-local" })],
        }),
      ],
    });
    expect(
      readJson(join(targetHome, "desktop/quick-chats.json")),
    ).toMatchObject({
      chats: [
        expect.objectContaining({
          id: "quick-chat-1",
          messages: [
            expect.objectContaining({ content: "快速问答" }),
            expect.objectContaining({ content: "快速回复" }),
          ],
        }),
      ],
    });
    const restoredSchedules = readJson(
      join(targetHome, "desktop/task-schedules.json"),
    ).schedules as Array<Record<string, unknown>>;
    expect(restoredSchedules).toEqual([
      expect.objectContaining({
        id: "schedule-1",
        enabled: false,
        pendingRuns: 0,
      }),
    ]);
    expect(restoredSchedules[0]).not.toHaveProperty("activeRuntimeRunId");
    expect(
      readJson(
        join(
          targetHome,
          "profiles/research/desktop/runtime-conversations.json",
        ),
      ),
    ).toMatchObject({
      conversations: [expect.objectContaining({ id: "research-conv" })],
    });
    expect(readStateMarker(join(targetHome, "state.db"))).toBe(
      "default-profile-state-db",
    );
    expect(
      readStateMarker(join(targetHome, "profiles/research/state.db")),
    ).toBe("named-profile-state-db");
    expect(existsSync(join(targetHome, "state.db-wal"))).toBe(false);
    expect(existsSync(join(targetHome, "state.db-shm"))).toBe(false);
    expect(readJson(join(targetHome, "desktop/task-center.json"))).toEqual({
      version: 5,
      tasks: [{ id: "legacy-task-1" }],
    });
    expect(readJson(join(targetHome, "desktop/project-control.json"))).toEqual({
      version: 1,
      projects: [{ id: "legacy-project-1" }],
    });
    expect(
      readFileSync(
        join(targetHome, "desktop/runtime-inputs/input-1/spec.txt"),
        "utf8",
      ),
    ).toBe("fixture evidence");
    expect(
      readFileSync(join(targetHome, "desktop-staging/native-1/image.png")),
    ).toEqual(Buffer.from("image-fixture"));
    expect(existsSync(join(targetHome, ".env"))).toBe(false);
    expect(existsSync(join(targetHome, "auth.json"))).toBe(false);
    expect(existsSync(join(targetHome, "profiles/research/.env"))).toBe(false);
    expect(existsSync(join(targetHome, "logs/gateway.log"))).toBe(false);
    expect(
      readFileSync(join(targetHome, "unrelated-user-file.txt"), "utf8"),
    ).toBe("keep me");
  });

  it("rebinds backup-owned staged attachment paths after moving to a different data home", async () => {
    const archivePath = join(testRoot, "attachment-paths.agents-one-backup");
    const exported = await exportAgentsOneBackupTo(archivePath, { sourceHome });
    expect(exported, exported.error).toMatchObject({ success: true });

    const restored = await restoreAgentsOneBackupFrom(archivePath, {
      targetHome,
    });
    expect(restored, restored.error).toMatchObject({ success: true });

    const expectedPath = stagedImageAttachmentPath(targetHome);
    expect(expectedPath).not.toBe(stagedImageAttachmentPath(sourceHome));
    expect(readContinuationAttachmentPath(join(targetHome, "state.db"))).toBe(
      expectedPath,
    );
    expect(readOverlayAttachmentPath(targetHome)).toBe(expectedPath);
    const originalContent = `请查看附件，原路径为 ${stagedImageAttachmentPath(sourceHome)}`;
    expect(readContinuationContent(join(targetHome, "state.db"))).toBe(
      originalContent,
    );
    expect(readOverlayContent(targetHome)).toBe(originalContent);
    expect(existsSync(expectedPath)).toBe(true);
    expect(readFileSync(expectedPath)).toEqual(Buffer.from("image-fixture"));
  });

  it("restores managed data as a snapshot while preserving credentials and unrelated files", async () => {
    rmSync(join(sourceHome, "desktop/quick-chats.json"));
    const archivePath = join(testRoot, "managed-snapshot.agents-one-backup");
    const exported = await exportAgentsOneBackupTo(archivePath, { sourceHome });
    expect(exported, exported.error).toMatchObject({ success: true });

    const staleQuickChats = join(targetHome, "desktop/quick-chats.json");
    const staleSkill = join(targetHome, "skills/retired-skill/SKILL.md");
    mkdirSync(dirname(staleQuickChats), { recursive: true });
    mkdirSync(dirname(staleSkill), { recursive: true });
    writeFileSync(
      staleQuickChats,
      JSON.stringify({ version: 1, chats: [{ id: "target-only-chat" }] }),
    );
    writeFileSync(staleSkill, "# Target-only retired skill\n");
    writeFileSync(join(targetHome, ".env"), "TARGET_SECRET=keep-me\n");
    writeFileSync(
      join(targetHome, "auth.json"),
      JSON.stringify({ access_token: "target-token-preserved" }),
    );
    writeFileSync(
      join(targetHome, "config.yaml"),
      [
        "api_server:",
        '  token: "target-config-token-preserved"',
        "model:",
        '  provider: "old"',
        "",
      ].join("\n"),
    );
    writeFileSync(join(targetHome, "unrelated-user-file.txt"), "keep me too");

    const restored = await restoreAgentsOneBackupFrom(archivePath, {
      targetHome,
    });
    expect(restored, restored.error).toMatchObject({ success: true });
    expect(existsSync(staleQuickChats)).toBe(false);
    expect(existsSync(staleSkill)).toBe(false);
    expect(readFileSync(join(targetHome, ".env"), "utf8")).toBe(
      "TARGET_SECRET=keep-me\n",
    );
    expect(readJson(join(targetHome, "auth.json"))).toEqual({
      access_token: "target-token-preserved",
    });
    expect(readFileSync(join(targetHome, "config.yaml"), "utf8")).toContain(
      "target-config-token-preserved",
    );
    expect(
      readFileSync(join(targetHome, "unrelated-user-file.txt"), "utf8"),
    ).toBe("keep me too");
  });

  it("exports a coherent SQLite snapshot while committed WAL pages are live", async () => {
    const sourceDatabase = new Database(join(sourceHome, "state.db"));
    const archivePath = join(testRoot, "wal-snapshot.agents-one-backup");
    try {
      sourceDatabase.exec("PRAGMA journal_mode = WAL");
      sourceDatabase.exec("PRAGMA wal_autocheckpoint = 0");
      sourceDatabase.exec(
        "CREATE TABLE wal_fixture (id INTEGER PRIMARY KEY, marker TEXT NOT NULL)",
      );
      sourceDatabase
        .prepare("INSERT INTO wal_fixture (marker) VALUES (?)")
        .run("committed-wal-record");
      expect(existsSync(join(sourceHome, "state.db-wal"))).toBe(true);

      const exported = await exportAgentsOneBackupTo(archivePath, {
        sourceHome,
      });
      expect(exported).toMatchObject({ success: true });
    } finally {
      sourceDatabase.close();
    }

    const restored = await restoreAgentsOneBackupFrom(archivePath, {
      targetHome,
    });
    expect(restored).toMatchObject({ success: true });
    const restoredDatabase = new Database(join(targetHome, "state.db"), {
      readonly: true,
    });
    try {
      expect(
        restoredDatabase
          .prepare("SELECT marker FROM wal_fixture ORDER BY id LIMIT 1")
          .get(),
      ).toMatchObject({ marker: "committed-wal-record" });
    } finally {
      restoredDatabase.close();
    }
    expect(existsSync(join(targetHome, "state.db-wal"))).toBe(false);
    expect(existsSync(join(targetHome, "state.db-shm"))).toBe(false);
  });

  it("rolls back a prepared restore journal left by an interrupted process", async () => {
    const existingPath = "desktop/runtime-conversations.json";
    const introducedPath = "desktop/quick-chats.json";
    const existingDestination = join(targetHome, ...existingPath.split("/"));
    const introducedDestination = join(
      targetHome,
      ...introducedPath.split("/"),
    );
    mkdirSync(dirname(existingDestination), { recursive: true });
    writeFileSync(existingDestination, "partially restored conversation data");
    writeFileSync(
      introducedDestination,
      "partially introduced quick chat data",
    );

    const transactionRoot = writeRestoreTransactionFixture(
      "prepared",
      [existingPath, introducedPath],
      [existingPath],
    );
    const snapshotPath = join(
      transactionRoot,
      "snapshot",
      ...existingPath.split("/"),
    );
    mkdirSync(dirname(snapshotPath), { recursive: true });
    writeFileSync(snapshotPath, "target data before restore");

    expect(() => recoverInterruptedAgentsOneRestore(targetHome)).toThrow(
      /无法确认来源的文件/,
    );

    // A path absent at transaction start might now belong to a new process
    // or a user. Keep it and the journal for explicit recovery rather than
    // deleting data whose identity cannot be proven.
    expect(readFileSync(introducedDestination, "utf8")).toBe(
      "partially introduced quick chat data",
    );
    expect(existsSync(transactionRoot)).toBe(true);
  });

  it("only cleans a committed restore journal left before process exit", async () => {
    const existingPath = "desktop/runtime-conversations.json";
    const introducedPath = "desktop/quick-chats.json";
    const existingDestination = join(targetHome, ...existingPath.split("/"));
    const introducedDestination = join(
      targetHome,
      ...introducedPath.split("/"),
    );
    mkdirSync(dirname(existingDestination), { recursive: true });
    writeFileSync(existingDestination, "committed conversation data");
    writeFileSync(introducedDestination, "committed quick chat data");

    const transactionRoot = writeRestoreTransactionFixture(
      "committed",
      [existingPath, introducedPath],
      [existingPath],
    );
    const snapshotPath = join(
      transactionRoot,
      "snapshot",
      ...existingPath.split("/"),
    );
    mkdirSync(dirname(snapshotPath), { recursive: true });
    writeFileSync(snapshotPath, "stale data before restore");

    await recoverInterruptedAgentsOneRestore(targetHome);

    expect(readFileSync(existingDestination, "utf8")).toBe(
      "committed conversation data",
    );
    expect(readFileSync(introducedDestination, "utf8")).toBe(
      "committed quick chat data",
    );
    expect(existsSync(transactionRoot)).toBe(false);
  });

  it("rejects a self-consistent archive that targets excluded credential paths", async () => {
    const archivePath = join(testRoot, "valid-paths.agents-one-backup");
    const maliciousPath = join(testRoot, "malicious-path.agents-one-backup");
    const unpacked = join(testRoot, "malicious-unpacked");
    mkdirSync(unpacked, { recursive: true });
    const exported = await exportAgentsOneBackupTo(archivePath, { sourceHome });
    expect(exported).toMatchObject({ success: true });
    await tar.extract({ cwd: unpacked, file: archivePath });

    const injected = join(unpacked, "payload/.env");
    writeFileSync(injected, "OPENAI_API_KEY=attacker-controlled\n");
    const manifestPath = join(unpacked, "manifest.json");
    const manifest = readJson(manifestPath) as {
      files: Array<{ path: string; size: number; sha256: string }>;
    };
    manifest.files.push({
      path: ".env",
      size: readFileSync(injected).length,
      sha256: sha256(injected),
    });
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    await tar.create(
      { cwd: unpacked, file: maliciousPath, gzip: true, portable: true },
      ["manifest.json", "payload"],
    );

    const inspection = await inspectAgentsOneBackup(maliciousPath, {
      targetHome,
    });
    expect(inspection).toMatchObject({
      success: false,
      error: expect.stringMatching(/无效|拒绝|不允许|清单/),
    });
    expect(existsSync(join(targetHome, ".env"))).toBe(false);
  });

  it.each([
    {
      label: "malformed JSON",
      payload: '{"version":1,"chats":[',
    },
    {
      label: "invalid JSON structure",
      payload: JSON.stringify({ version: 1, chats: { id: "not-an-array" } }),
    },
  ])(
    "rejects a self-consistent backup whose quick-chat store has $label",
    async ({ label, payload }) => {
      const archivePath = join(testRoot, `valid-${label}.agents-one-backup`);
      const invalidPath = join(testRoot, `invalid-${label}.agents-one-backup`);
      const exported = await exportAgentsOneBackupTo(archivePath, {
        sourceHome,
      });
      expect(exported, exported.error).toMatchObject({ success: true });
      await rewriteBackupPayload(
        archivePath,
        invalidPath,
        "desktop/quick-chats.json",
        payload,
      );

      const targetQuickChats = join(targetHome, "desktop/quick-chats.json");
      mkdirSync(dirname(targetQuickChats), { recursive: true });
      writeFileSync(
        targetQuickChats,
        JSON.stringify({ version: 1, chats: [{ id: "keep-target-chat" }] }),
      );
      const before = sha256(targetQuickChats);

      const inspection = await inspectAgentsOneBackup(invalidPath, {
        targetHome,
      });
      expect(inspection).toMatchObject({
        success: false,
        error: expect.stringMatching(/核心|聊天|结构|解析/),
      });
      expect(sha256(targetQuickChats)).toBe(before);

      const restored = await restoreAgentsOneBackupFrom(invalidPath, {
        targetHome,
      });
      expect(restored).toMatchObject({
        success: false,
        error: expect.stringMatching(/核心|聊天|结构|解析/),
      });
      expect(sha256(targetQuickChats)).toBe(before);
      expect(readJson(targetQuickChats)).toEqual({
        version: 1,
        chats: [{ id: "keep-target-chat" }],
      });
    },
  );

  it("rejects a corrupted archive without overwriting current data", async () => {
    const archivePath = join(testRoot, "valid.agents-one-backup");
    const corruptPath = join(testRoot, "corrupt.agents-one-backup");
    await exportAgentsOneBackupTo(archivePath, { sourceHome });

    const bytes = Buffer.from(readFileSync(archivePath));
    bytes[Math.max(0, bytes.length - 1)] ^= 0xff;
    writeFileSync(corruptPath, bytes);

    const targetConversation = join(
      targetHome,
      "desktop/runtime-conversations.json",
    );
    mkdirSync(dirname(targetConversation), { recursive: true });
    writeFileSync(targetConversation, "current-target-data");
    const before = sha256(targetConversation);

    const result = await restoreAgentsOneBackupFrom(corruptPath, {
      targetHome,
    }).catch((error: unknown) => error);

    expect(
      result instanceof Error ||
        (typeof result === "object" &&
          result !== null &&
          "success" in result &&
          result.success === false),
    ).toBe(true);
    const errorText =
      result instanceof Error
        ? result.message
        : typeof result === "object" && result !== null && "error" in result
          ? String(result.error)
          : "";
    expect(errorText).not.toMatch(/ENOTEMPTY|Directory not empty/i);
    expect(sha256(targetConversation)).toBe(before);
    expect(readFileSync(targetConversation, "utf8")).toBe(
      "current-target-data",
    );
  });

  it("detects a payload whose bytes no longer match the manifest hash", async () => {
    const archivePath = join(testRoot, "valid-hash.agents-one-backup");
    const tamperedPath = join(testRoot, "tampered-hash.agents-one-backup");
    const unpacked = join(testRoot, "tampered-unpacked");
    mkdirSync(unpacked, { recursive: true });
    const exported = await exportAgentsOneBackupTo(archivePath, { sourceHome });
    expect(exported).toMatchObject({ success: true });
    await tar.extract({ cwd: unpacked, file: archivePath });

    const payload = join(
      unpacked,
      "payload/desktop/runtime-conversations.json",
    );
    const original = Buffer.from(readFileSync(payload));
    original[0] ^= 0x01;
    writeFileSync(payload, original);
    await tar.create(
      {
        cwd: unpacked,
        file: tamperedPath,
        gzip: true,
        portable: true,
      },
      ["manifest.json", "payload"],
    );

    const inspection = await inspectAgentsOneBackup(tamperedPath, {
      targetHome,
    });
    expect(inspection).toMatchObject({
      success: false,
      error: expect.stringMatching(/完整性|integrity|hash/i),
    });
    expect(existsSync(join(targetHome, "desktop.json"))).toBe(false);
  });
});
