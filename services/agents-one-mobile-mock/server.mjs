import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const source = fs.readFileSync(
  path.join(root, "src/shared/mobile-control.ts"),
  "utf8",
);
const js = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ES2022,
  },
}).outputText;
const {
  MOBILE_ROUTES,
  resolveMobileRoute,
  validateMobileBody,
  validateMobileMutationHeaders,
  MOBILE_LIMITS,
  MobileContractError,
} = await import(
  `data:text/javascript;base64,${Buffer.from(js).toString("base64")}`
);
const fixtures = JSON.parse(
  fs.readFileSync(
    path.join(root, "contracts/mobile-control/v1/fixtures.json"),
    "utf8",
  ),
).objects;

/** Development-only shape simulator. No credentials, user storage, scheduling or dispatch. */
export function createMobileMockServer() {
  const receipts = new Map();
  return http.createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Agents-One-Simulator", "contract-fixtures-only");
    res.setHeader("Content-Type", "application/json");
    const send = (status, value) => {
      res.statusCode = status;
      res.end(value === undefined ? undefined : JSON.stringify(value));
    };
    const error = (code, status) =>
      send(status, {
        error: {
          code,
          message: code,
          retryable: false,
          requestId: crypto.randomUUID(),
        },
      });
    try {
      const url = new URL(req.url, "http://127.0.0.1");
      const matched = resolveMobileRoute(req.method, url.pathname);
      if (!matched) return error("resource_not_found", 404);
      const { route } = matched;
      // The simulator cannot issue pairing/authentication credentials.
      if (
        route.proof ||
        [
          "claimPairing",
          "refreshCredentials",
          "getDevice",
          "revokeDevice",
        ].includes(route.operationId)
      )
        return error("requires_owner_action", 403);
      let size = 0;
      const chunks = [];
      for await (const chunk of req) {
        size += chunk.length;
        if (size > MOBILE_LIMITS.maxRequestBytes)
          return error("payload_too_large", 413);
        chunks.push(chunk);
      }
      const raw = Buffer.concat(chunks).toString("utf8");
      let body;
      try {
        body = raw ? JSON.parse(raw) : {};
      } catch {
        return error("invalid_input", 422);
      }
      if (route.body) validateMobileBody(route.body, body);
      const headers = Object.fromEntries(
        Object.entries(req.headers).map(([key, value]) => [
          key,
          typeof value === "string" ? value : undefined,
        ]),
      );
      validateMobileMutationHeaders(route, headers, body);
      if (route.mutation) {
        const key = headers["idempotency-key"];
        const hash = crypto
          .createHash("sha256")
          .update(
            `${req.method}\n${url.pathname}\n${headers["if-match"] ?? ""}\n${raw}`,
          )
          .digest("hex");
        const previous = receipts.get(key);
        if (previous)
          return previous.hash === hash
            ? send(202, previous.receipt)
            : error("idempotency_conflict", 409);
        const receipt = {
          ...fixtures.OperationReceipt,
          operationId: crypto.randomUUID(),
          clientMutationId: key,
          deviceId: "simulator-device",
          action: route.operationId,
          status: "rejected",
          error: {
            code: "requires_owner_action",
            message: "Simulator cannot dispatch or modify real Owner data.",
            retryable: false,
            requestId: crypto.randomUUID(),
          },
        };
        receipts.set(key, { hash, receipt });
        return send(202, receipt);
      }
      if (route.operationId === "getOperation") {
        const receipt = [...receipts.values()].find(
          (item) => item.receipt.operationId === matched.params.id,
        )?.receipt;
        return receipt ? send(200, receipt) : error("resource_not_found", 404);
      }
      if (route.operationId === "listOperations")
        return send(200, {
          ...fixtures.OperationReceiptPage,
          items: [...receipts.values()]
            .map((item) => item.receipt)
            .filter(
              (item) =>
                !url.searchParams.has("clientMutationId") ||
                item.clientMutationId ===
                  url.searchParams.get("clientMutationId"),
            ),
          nextCursor: null,
        });
      if (
        req.headers["last-event-id"] === "expired" ||
        url.searchParams.get("cursor") === "expired"
      )
        return error("cursor_expired", 410);
      if (route.stream) {
        res.setHeader("Content-Type", "text/event-stream");
        res.statusCode = 200;
        return res.end(
          `: simulator\nid: ${fixtures.Event.eventId}\nevent: ${fixtures.Event.type}\ndata: ${JSON.stringify(fixtures.Event)}\n\n`,
        );
      }
      if (route.operationId === "downloadArtifact")
        return error("requires_owner_action", 403);
      return send(route.status, fixtures[route.response]);
    } catch (e) {
      error(
        e instanceof MobileContractError ? e.code : "invalid_input",
        e instanceof MobileContractError ? e.status : 422,
      );
    }
  });
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const port = Number(process.env.AGENTS_ONE_MOBILE_MOCK_PORT ?? 4281);
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw new Error("Invalid simulator port");
  createMobileMockServer().listen(port, "127.0.0.1", () =>
    process.stdout.write(
      `Contract simulator: http://127.0.0.1:${port}; synthetic data only, no Owner auth or Runtime execution.\n`,
    ),
  );
}
