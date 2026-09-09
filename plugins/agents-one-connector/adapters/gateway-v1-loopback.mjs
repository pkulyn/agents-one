/* eslint-disable @typescript-eslint/explicit-function-return-type */

/**
 * Generic Gateway v1 loopback adapter.
 *
 * It works for any remote agent that exposes the Agents One Gateway v1
 * contract on localhost. The adapter never accepts an arbitrary URL from a
 * tunnel frame and never exposes the loopback port publicly.
 */
const endpoint = (
  process.env.AGENTS_ONE_LOOPBACK_GATEWAY ||
  process.env.HERMES_GATEWAY_ENDPOINT ||
  "http://127.0.0.1:8642"
).replace(/\/+$/, "");
const token = (
  process.env.AGENTS_ONE_GATEWAY_TOKEN ||
  process.env.HERMES_GATEWAY_TOKEN ||
  ""
).trim();

const allowedPath = (path) =>
  typeof path === "string" &&
  path.length <= 2048 &&
  path.startsWith("/") &&
  !path.includes("..") &&
  /^\/(capabilities|commands\/(?:catalog|execute)|runs(?:\/[A-Za-z0-9._:-]+(?:\/events|\/cancel)?)?|artifacts(?:\/[A-Za-z0-9._:-]+)?|workspace-grants(?:\/[A-Za-z0-9._:-]+(?:\/requests|\/results|\/revoke)?)?)$/.test(
    path,
  );

export default async function onRequest(frame) {
  if (!allowedPath(frame.path))
    return { status: 400, body: { error: "Gateway path is not allowed." } };
  const response = await fetch(`${endpoint}${frame.path}`, {
    method: frame.method || "GET",
    headers: {
      accept: "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(typeof frame.runtimeId === "string" && frame.runtimeId.trim()
        ? { "x-agents-one-runtime-id": frame.runtimeId.trim() }
        : {}),
      ...(frame.body === undefined
        ? {}
        : { "content-type": "application/json" }),
    },
    ...(frame.body === undefined ? {} : { body: JSON.stringify(frame.body) }),
  });
  return {
    status: response.status,
    body: await response.json().catch(() => undefined),
  };
}
