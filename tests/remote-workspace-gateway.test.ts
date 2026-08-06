import { createHash } from "crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "fs";
import http from "http";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  confirmRemoteWorkspaceDelete,
  createRemoteWorkspaceGrant,
  executeRemoteWorkspaceRequest,
  OutboundRemoteWorkspaceGateway,
  probeRemoteWorkspaceGateway,
} from "../src/main/remote-workspace-gateway";

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

describe("remote workspace gateway", () => {
  let root = "";

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "agents-one-workspace-"));
    writeFileSync(join(root, "existing.txt"), "before", "utf8");
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function grant(
    permission: "read" | "write" = "write",
  ): ReturnType<typeof createRemoteWorkspaceGrant> {
    return createRemoteWorkspaceGrant({
      taskId: "task-1",
      runtimeId: "remote-hermes",
      rootPath: root,
      permission,
      expiresAt: Date.now() + 60_000,
    });
  }

  it("limits operations to the granted root and checks write conflicts", () => {
    const active = grant();
    expect(
      executeRemoteWorkspaceRequest(active, {
        id: "list-root",
        operation: "list",
        path: ".",
      }),
    ).toMatchObject({
      status: "succeeded",
      data: { entries: [{ path: "existing.txt", type: "file", size: 6 }] },
    });

    expect(
      executeRemoteWorkspaceRequest(active, {
        id: "escape",
        operation: "read",
        path: "../outside.txt",
      }),
    ).toMatchObject({
      status: "denied",
      summary: expect.stringMatching(/escapes/i),
    });

    expect(
      executeRemoteWorkspaceRequest(active, {
        id: "conflict",
        operation: "write",
        path: "existing.txt",
        content: "after",
        expectedSha256: hash("wrong"),
      }),
    ).toMatchObject({
      status: "denied",
      summary: expect.stringMatching(/changed/i),
    });
    expect(readFileSync(join(root, "existing.txt"), "utf8")).toBe("before");

    expect(
      executeRemoteWorkspaceRequest(active, {
        id: "write",
        operation: "write",
        path: "nested/result.txt",
        content: "accepted result",
      }),
    ).toMatchObject({
      status: "succeeded",
      data: { path: "nested/result.txt", sha256: hash("accepted result") },
    });
  });

  it("treats a remote POSIX root slash as the granted project root", () => {
    const active = createRemoteWorkspaceGrant({
      taskId: "task-permanent",
      runtimeId: "remote-hermes",
      rootPath: root,
      permission: "read",
    });
    expect(active.expiresAt).toBeNull();
    expect(
      executeRemoteWorkspaceRequest(active, {
        id: "list-posix-root",
        operation: "list",
        path: "/",
      }),
    ).toMatchObject({
      status: "succeeded",
      data: { entries: [{ path: "existing.txt", type: "file" }] },
    });
  });

  it("redacts a disappeared workspace root from ENOENT results", () => {
    const active = grant();
    rmSync(root, { recursive: true, force: true });
    expect(
      executeRemoteWorkspaceRequest(active, {
        id: "list-missing-root",
        operation: "list",
        path: ".",
      }),
    ).toMatchObject({
      status: "denied",
      summary:
        "Workspace root is no longer available. Please reselect the folder.",
    });
  });

  it("does not follow links and requires a local confirmation for delete", () => {
    const active = grant();
    const outside = join(tmpdir(), `agents-one-outside-${Date.now()}.txt`);
    writeFileSync(outside, "outside", "utf8");
    try {
      symlinkSync(outside, join(root, "outside-link.txt"));
      expect(
        executeRemoteWorkspaceRequest(active, {
          id: "link-read",
          operation: "read",
          path: "outside-link.txt",
        }),
      ).toMatchObject({
        status: "denied",
        summary: expect.stringMatching(/symbolic/i),
      });
    } catch (error) {
      // Corporate Windows machines commonly forbid developer symlinks. The
      // executor still checks links whenever the filesystem can create them.
      expect((error as NodeJS.ErrnoException).code).toBe("EPERM");
    }

    const pending = {
      id: "delete",
      operation: "delete" as const,
      path: "existing.txt",
      expectedSha256: hash("before"),
    };
    expect(executeRemoteWorkspaceRequest(active, pending)).toMatchObject({
      status: "confirmation_required",
    });
    expect(readFileSync(join(root, "existing.txt"), "utf8")).toBe("before");
    expect(confirmRemoteWorkspaceDelete(active, pending)).toMatchObject({
      status: "succeeded",
    });
    rmSync(outside, { force: true });
  });

  it("keeps read-only grants read-only", () => {
    expect(
      executeRemoteWorkspaceRequest(grant("read"), {
        id: "write-denied",
        operation: "write",
        path: "new.txt",
        content: "nope",
      }),
    ).toMatchObject({
      status: "denied",
      summary: expect.stringMatching(/read-only/i),
    });
  });
});

