import { createHash } from "crypto";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { realpath } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { verifyLocalDeliveryArtifacts } from "../src/main/runtime-delivery";

const roots: string[] = [];

afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

function workspace(): string {
  const root = mkdtempSync(join(tmpdir(), "agents-one-delivery-"));
  roots.push(root);
  return root;
}

describe("local Runtime delivery verification", () => {
  it("publishes a file artifact only after the file and declared SHA-256 are verified", async () => {
    const root = workspace();
    const target = join(root, "multi-agent-smoke-test.txt");
    const content = "Multi-Agent Smoke Test\n";
    writeFileSync(target, content, "utf8");
    const sha256 = createHash("sha256").update(content).digest("hex");
    const finalText = [
      "实施完成。",
      "[交付物]",
      `路径：${target}`,
      `SHA-256：${sha256}`,
      "来源机器：本机工作区",
      "变更摘要：创建冒烟测试文件。",
    ].join("\n");
    const structuredOutput = JSON.stringify({
      type: "agent_end",
      messages: [
        { role: "assistant", content: [{ type: "text", text: finalText }] },
      ],
    });
    const canonicalTarget = await realpath(target);

    await expect(
      verifyLocalDeliveryArtifacts(structuredOutput, root),
    ).resolves.toEqual([
      expect.objectContaining({
        kind: "file",
        label: "multi-agent-smoke-test.txt",
        path: canonicalTarget,
        sha256,
        sourceMachine: "本机工作区",
        changeSummary: "创建冒烟测试文件。",
      }),
    ]);
  });

  it("continues to accept the legacy delivery-contract marker", async () => {
    const root = workspace();
    const target = join(root, "legacy.txt");
    writeFileSync(target, "legacy", "utf8");
    const sha256 = createHash("sha256").update("legacy").digest("hex");

    await expect(
      verifyLocalDeliveryArtifacts(
        `[交付契约]\n路径：${target}\nSHA-256：${sha256}\n来源机器：本机工作区\n变更摘要：兼容旧任务。`,
        root,
      ),
    ).resolves.toHaveLength(1);
  });

  it("rejects a missing file, a mismatched hash, and a path outside the selected workspace", async () => {
    const root = workspace();
    const outsideRoot = workspace();
    const outside = join(outsideRoot, "outside.txt");
    writeFileSync(outside, "outside", "utf8");
    const fakeHash = "a".repeat(64);
    const contract = (path: string, sha256 = fakeHash): string =>
      `[交付契约]\n路径：${path}\nSHA-256：${sha256}\n来源机器：本机工作区\n变更摘要：测试。`;

    await expect(
      verifyLocalDeliveryArtifacts(contract(join(root, "missing.txt")), root),
    ).resolves.toEqual([]);
    const inside = join(root, "inside.txt");
    writeFileSync(inside, "inside", "utf8");
    await expect(
      verifyLocalDeliveryArtifacts(contract(inside), root),
    ).resolves.toEqual([]);
    const outsideSha = createHash("sha256").update("outside").digest("hex");
    await expect(
      verifyLocalDeliveryArtifacts(contract(outside, outsideSha), root),
    ).resolves.toEqual([]);
  });
});
