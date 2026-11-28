const defaultEndpoint =
  process.env.AGENTS_ONE_LOOPBACK_GATEWAY ||
  process.env.HERMES_GATEWAY_ENDPOINT ||
  "http://127.0.0.1:8642";
const defaultToken =
  process.env.AGENTS_ONE_GATEWAY_TOKEN ||
  process.env.HERMES_GATEWAY_TOKEN ||
  "";

const allowedPath = (path) =>
  typeof path === "string" &&
  path.length <= 2048 &&
  path.startsWith("/") &&
  !path.includes("..") &&
  /^\/(capabilities|commands\/(?:catalog|execute)|runs(?:\/[A-Za-z0-9._:-]+(?:\/events|\/cancel|\/permissions\/[A-Za-z0-9_-]+)?)?|artifacts(?:\/[A-Za-z0-9._:-]+)?|workspace-grants(?:\/[A-Za-z0-9._:-]+(?:\/requests|\/results|\/revoke)?)?)$/.test(
    path,
  );

/** Bind a Runtime to its locally configured Gateway endpoint and credentials. */
export function createLoopbackGatewayAdapter({
  endpoint = defaultEndpoint,
  token = defaultToken,
} = {}) {
  const base = endpoint.replace(/\/+$/, "");
  const bearer = token.trim();
  return async function onRequest(frame) {
    if (!allowedPath(frame.path))
      return { status: 400, body: { error: "Gateway path is not allowed." } };
    const eventSnapshot = frame.path.endsWith("/events");
    const response = await fetch(`${base}${frame.path}`, {
      method: frame.method || "GET",
      redirect: "error",
      headers: {
        accept: eventSnapshot ? "text/event-stream" : "application/json",
        ...(eventSnapshot &&
        Number.isSafeInteger(frame.afterSequence) &&
        frame.afterSequence >= 0
          ? { "last-event-id": String(frame.afterSequence) }
          : {}),
        ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
        ...(typeof frame.runtimeId === "string" && frame.runtimeId.trim()
          ? { "x-agents-one-runtime-id": frame.runtimeId.trim() }
          : {}),
        ...(frame.body === undefined
          ? {}
          : { "content-type": "application/json" }),
      },
      ...(frame.body === undefined ? {} : { body: JSON.stringify(frame.body) }),
    });
    const contentType = response.headers.get("content-type") || "";
    return {
      status: response.status,
      body:
        eventSnapshot && contentType.startsWith("text/event-stream")
          ? await response.text()
          : await response.json().catch(() => undefined),
    };
  };
}

export default createLoopbackGatewayAdapter();
