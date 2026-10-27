import { readSync, writeSync } from "node:fs";
import { createProjectTextWriter } from "./project-text-write";

let buffered = Buffer.alloc(0);
function frame(): Record<string, unknown> {
  for (;;) {
    const newline = buffered.indexOf(10);
    if (newline >= 0) {
      const value = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(
          buffered.subarray(0, newline),
        ),
      );
      buffered = buffered.subarray(newline + 1);
      if (!value || typeof value !== "object" || Array.isArray(value))
        throw Error();
      return value;
    }
    if (buffered.length > 2 * 1024 * 1024) throw Error();
    const chunk = Buffer.alloc(4096),
      count = readSync(0, chunk, 0, chunk.length, null);
    if (!count) throw Error();
    buffered = Buffer.concat([buffered, chunk.subarray(0, count)]);
  }
}
function send(value: unknown): void {
  const bytes = Buffer.from(JSON.stringify(value) + "\n");
  let offset = 0;
  while (offset < bytes.length)
    offset += writeSync(1, bytes, offset, bytes.length - offset);
}
try {
  const input = frame();
  if (
    Object.keys(input).sort().join(",") !== "expectedSha256,path,root,text" ||
    typeof input.root !== "string"
  )
    throw Error();
  const writer = createProjectTextWriter(
    input.root,
    () => undefined,
    (intent) => {
      send({ kind: "prepared", intent });
      const approval = frame();
      if (
        Object.keys(approval).join(",") !== "commit" ||
        approval.commit !== true
      )
        throw Error();
    },
  );
  const receipt = writer.write(input.path, input.text, input.expectedSha256);
  send({ kind: "applied", receipt });
} catch {
  send({ kind: "failed" });
  process.exitCode = 1;
}
