#!/usr/bin/env node
import { createConnectService } from "../src/server.mjs";
import { readFileSync } from "node:fs";

const host = process.env.CONNECT_HOST?.trim() || "127.0.0.1";
const port = Number.parseInt(process.env.CONNECT_PORT || "8788", 10);
if (!Number.isInteger(port) || port < 0 || port > 65_535) {
  throw new Error("CONNECT_PORT must be an integer between 0 and 65535.");
}

const tlsKeyFile = process.env.CONNECT_TLS_KEY_FILE?.trim();
// The server certificate must be a PEM full chain (leaf first, then any
// intermediate certificates). Keep CONNECT_TLS_CERT_FILE for compatibility;
// the explicit *_CHAIN_FILE name makes the deployment requirement visible.
const tlsCertFile =
  process.env.CONNECT_TLS_CERT_CHAIN_FILE?.trim() ||
  process.env.CONNECT_TLS_CERT_FILE?.trim();
// `ca` in node:https is for verifying client certificates (mTLS), not for
// sending intermediate certificates to desktop/browser clients. Preserve the
// old variable while exposing the less ambiguous name for new deployments.
const tlsCaFile =
  process.env.CONNECT_TLS_CLIENT_CA_FILE?.trim() ||
  process.env.CONNECT_TLS_CA_FILE?.trim();
if (Boolean(tlsKeyFile) !== Boolean(tlsCertFile)) {
  throw new Error(
    "CONNECT_TLS_KEY_FILE and CONNECT_TLS_CERT_FILE must be provided together.",
  );
}
const tls =
  tlsKeyFile && tlsCertFile
    ? {
        key: readFileSync(tlsKeyFile),
        cert: readFileSync(tlsCertFile),
        ...(tlsCaFile ? { ca: readFileSync(tlsCaFile) } : {}),
      }
    : undefined;
const service = createConnectService({
  tls,
  storagePath: process.env.CONNECT_STATE_FILE?.trim() || undefined,
  logger: (cause) => console.error("connect request failed", cause),
});
const address = await service.listen(port, host);
console.log(
  JSON.stringify({
    status: "listening",
    host: address.address,
    port: address.port,
    protocol: tls ? "connect-v1-https" : "connect-v1",
  }),
);

const shutdown = async () => {
  await service.close();
  process.exit(0);
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