describe("outbound remote workspace gateway client", () => {
  let server: http.Server;
  let baseUrl = "";
  let root = "";
  let respondWithRequestIdAlias = false;
  let respondWithMissingGrantOnce = false;
  let respondWithExpiredGrantOnce = false;
  let pulledRequest: Record<string, unknown>;
  const received: Array<{ url: string; body: string }> = [];

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), "agents-one-workspace-client-"));
    pulledRequest = {
      id: "remote-write",
      operation: "write",
      path: "from-remote.txt",
      content: "outbound only",
    };
    server = http.createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        received.push({ url: request.url || "", body });
        response.setHeader("Content-Type", "application/json");
        if (request.url === "/workspace-gateway/capabilities") {
          response.end(
            JSON.stringify({
              capabilities: {
                outboundWorkspaceGateway: true,
                operations: ["list", "read", "write", "move", "delete"],
              },
            }),
          );
          return;
        }
        if (request.url === "/capabilities") {
          response.end(
            JSON.stringify({
              protocolVersion: "1.0",
              capabilities: {
                outboundWorkspaceGateway: {
                  enabled: true,
                  operations: ["list", "read", "write", "move", "delete"],
                  maxOperationBytes: 262144,
                  maxGrantSeconds: 1800,
                },
              },
            }),
          );
          return;
        }
        if (request.url === "/workspace-gateway/grants") {
          expect(body).not.toContain(root);
          response.end(JSON.stringify({ accepted: true }));
          return;
        }
        if (request.url === "/workspace-grants") {
          expect(body).not.toContain(root);
          const payload = JSON.parse(body) as { grantId: string };
          response.end(
            JSON.stringify({ accepted: true, grantId: payload.grantId }),
          );
          return;
        }
        if (request.url?.endsWith("/pull")) {
          if (respondWithMissingGrantOnce) {
            respondWithMissingGrantOnce = false;
            response.statusCode = 404;
            response.end(
              JSON.stringify({ error: { code: "grant_not_found" } }),
            );
            return;
          }
          if (respondWithExpiredGrantOnce) {
            respondWithExpiredGrantOnce = false;
            response.statusCode = 403;
            response.end(JSON.stringify({ error: { code: "grant_expired" } }));
            return;
          }
          response.end(
            JSON.stringify({
              request: {
                ...pulledRequest,
                ...(respondWithRequestIdAlias
                  ? { id: undefined, requestId: pulledRequest.id }
                  : {}),
              },
            }),
          );
          return;
        }
        if (
          request.url?.endsWith("/results") ||
          request.url?.endsWith("/revoke")
        ) {
          response.end(JSON.stringify({ accepted: true }));
          return;
        }
        response.statusCode = 404;
        response.end(JSON.stringify({ error: "missing" }));
      });
    });
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (typeof address === "object" && address)
          baseUrl = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    rmSync(root, { recursive: true, force: true });
    received.length = 0;
    respondWithRequestIdAlias = false;
    respondWithMissingGrantOnce = false;
    respondWithExpiredGrantOnce = false;
  });

  it("allows private-network HTTP for local testing but rejects public plaintext", async () => {
    await expect(
      probeRemoteWorkspaceGateway({
        endpoint: "http://relay.example/agents-one/v1",
        bearerToken: "gateway-token",
      }),
    ).rejects.toThrow("requires HTTPS");

    await expect(
      probeRemoteWorkspaceGateway({ endpoint: baseUrl }),
    ).resolves.toMatchObject({ outboundWorkspaceGateway: true });
  });

  it("uses desktop outbound requests and returns a bounded audited result", async () => {
    const config = { endpoint: baseUrl, bearerToken: "bridge-token" };
    await expect(probeRemoteWorkspaceGateway(config)).resolves.toMatchObject({
      outboundWorkspaceGateway: true,
      operations: expect.arrayContaining(["write"]),
    });
    const gateway = new OutboundRemoteWorkspaceGateway(
      config,
      createRemoteWorkspaceGrant({
        taskId: "run-1",
        runtimeId: "openclaw",
        rootPath: root,
        permission: "write",
        expiresAt: Date.now() + 60_000,
      }),
    );
    await gateway.register();
    await expect(gateway.pollOnce()).resolves.toMatchObject({
      status: "succeeded",
    });
    expect(readFileSync(join(root, "from-remote.txt"), "utf8")).toBe(
      "outbound only",
    );
    expect(gateway.audit).toMatchObject([
      { operation: "write", status: "succeeded" },
    ]);
    await gateway.revoke();
    expect(received.some((item) => item.url.endsWith("/results"))).toBe(true);
  });

  it("accepts a separately hosted gateway URL without duplicating its path", async () => {
    await expect(
      probeRemoteWorkspaceGateway({
        endpoint: `${baseUrl}/workspace-gateway`,
        bearerToken: "bridge-token",
      }),
    ).resolves.toMatchObject({ outboundWorkspaceGateway: true });
    expect(received.at(-1)?.url).toBe("/workspace-gateway/capabilities");
  });

  it("maps the unified Gateway v1 workspace grant contract without exposing the local root", async () => {
    const config = {
      endpoint: baseUrl,
      bearerToken: "gateway-token",
      contract: "agents-one-v1" as const,
    };
    await expect(probeRemoteWorkspaceGateway(config)).resolves.toMatchObject({
      outboundWorkspaceGateway: true,
      operations: ["list", "read", "write", "move", "delete"],
      maxGrantSeconds: 1800,
    });
    const activeGrant = createRemoteWorkspaceGrant({
      taskId: "run-v1",
      runtimeId: "hers",
      rootPath: root,
      permission: "write",
      expiresAt: Date.now() + 60_000,
    });
    const gateway = new OutboundRemoteWorkspaceGateway(config, activeGrant);
    await gateway.register();
    await expect(gateway.pollOnce()).resolves.toMatchObject({
      status: "succeeded",
      data: { path: "from-remote.txt" },
    });
    await gateway.revoke();

    expect(received.some((item) => item.url === "/capabilities")).toBe(true);
    const registration = received.find(
      (item) => item.url === "/workspace-grants",
    );
    expect(registration?.body).toContain(activeGrant.id);
    expect(registration?.body).not.toContain(root);
    expect(
      received.some((item) =>
        item.url.startsWith(`/workspace-grants/${activeGrant.id}/`),
      ),
    ).toBe(true);
  });

  it("registers a non-expiring Grant for explicit revocation", async () => {
    const config = {
      endpoint: baseUrl,
      bearerToken: "gateway-token",
      contract: "agents-one-v1" as const,
    };
    const activeGrant = createRemoteWorkspaceGrant({
      taskId: "run-permanent",
      runtimeId: "hers",
      rootPath: root,
      permission: "write",
    });
    const gateway = new OutboundRemoteWorkspaceGateway(config, activeGrant);
    await gateway.register();
    const registration = received.find(
      (item) => item.url === "/workspace-grants",
    );
    expect(JSON.parse(registration?.body || "{}")).toMatchObject({
      expiresAt: null,
    });
    await gateway.revoke("User cancelled workspace access.");
  });

  it("accepts the Relay requestId compatibility alias without changing the server ID", async () => {
    respondWithRequestIdAlias = true;
    const gateway = new OutboundRemoteWorkspaceGateway(
      {
        endpoint: baseUrl,
        bearerToken: "gateway-token",
        contract: "agents-one-v1" as const,
      },
      createRemoteWorkspaceGrant({
        taskId: "run-v1-alias",
        runtimeId: "hers",
        rootPath: root,
        permission: "write",
        expiresAt: Date.now() + 60_000,
      }),
    );
    await gateway.register();
    await expect(gateway.pollOnce()).resolves.toMatchObject({
      requestId: "remote-write",
      status: "succeeded",
    });
    const result = received.find((item) => item.url.endsWith("/results"));
    expect(result?.body).toContain('"requestId":"remote-write"');
  });

  it("re-registers the current Grant after Relay loses its registration", async () => {
    respondWithMissingGrantOnce = true;
    const config = {
      endpoint: baseUrl,
      bearerToken: "gateway-token",
      contract: "agents-one-v1" as const,
    };
    const activeGrant = createRemoteWorkspaceGrant({
      taskId: "run-recover-grant",
      runtimeId: "hers",
      rootPath: root,
      permission: "write",
      expiresAt: Date.now() + 60_000,
    });
    const gateway = new OutboundRemoteWorkspaceGateway(config, activeGrant);
    await gateway.register();

    await expect(gateway.pollOnce()).resolves.toBeNull();
    await expect(gateway.pollOnce()).resolves.toMatchObject({
      status: "succeeded",
      requestId: "remote-write",
    });
    expect(
      received.filter((item) => item.url === "/workspace-grants").length,
    ).toBe(2);
  });

  it("renews a non-expiring Grant when an older Relay imposes a TTL", async () => {
    respondWithExpiredGrantOnce = true;
    const config = {
      endpoint: baseUrl,
      bearerToken: "gateway-token",
      contract: "agents-one-v1" as const,
    };
    const activeGrant = createRemoteWorkspaceGrant({
      taskId: "run-renew-grant",
      runtimeId: "hers",
      rootPath: root,
      permission: "write",
    });
    const gateway = new OutboundRemoteWorkspaceGateway(config, activeGrant);
    await gateway.register();

    await expect(gateway.pollOnce()).resolves.toBeNull();
    await expect(gateway.pollOnce()).resolves.toMatchObject({
      status: "succeeded",
      requestId: "remote-write",
    });
    expect(
      received.filter((item) => item.url === "/workspace-grants").length,
    ).toBe(2);
  });

  it("deletes only after the local user approves the specific request", async () => {
    writeFileSync(join(root, "delete-me.txt"), "temporary", "utf8");
    pulledRequest = {
      id: "remote-delete",
      operation: "delete",
      path: "delete-me.txt",
      expectedSha256: hash("temporary"),
    };
    const confirmed: string[] = [];
    const gateway = new OutboundRemoteWorkspaceGateway(
      {
        endpoint: baseUrl,
        bearerToken: "gateway-token",
        contract: "agents-one-v1" as const,
      },
      createRemoteWorkspaceGrant({
        taskId: "run-delete",
        runtimeId: "hers",
        rootPath: root,
        permission: "write",
        expiresAt: Date.now() + 60_000,
      }),
      {
        confirmDelete: async (request) => {
          confirmed.push(request.path);
          return true;
        },
      },
    );
    await gateway.register();
    await expect(gateway.pollOnce()).resolves.toMatchObject({
      requestId: "remote-delete",
      status: "succeeded",
    });
    expect(confirmed).toEqual(["delete-me.txt"]);
    expect(existsSync(join(root, "delete-me.txt"))).toBe(false);
    const result = received.find((item) => item.url.endsWith("/results"));
    expect(result?.body).toContain('"requestId":"remote-delete"');
    expect(result?.body).toContain('"status":"succeeded"');
  });

  it("keeps the file when the local user rejects deletion", async () => {
    writeFileSync(join(root, "keep-me.txt"), "important", "utf8");
    pulledRequest = {
      id: "remote-delete-rejected",
      operation: "delete",
      path: "keep-me.txt",
      expectedSha256: hash("important"),
    };
    const gateway = new OutboundRemoteWorkspaceGateway(
      {
        endpoint: baseUrl,
        bearerToken: "gateway-token",
        contract: "agents-one-v1" as const,
      },
      createRemoteWorkspaceGrant({
        taskId: "run-delete-rejected",
        runtimeId: "hers",
        rootPath: root,
        permission: "write",
        expiresAt: Date.now() + 60_000,
      }),
      { confirmDelete: async () => false },
    );
    await gateway.register();
    await expect(gateway.pollOnce()).resolves.toMatchObject({
      requestId: "remote-delete-rejected",
      status: "denied",
    });
    expect(readFileSync(join(root, "keep-me.txt"), "utf8")).toBe("important");
  });
});
