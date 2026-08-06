const { createHash, randomUUID } = require("crypto");
const fs = require("fs");
const https = require("https");
const path = require("path");

const runtimeId = "hermes-home";
const workspaceRoot =
  process.argv[2] || "D:\\Users\\chenfl\\Desktop\\test";
const desktopConfigPath = path.join(
  process.env.LOCALAPPDATA || "",
  "hermes",
  "desktop.json",
);
const envPath = path.join(
  process.env.LOCALAPPDATA || "",
  "hermes",
  ".env",
);

function fail(message) {
  throw new Error(message);
}

function parseEnv(text) {
  const values = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    values[line.slice(0, separator).trim()] = line
      .slice(separator + 1)
      .trim()
      .replace(/^(['"])(.*)\1$/, "$2");
  }
  return values;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function requestJson(endpoint, token, method, route, body) {
  const url = new URL(
    `${endpoint.replace(/\/+$/, "")}/${route.replace(/^\/+/, "")}`,
  );
  if (url.protocol !== "https:") {
    fail("Hers Gateway verification requires HTTPS.");
  }
  const payload = body === undefined ? undefined : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const request = https.request(
      url,
      {
        method,
        rejectUnauthorized: false,
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
          ...(payload
            ? {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(payload),
              }
            : {}),
        },
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.once("error", reject);
        response.once("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let parsed;
          try {
            parsed = text ? JSON.parse(text) : undefined;
          } catch {
            reject(
              new Error(
                `Gateway returned invalid JSON (HTTP ${response.statusCode || 0}).`,
              ),
            );
            return;
          }
          if (
            (response.statusCode || 0) < 200 ||
            (response.statusCode || 0) >= 300
          ) {
            const errorCode =
              parsed && typeof parsed === "object"
                ? parsed.error?.code ||
                  parsed.code ||
                  parsed.detail?.code ||
                  parsed.detail
                : undefined;
            reject(
              new Error(
                `Gateway returned HTTP ${response.statusCode || 0} for ${method} /${route}` +
                  (typeof errorCode === "string"
                    ? ` (${errorCode.slice(0, 160)})`
                    : "") +
                  ".",
              ),
            );
            return;
          }
          resolve(parsed);
        });
      },
    );
    request.once("error", reject);
    request.setTimeout(30_000, () =>
      request.destroy(new Error("Gateway verification request timed out.")),
    );
    if (payload) request.write(payload);
    request.end();
  });
}

function safeTarget(relativePath) {
  if (
    typeof relativePath !== "string" ||
    !relativePath.trim() ||
    relativePath.includes("\\") ||
    path.posix.isAbsolute(relativePath)
  ) {
    fail("Remote request used an invalid project-relative path.");
  }
  const normalized = path.posix.normalize(relativePath.trim());
  if (normalized === ".." || normalized.startsWith("../")) {
    fail("Remote request attempted to escape the workspace.");
  }
  const target = path.resolve(
    workspaceRoot,
    normalized === "." ? "" : normalized,
  );
  const relation = path.relative(workspaceRoot, target);
  if (
    relation === ".." ||
    relation.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relation)
  ) {
    fail("Remote request escaped the workspace.");
  }
  return { normalized, target };
}

function executeWorkspaceRequest(request) {
  const requestId =
    typeof request?.id === "string"
      ? request.id
      : typeof request?.requestId === "string"
        ? request.requestId
        : "";
  if (!requestId) fail("Workspace request has no server request ID.");
  try {
    const { normalized, target } = safeTarget(request.path);
    if (request.operation === "list") {
      const entries = fs.readdirSync(target, { withFileTypes: true }).map(
        (entry) => {
          const entryPath = path.join(target, entry.name);
          return {
            path: path.posix.join(
              normalized === "." ? "" : normalized,
              entry.name,
            ),
            type: entry.isDirectory() ? "directory" : "file",
            ...(entry.isFile() ? { size: fs.statSync(entryPath).size } : {}),
          };
        },
      );
      return {
        requestId,
        status: "succeeded",
        summary: `Listed ${entries.length} project entries.`,
        data: { entries },
      };
    }
    if (request.operation === "read") {
      const bytes = fs.readFileSync(target);
      if (bytes.length > 262_144) fail("Read exceeds 256 KiB.");
      return {
        requestId,
        status: "succeeded",
        summary: `Read ${normalized}.`,
        data: {
          path: normalized,
          content: bytes.toString("utf8"),
          sha256: sha256(bytes),
          bytes: bytes.length,
        },
      };
    }
    if (request.operation === "write") {
      if (typeof request.content !== "string" || !request.content) {
        fail("Write content is empty.");
      }
      const bytes = Buffer.from(request.content, "utf8");
      if (bytes.length > 262_144) fail("Write exceeds 256 KiB.");
      if (fs.existsSync(target) && request.expectedSha256) {
        const currentHash = sha256(fs.readFileSync(target));
        if (currentHash !== request.expectedSha256) {
          fail("Write checksum precondition failed.");
        }
      }
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, bytes);
      return {
        requestId,
        status: "succeeded",
        summary: `Wrote ${normalized}.`,
        data: {
          path: normalized,
          sha256: sha256(bytes),
          bytes: bytes.length,
        },
      };
    }
    return {
      requestId,
      status: "denied",
      summary: `Operation ${String(request.operation)} is outside this verification.`,
    };
  } catch (error) {
    return {
      requestId,
      status: "denied",
      summary: error instanceof Error ? error.message : String(error),
    };
  }
}

