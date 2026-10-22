import { pathToFileURL } from "node:url";

const expression = `({ rootChildren: document.getElementById('root')?.childElementCount || 0, workspace: !!document.querySelector('.layout .sidebar-nav'), api: !!window.agentsOneAPI })`;

/** Read only UI readiness; reload a blank page once without touching task stores. */
export async function ensureWorkspace(
  call,
  { wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {},
) {
  let state;
  for (let attempt = 0; attempt < 5; attempt++) {
    state = (
      await call("Runtime.evaluate", { expression, returnByValue: true })
    ).result?.value;
    if (state?.workspace && state.api) return { ok: true, recovered: false };
    await wait(500);
  }
  // An already rendered page may be starting or showing an error. Never discard
  // its drafts merely because the normal workspace selector isn't present.
  const blank = state?.rootChildren === 0;
  if (blank) {
    await call("Network.enable");
    await call("Network.setCacheDisabled", { cacheDisabled: true });
  }
  try {
    if (blank) await call("Page.reload", { ignoreCache: true });
    for (let attempt = 0; attempt < 40; attempt++) {
      state = (
        await call("Runtime.evaluate", { expression, returnByValue: true })
      ).result?.value;
      if (state?.workspace && state.api) return { ok: true, recovered: blank };
      await wait(500);
    }
    throw Error(
      "Renderer did not display the workspace. See renderer errors in the launcher log.",
    );
  } finally {
    if (blank) await call("Network.setCacheDisabled", { cacheDisabled: false });
  }
}

async function main() {
  const port = Number(process.argv[process.argv.indexOf("--port") + 1]);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw Error("A valid local debugger port is required.");
  const targets = await (
    await fetch(`http://127.0.0.1:${port}/json/list`, {
      signal: AbortSignal.timeout(5000),
    })
  ).json();
  const target = targets.find((item) => {
    if (item.type !== "page" || item.title !== "Agents One") return false;
    try {
      const url = new URL(item.url);
      return (
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) &&
        url.pathname === "/"
      );
    } catch {
      return false;
    }
  });
  if (!target?.webSocketDebuggerUrl)
    throw Error("Agents One development page was not found.");
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(Error("Debugger connection timed out.")),
      5000,
    );
    socket.addEventListener(
      "open",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
    socket.addEventListener(
      "error",
      () => {
        clearTimeout(timer);
        reject(Error("Debugger connection failed."));
      },
      { once: true },
    );
  });
  let sequence = 0;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    const waiter = pending.get(message.id);
    if (!waiter) return;
    clearTimeout(waiter.timer);
    pending.delete(message.id);
    if (message.error) waiter.reject(Error(message.error.message));
    else waiter.resolve(message.result);
  });
  function call(method, params = {}) {
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(Error(`Debugger request timed out: ${method}`));
      }, 5000);
      pending.set(id, { resolve, reject, timer });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }
  try {
    console.log(JSON.stringify(await ensureWorkspace(call)));
  } finally {
    for (const waiter of pending.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(Error("Debugger connection closed."));
    }
    socket.close();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
