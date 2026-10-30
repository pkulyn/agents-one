/** Claude command hook. No credentials or decisions are written to disk. */
import { request } from "node:http";
let body = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  body += chunk;
  if (body.length > 256 * 1024) process.exit(1);
});
process.stdin.on("end", () => {
  const finish = (allowed: boolean): void => {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: allowed ? "allow" : "deny",
          permissionDecisionReason: allowed
            ? "Agents One 本次工具授权"
            : "本次删除未获授权，操作未执行。",
        },
      }),
    );
  };
  try {
    const input = JSON.parse(body);
    const url = new URL(process.env.AGENTS_ONE_PERMISSION_URL || "");
    if (url.hostname !== "127.0.0.1" || url.protocol !== "http:")
      return finish(false);
    const payload = JSON.stringify({
      name: input.tool_name,
      input: input.tool_input || {},
    });
    const req = request(
      url,
      {
        method: "POST",
        headers: {
          Authorization: "Bearer " + process.env.AGENTS_ONE_PERMISSION_TOKEN,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
      },
      (res) => {
        let response = "";
        res.on("data", (chunk) => (response += chunk));
        res.on("end", () => {
          try {
            finish(
              res.statusCode === 200 && JSON.parse(response).allowed === true,
            );
          } catch {
            finish(false);
          }
        });
      },
    );
    req.on("error", () => finish(false));
    req.end(payload);
  } catch {
    finish(false);
  }
});
