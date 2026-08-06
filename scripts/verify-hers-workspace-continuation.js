const { randomUUID } = require("crypto");
const fs = require("fs");
const path = require("path");
const {
  executeWorkspaceRequest,
  parseEnv,
  requestJson,
  sha256,
} = require("./verify-hers-workspace-gateway");

const runtimeId = "hermes-home";
const workspaceRoot = process.argv[2] || "D:\\Users\\chenfl\\Desktop\\test";
const desktopConfigPath = path.join(
  process.env.LOCALAPPDATA || "",
  "hermes",
  "desktop.json",
);
const envPath = path.join(process.env.LOCALAPPDATA || "", "hermes", ".env");

function fail(message) {
  throw new Error(message);
}

function loadConnection() {
  const config = JSON.parse(fs.readFileSync(desktopConfigPath, "utf8"));
  const runtime = (config.agentRuntimes || []).find(
    (candidate) => candidate?.id === runtimeId,
  );
  if (
    !runtime ||
    runtime.config?.remoteGateway?.protocol !== "agents-one-v1" ||
    !runtime.config.endpoint
  ) {
    fail("Hers is not configured for Agents One Remote Gateway v1.");
  }
  const tokenName = `AGENTS_ONE_GATEWAY_${runtimeId
    .replace(/-/g, "_")
    .toUpperCase()}_TOKEN`;
  const token =
    process.env[tokenName] ||
    parseEnv(fs.readFileSync(envPath, "utf8"))[tokenName];
  if (!token) fail("The protected Hers Gateway token is missing.");
  return { endpoint: runtime.config.endpoint, token };
}

async function registerGrant(endpoint, token, taskId) {
  const grantId = `workspace-grant-${randomUUID()}`;
  const grant = await requestJson(endpoint, token, "POST", "workspace-grants", {
    grantId,
    taskId,
    runtimeId,
    permission: "write",
    expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    maxOperationBytes: 262_144,
    operations: ["list", "read", "write"],
  });
  if ((grant?.grantId || grant?.id) !== grantId) {
    fail("Relay replaced the desktop-generated continuation Grant ID.");
  }
  if (grant?.permissions && grant.permissions.write !== true) {
    fail("Relay did not preserve write permission for the continuation Grant.");
  }
  return grantId;
}

async function runRound({
  endpoint,
  token,
  grantId,
  conversationId,
  text,
  requiredOperations,
}) {
  const run = await requestJson(endpoint, token, "POST", "runs", {
    mode: "task",
    conversationId,
    input: {
      text,
      workspaceRef: `desktop-gateway:${grantId}`,
    },
    execution: { timeoutSeconds: 600, permission: "write" },
  });
  if (!run?.id) fail("Gateway did not return a continuation run ID.");

  const counts = { list: 0, read: 0, write: 0 };
  let finalRun = run;
  const deadline = Date.now() + 10 * 60_000;
  while (Date.now() < deadline) {
    const pulled = await requestJson(
      endpoint,
      token,
      "POST",
      `workspace-grants/${encodeURIComponent(grantId)}/pull`,
      { maxWaitSeconds: 3 },
    );
    if (pulled?.request) {
      const operation = pulled.request.operation;
      if (Object.hasOwn(counts, operation)) counts[operation] += 1;
      const result = executeWorkspaceRequest(pulled.request);
      await requestJson(
        endpoint,
        token,
        "POST",
        `workspace-grants/${encodeURIComponent(grantId)}/results`,
        result,
      );
    }

    finalRun = await requestJson(
      endpoint,
      token,
      "GET",
      `runs/${encodeURIComponent(run.id)}`,
    );
    if (
      ["succeeded", "failed", "cancelled", "timed_out"].includes(
        finalRun.status,
      )
    ) {
      if (finalRun.status !== "succeeded") {
        fail(
          `Continuation run ${run.id} ended with ${finalRun.status}: ${String(
            finalRun?.error?.message || finalRun?.error || "",
          ).slice(0, 300)}`,
        );
      }
      break;
    }
  }
  for (const operation of requiredOperations) {
    if (!counts[operation]) {
      fail(
        `Continuation run did not issue ${operation}; operations=${JSON.stringify(
          counts,
        )}; output=${String(finalRun?.output || "").slice(0, 500)}`,
      );
    }
  }
  return { runId: run.id, counts };
}

