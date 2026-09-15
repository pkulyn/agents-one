import { spawn } from "node:child_process";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { resolve } from "node:path";

function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolveBody, reject) => {
    let value = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => (value += chunk));
    request.on("end", () => {
      try {
        resolveBody(JSON.parse(value) as Record<string, unknown>);
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function runScript(env: NodeJS.ProcessEnv): Promise<Record<string, unknown>> {
  return new Promise((resolveRun, reject) => {
    const child = spawn(
      process.execPath,
      [resolve("scripts/diagnose-gateway-sse-post.mjs")],
      {
        cwd: resolve("."),
        env: { ...process.env, ...env },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code !== 0) {
        reject(new Error(`diagnostic exited ${code}: ${stderr}`));
        return;
      }
      resolveRun(JSON.parse(stdout) as Record<string, unknown>);
    });
  });
}

describe("Gateway SSE diagnostic", () => {
  it.each([
    { prefix: "/agents-one/v1", contract: "gateway-v1", idKey: "id" },
    { prefix: "/v1", contract: "hermes-v1", idKey: "run_id" },
  ])(
    "supports the $contract run contract",
    async ({ prefix, contract, idKey }) => {
      const bodies: Record<string, unknown>[] = [];
      let nextRun = 0;
      const server = createServer(
        async (request: IncomingMessage, response: ServerResponse) => {
          if (request.method === "POST" && request.url === `${prefix}/runs`) {
            bodies.push(await readBody(request));
            nextRun += 1;
            response.writeHead(202, { "content-type": "application/json" });
            response.end(JSON.stringify({ [idKey]: `run-${nextRun}` }));
            return;
          }
          if (
            request.method === "GET" &&
            request.url?.startsWith(`${prefix}/runs/run-`) &&
            request.url.endsWith("/events")
          ) {
            response.writeHead(200, { "content-type": "text/event-stream" });
            response.end("event: run.completed\ndata: {}\n\n");
            return;
          }
          response.writeHead(404).end();
        },
      );
      await new Promise<void>((resolveListen) =>
        server.listen(0, "127.0.0.1", resolveListen),
      );
      try {
        const address = server.address();
        if (!address || typeof address === "string") throw new Error("No port");
        const result = await runScript({
          AGENTS_ONE_GATEWAY_URL: `http://127.0.0.1:${address.port}${prefix}`,
          AGENTS_ONE_GATEWAY_TOKEN: "test-token-not-a-secret",
          AGENTS_ONE_GATEWAY_RUNTIME_ID: "test-runtime",
          AGENTS_ONE_GATEWAY_CONTRACT: "auto",
        });
        expect(result.contract).toBe(contract);
        expect(bodies).toHaveLength(4);
        if (contract === "hermes-v1") {
          expect(bodies.every((body) => typeof body.input === "string")).toBe(
            true,
          );
        } else {
          expect(
            bodies.every(
              (body) =>
                typeof body.input === "object" &&
                body.runtimeId === "test-runtime",
            ),
          ).toBe(true);
        }
        const sequences = result.sequences as Array<Record<string, unknown>>;
        expect(sequences).toHaveLength(2);
        for (const sequence of sequences) {
          expect((sequence.firstPost as Record<string, unknown>).hasRunId).toBe(
            true,
          );
          expect(
            (sequence.events as Record<string, unknown>).hasSseFrames,
          ).toBe(true);
          expect(
            (sequence.secondPost as Record<string, unknown>).hasRunId,
          ).toBe(true);
        }
      } finally {
        await new Promise<void>((resolveClose, reject) =>
          server.close((error) => (error ? reject(error) : resolveClose())),
        );
      }
    },
  );
});
