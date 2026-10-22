import { afterEach, describe, expect, it } from "vitest";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMobileControlService } from "../services/agents-one-connect/src/mobile-control.mjs";
import { createConnectService } from "../services/agents-one-connect/src/server.mjs";
import { assertMobileSchema } from "../src/shared/mobile-control";
const cleanup: (() => Promise<unknown> | void)[] = [];
afterEach(async () => {
  for (const clean of cleanup.splice(0).reverse()) await clean();
});
const admin = "owner-secret-" + "a".repeat(40),
  other = "owner-secret-" + "b".repeat(40);
async function setup() {
  const dir = mkdtempSync(join(tmpdir(), "agents-one-mobile-auth-"));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  let time = Date.now();
  const storagePath = join(dir, "mobile.json");
  const options = {
    owners: [
      {
        ownerId: "owner-1",
        spaceId: "space-1",
        label: "Desktop",
        adminToken: admin,
      },
      {
        ownerId: "owner-2",
        spaceId: "space-2",
        label: "Other",
        adminToken: other,
      },
    ],
    storagePath,
    stateKey: "c".repeat(64),
    now: () => time,
  };
  let service = createMobileControlService(options);
  const server = createServer(async (req, res) => {
    if (!(await service.handle(req, res, new URL(req.url!, "http://local")))) {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanup.push(
    () =>
      new Promise<void>((resolve, reject) => {
        server.close((e) => (e ? reject(e) : resolve()));
        server.closeAllConnections();
      }),
  );
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  async function request(
    path: string,
    method = "GET",
    token = admin,
    input?: unknown,
    key?: string,
  ) {
    const response = await fetch(origin + path, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(key ? { "Idempotency-Key": key, "X-Client-Mutation-Id": key } : {}),
      },
      body: input === undefined ? undefined : JSON.stringify(input),
    });
    return {
      status: response.status,
      body: await response.json(),
      cache: response.headers.get("cache-control"),
    };
  }
  const management = (
    path: string,
    method = "GET",
    input?: unknown,
    token = admin,
  ) => request("/agents-one/mobile/admin/v1" + path, method, token, input);
  const mobile = (
    path: string,
    method = "GET",
    token = "",
    input?: unknown,
    key?: string,
  ) => request("/agents-one/mobile/v1" + path, method, token, input, key);
  async function paired() {
    await management("/enabled", "PUT", { enabled: true });
    const invitation = (await management("/invitations", "POST", {})).body;
    const claim = (
      await mobile("/pairing/claims", "POST", "", {
        invitation: invitation.invitation,
        deviceLabel: "Phone",
      })
    ).body;
    expect(() => assertMobileSchema("PairingClaim", claim)).not.toThrow();
    await management(`/claims/${claim.id}/approve`, "POST", {
      verificationPhrase: claim.verificationPhrase,
      scopes: ["conversation:read", "schedule:read"],
    });
    const credentials = await mobile(
      `/pairing/claims/${claim.id}/exchange`,
      "POST",
      claim.claimProof,
      {},
      "exchange-1",
    );
    expect(credentials.status).toBe(200);
    expect(() =>
      assertMobileSchema("Credentials", credentials.body),
    ).not.toThrow();
    return { invitation, claim, credentials: credentials.body };
  }
  return {
    management,
    mobile,
    paired,
    storagePath,
    options,
    advance: (ms: number) => (time += ms),
    restart: () => (service = createMobileControlService(options)),
  };
}
describe("mobile device authority", () => {
  it("rejects shared Gateway state paths before either store is opened", () => {
    expect(() => createConnectService({storagePath:"same-state.json", mobile:{storagePath:"same-state.json"}})).toThrow("must be separate");
    expect(() => createMobileControlService({owners:{}})).toThrow("must be an array");
  });
  it("allows approval polling without consuming the exchange budget", async () => {
    const s = await setup();
    await s.management("/enabled", "PUT", { enabled: true });
    const invitation = (await s.management("/invitations", "POST", {})).body
      .invitation;
    const claim = (
      await s.mobile("/pairing/claims", "POST", "", {
        invitation,
        deviceLabel: "Phone",
      })
    ).body;
    for (let n = 0; n < 35; n++)
      expect(
        (await s.mobile(`/pairing/claims/${claim.id}`, "GET", claim.claimProof))
          .status,
      ).toBe(200);
    await s.management(`/claims/${claim.id}/approve`, "POST", {
      verificationPhrase: claim.verificationPhrase,
      scopes: ["conversation:read"],
    });
    expect(
      (
        await s.mobile(
          `/pairing/claims/${claim.id}/exchange`,
          "POST",
          claim.claimProof,
          { clientMutationId: "wrong" },
          "exchange-1",
        )
      ).status,
    ).toBe(422);
    expect(
      (
        await s.mobile(
          `/pairing/claims/${claim.id}/exchange`,
          "POST",
          claim.claimProof,
          {},
          "exchange-1",
        )
      ).status,
    ).toBe(200);
  });
  it("revokes one device without revoking another device in the same space", async () => {
    const s = await setup(),
      first = await s.paired(),
      second = await s.paired();
    await s.management(`/devices/${first.credentials.deviceId}`, "DELETE");
    s.restart();
    expect(
      (await s.mobile("/owners", "GET", first.credentials.accessToken)).status,
    ).toBe(401);
    expect(
      (await s.mobile("/owners", "GET", second.credentials.accessToken)).status,
    ).toBe(200);
  });
  it("requires desktop approval, validates phrase/scopes and separates Owner tokens", async () => {
    const s = await setup();
    expect(
      (await s.management("/status", "GET", undefined, "gateway-token")).status,
    ).toBe(403);
    expect((await s.management("/invitations", "POST", {})).status).toBe(503);
    await s.management("/enabled", "PUT", { enabled: true });
    const invitation = (await s.management("/invitations", "POST", {})).body
      .invitation;
    const claim = (
      await s.mobile("/pairing/claims", "POST", "", {
        invitation,
        deviceLabel: "Phone",
      })
    ).body;
    expect(
      (
        await s.mobile(
          `/pairing/claims/${claim.id}/exchange`,
          "POST",
          claim.claimProof,
          {},
          "exchange-1",
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await s.management(`/claims/${claim.id}/approve`, "POST", {
          verificationPhrase: "wrong",
          scopes: ["conversation:read"],
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await s.management(`/claims/${claim.id}/approve`, "POST", {
          verificationPhrase: claim.verificationPhrase,
          scopes: ["admin"],
        })
      ).status,
    ).toBe(422);
    expect(
      (await s.management(`/claims/${claim.id}/reject`, "POST", {}, other))
        .status,
    ).toBe(404);
    expect(
      (
        await s.mobile("/pairing/claims", "POST", "", {
          invitation,
          deviceLabel: "Reused",
        })
      ).status,
    ).toBe(401);
  });
  it("persists encrypted grants and revocation without claiming a task channel", async () => {
    const s = await setup(),
      { credentials } = await s.paired();
    const status = (await s.management("/status")).body;
    expect(status.taskChannelReady).toBe(false);
    expect(status.devices).toHaveLength(1);
    expect(JSON.stringify(status)).not.toContain(credentials.accessToken);
    expect(readFileSync(s.storagePath, "utf8")).not.toContain(
      credentials.refreshCredential,
    );
    s.restart();
    const owners = await s.mobile("/owners", "GET", credentials.accessToken);
    expect(() =>
      assertMobileSchema("OwnerSpacePage", owners.body),
    ).not.toThrow();
    expect(owners.body.items[0].online).toBe(false);
    expect(
      (
        await s.mobile(
          "/owners/owner-1/spaces/space-1/bootstrap",
          "GET",
          credentials.accessToken,
        )
      ).status,
    ).toBe(503);
    expect(
      (
        await s.mobile(
          "/owners/owner-2/spaces/space-2/bootstrap",
          "GET",
          credentials.accessToken,
        )
      ).status,
    ).toBe(404);
    await s.management(`/devices/${credentials.deviceId}`, "DELETE");
    s.restart();
    expect(
      (await s.mobile("/owners", "GET", credentials.accessToken)).body.error
        .code,
    ).toBe("revoked");
    expect(
      (
        await s.mobile("/auth/refresh", "POST", "", {
          refreshCredential: credentials.refreshCredential,
          rotationId: "rotation-1",
        })
      ).status,
    ).toBe(401);
  });
  it("replays exchange and refresh only with the original idempotency identity", async () => {
    const s = await setup(),
      { claim, credentials } = await s.paired();
    s.advance(31_000);
    expect(
      (
        await s.mobile(
          `/pairing/claims/${claim.id}/exchange`,
          "POST",
          claim.claimProof,
          {},
          "exchange-1",
        )
      ).body,
    ).toEqual(credentials);
    expect(
      (
        await s.mobile(
          `/pairing/claims/${claim.id}/exchange`,
          "POST",
          claim.claimProof,
          {},
          "exchange-2",
        )
      ).status,
    ).toBe(409);
    const input = {
      refreshCredential: credentials.refreshCredential,
      rotationId: "rotation-1",
    };
    const first = await s.mobile("/auth/refresh", "POST", "", input);
    s.restart();
    expect((await s.mobile("/auth/refresh", "POST", "", input)).body).toEqual(
      first.body,
    );
    expect(first.body.refreshCredential).not.toBe(
      credentials.refreshCredential,
    );
    expect(
      (
        await s.mobile("/auth/refresh", "POST", "", {
          ...input,
          rotationId: "other-rotation",
        })
      ).body.error.code,
    ).toBe("refresh_reused");
    expect(
      (await s.mobile("/owners", "GET", first.body.accessToken)).status,
    ).toBe(401);
  });
  it("expires invitations and invalidates outstanding approval when disabled", async () => {
    const s = await setup();
    await s.management("/enabled", "PUT", { enabled: true });
    const invitation = (await s.management("/invitations", "POST", {})).body
      .invitation;
    s.advance(300001);
    expect(
      (
        await s.mobile("/pairing/claims", "POST", "", {
          invitation,
          deviceLabel: "Phone",
        })
      ).body.error.code,
    ).toBe("invitation_expired");
    const next = (await s.management("/invitations", "POST", {})).body
      .invitation;
    const claim = (
      await s.mobile("/pairing/claims", "POST", "", {
        invitation: next,
        deviceLabel: "Phone",
      })
    ).body;
    await s.management("/enabled", "PUT", { enabled: false });
    await s.management("/enabled", "PUT", { enabled: true });
    expect(
      (await s.mobile(`/pairing/claims/${claim.id}`, "GET", claim.claimProof))
        .body.state,
    ).toBe("rejected");
  });
  it("fails closed on corrupted persisted authorization state", async () => {
    const s = await setup();
    await s.paired();
    writeFileSync(s.storagePath, "corrupt");
    expect(() => createMobileControlService(s.options)).toThrow();
    expect(readFileSync(s.storagePath, "utf8")).toBe("corrupt");
  });
});