async function revoke(endpoint, token, grantId) {
  await requestJson(
    endpoint,
    token,
    "POST",
    `workspace-grants/${encodeURIComponent(grantId)}/revoke`,
    { reason: "Continuation verification round completed." },
  ).catch(() => undefined);
}

async function main() {
  if (!fs.statSync(workspaceRoot).isDirectory()) {
    fail("Verification workspace is not a directory.");
  }
  const { endpoint, token } = loadConnection();
  const conversationId = `hers-workspace-continuation-${randomUUID()}`;
  const editedArtifactName = "agents-one-gateway-continuation-edit.md";
  const editedArtifactPath = path.join(workspaceRoot, editedArtifactName);
  const createdArtifactName = "agents-one-gateway-continuation-new.md";
  const createdArtifactPath = path.join(workspaceRoot, createdArtifactName);
  const seed = `Agents One edit seed ${randomUUID()}`;
  const marker = `Agents One continuation passed ${randomUUID()}`;
  const rounds = [];
  fs.writeFileSync(editedArtifactPath, `${seed}\n`, "utf8");
  if (fs.existsSync(createdArtifactPath)) fs.unlinkSync(createdArtifactPath);

  const readGrantId = await registerGrant(
    endpoint,
    token,
    `hers-continuation-read-${Date.now()}`,
  );
  try {
    rounds.push(
      await runRound({
        endpoint,
        token,
        grantId: readGrantId,
        conversationId,
        text:
          "这是同一会话第一轮验收。必须通过 workspace_gateway 列出项目根目录并读取任一 txt 或 md 文件。" +
          "不要使用 shell，不要猜测本机绝对路径。",
        requiredOperations: ["list", "read"],
      }),
    );
  } finally {
    await revoke(endpoint, token, readGrantId);
  }

  const writeGrantId = await registerGrant(
    endpoint,
    token,
    `hers-continuation-write-${Date.now()}`,
  );
  try {
    const writeRound = await runRound({
      endpoint,
      token,
      grantId: writeGrantId,
      conversationId,
      text:
        `这是同一会话第二轮验收。必须通过本轮新挂载的 workspace_gateway 完成两个操作：` +
        `先读取并编辑 ${editedArtifactName}，保留原有内容并追加“${marker}”；` +
        `再新建 ${createdArtifactName}，内容也必须完整包含“${marker}”。` +
        "两个文件都必须实际写入。不要使用上一轮授权，不要使用 shell。",
      requiredOperations: ["read", "write"],
    });
    if (writeRound.counts.write < 2) {
      fail(
        `Continuation run issued only ${writeRound.counts.write} write operation(s); expected edit and create.`,
      );
    }
    rounds.push(writeRound);
  } finally {
    await revoke(endpoint, token, writeGrantId);
  }

  if (!fs.existsSync(editedArtifactPath)) {
    fail("Continuation edit artifact is missing.");
  }
  if (!fs.existsSync(createdArtifactPath)) {
    fail("Continuation create artifact was not created.");
  }
  const editedContent = fs.readFileSync(editedArtifactPath, "utf8");
  const createdContent = fs.readFileSync(createdArtifactPath, "utf8");
  if (!editedContent.includes(seed) || !editedContent.includes(marker)) {
    fail("Continuation edit did not preserve the seed and append the marker.");
  }
  if (!createdContent.includes(marker)) {
    fail("Continuation create artifact does not contain the expected marker.");
  }
  console.log(
    JSON.stringify({
      ok: true,
      runtimeId,
      conversationId,
      rounds,
      artifacts: [
        {
          action: "edited",
          path: editedArtifactName,
          sha256: sha256(Buffer.from(editedContent, "utf8")),
        },
        {
          action: "created",
          path: createdArtifactName,
          sha256: sha256(Buffer.from(createdContent, "utf8")),
        },
      ],
    }),
  );
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }),
  );
  process.exitCode = 1;
});