async function main() {
  const config = JSON.parse(fs.readFileSync(desktopConfigPath, "utf8"));
  const runtime = (config.agentRuntimes || []).find(
    (candidate) => candidate?.id === runtimeId,
  );
  if (!runtime) fail("Hers runtime is not configured.");
  if (
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
  const rootStat = fs.statSync(workspaceRoot);
  if (!rootStat.isDirectory()) fail("Verification workspace is not a directory.");

  const endpoint = runtime.config.endpoint;
  const capabilities = await requestJson(
    endpoint,
    token,
    "GET",
    "capabilities",
  );
  if (
    capabilities?.capabilities?.outboundWorkspaceGateway?.enabled !== true
  ) {
    fail("Hers does not advertise outboundWorkspaceGateway.");
  }

  const grantId = `workspace-grant-${randomUUID()}`;
  const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
  const registeredGrant = await requestJson(
    endpoint,
    token,
    "POST",
    "workspace-grants",
    {
      grantId,
      taskId: `hers-e2e-${Date.now()}`,
      runtimeId,
      permission: "write",
      expiresAt,
      maxOperationBytes: 262_144,
      operations: ["list", "read", "write"],
    },
  );
  const returnedGrantId = registeredGrant?.grantId || registeredGrant?.id;
  if (returnedGrantId && returnedGrantId !== grantId) {
    fail("Hers Relay replaced the desktop-generated Workspace Grant ID.");
  }
  if (
    registeredGrant?.permissions &&
    registeredGrant.permissions.write !== true
  ) {
    fail(
      "Hers Relay did not preserve permission=write when registering the Workspace Grant.",
    );
  }

  let runId;
  let finalRun;
  const operationCounts = { list: 0, read: 0, write: 0 };
  try {
    const conversationId = `hers-workspace-e2e-${randomUUID()}`;
    const run = await requestJson(endpoint, token, "POST", "runs", {
      mode: "task",
      conversationId,
      input: {
        text:
          "这是 Agents One Workspace Grant 自动验收。必须只通过 workspace_gateway 工具完成：" +
          "先列出项目根目录，读取 test-document.txt（若不存在则读取任一 txt 文件），" +
          "然后创建 agents-one-gateway-e2e.txt，内容必须包含一行：Agents One Gateway v1 E2E passed。" +
          "不要使用 shell，不要请求或猜测 Windows 绝对路径。最后简要报告读取和写入结果。",
        workspaceRef: `desktop-gateway:${grantId}`,
      },
      execution: { timeoutSeconds: 600, permission: "write" },
    });
    runId = run.id;
    if (!runId) fail("Gateway did not return a run ID.");

    const deadline = Date.now() + 10 * 60_000;
    finalRun = run;
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
        if (Object.hasOwn(operationCounts, operation)) {
          operationCounts[operation] += 1;
        }
        const result = executeWorkspaceRequest(pulled.request);
        try {
          await requestJson(
            endpoint,
            token,
            "POST",
            `workspace-grants/${encodeURIComponent(grantId)}/results`,
            result,
          );
          const storedResult = await requestJson(
            endpoint,
            token,
            "GET",
            `workspace-grants/${encodeURIComponent(grantId)}/results/${encodeURIComponent(
              result.requestId,
            )}`,
          );
          if (storedResult?.status !== result.status) {
            fail(
              `Hers Relay stored Workspace result status ${String(
                storedResult?.status,
              )} instead of ${result.status}.`,
            );
          }
          if (
            result.status === "succeeded" &&
            result.data &&
            !storedResult?.data &&
            !storedResult?.result
          ) {
            fail(
              "Hers Relay discarded the standard Workspace result data payload.",
            );
          }
        } catch (error) {
          throw new Error(
            `${error instanceof Error ? error.message : String(error)} ` +
              `operation=${String(operation)} resultStatus=${result.status} ` +
              `requestPath=${JSON.stringify(pulled.request.path)} ` +
              `summary=${String(result.summary || "").slice(0, 240)}.`,
          );
        }
      }
      finalRun = await requestJson(
        endpoint,
        token,
        "GET",
        `runs/${encodeURIComponent(runId)}`,
      );
      if (
        ["succeeded", "failed", "cancelled", "timed_out"].includes(
          finalRun.status,
        )
      ) {
        if (finalRun.status !== "succeeded") {
          fail(`Hers run ended with ${finalRun.status}.`);
        }
        break;
      }
    }

    const outputPath = path.join(workspaceRoot, "agents-one-gateway-e2e.txt");
    if (!fs.existsSync(outputPath)) {
      fail(
        `Hers did not create the E2E file; operations=${JSON.stringify(
          operationCounts,
        )}; remoteOutput=${String(finalRun?.output || "").slice(0, 600)}`,
      );
    }
    const output = fs.readFileSync(outputPath, "utf8");
    if (!output.includes("Agents One Gateway v1 E2E passed")) {
      fail("The E2E file content does not match the acceptance marker.");
    }
    if (!operationCounts.list || !operationCounts.read || !operationCounts.write) {
      fail(
        `Incomplete operation coverage: ${JSON.stringify(operationCounts)}.`,
      );
    }
    console.log(
      JSON.stringify({
        ok: true,
        runtimeId,
        runId,
        operationCounts,
        artifact: path.basename(outputPath),
        artifactSha256: sha256(Buffer.from(output, "utf8")),
      }),
    );
  } finally {
    await requestJson(
      endpoint,
      token,
      "POST",
      `workspace-grants/${encodeURIComponent(grantId)}/revoke`,
      { reason: "Automated verification completed." },
    ).catch(() => undefined);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(
      JSON.stringify({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    process.exitCode = 1;
  });
}

module.exports = {
  executeWorkspaceRequest,
  parseEnv,
  requestJson,
  sha256,
};
