import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  inspectText,
  inspectMetadata,
  inspectFiles,
} from "./check-public-privacy.mjs";

// @lat: [[repository-presentation#Repository presentation and licensing#Public privacy gate]]
test("rejects identifying paths and credentials while preserving demo fixtures", () => {
  const name = ["private", "person"].join("-");
  for (const path of [
    "C:/Users/" + name + "/Desktop/note.md",
    "C:\\Users\\" + name + "\\note.md",
    "/Users/" + name + "/note",
    "/home/" + name + "/note",
  ])
    assert.ok(inspectText(path).includes("personal-home-directory"));
  for (const path of [
    "D:/Users/demo/Desktop/示例 周报(V1.0).md",
    "/home/me/test",
    "/home/<user>/test",
  ])
    assert.deepEqual(inspectText(path), []);
  assert.ok(
    inspectText("gh" + "p_" + "a".repeat(36)).includes("github-credential"),
  );
  assert.ok(
    inspectText("-----BEGIN " + "PRIVATE KEY-----").includes("private-key"),
  );
  assert.ok(
    inspectText("https://" + "person:password@service.invalid").includes(
      "url-password",
    ),
  );
  assert.ok(
    inspectText("https://" + [45, 67, 89, 12].join(".") + "/api").includes(
      "public-ip-endpoint",
    ),
  );
  for (const ip of [
    "127.0.0.1",
    "192.168.0.1",
    "192.0.2.5",
    "198.51.100.5",
    "203.0.113.5",
  ])
    assert.deepEqual(inspectText("http://" + ip + "/api"), []);
});

test("fails changed or new media and embedded identifying metadata", () => {
  const bytes = Buffer.from("demo media"),
    sha256 = createHash("sha256").update(bytes).digest("hex");
  assert.deepEqual(
    inspectFiles(["demo.png"], { "demo.png": { sha256 } }, () => bytes),
    [],
  );
  assert.equal(
    inspectFiles(["demo.png"], {}, () => bytes)[0].rule,
    "media-review-required",
  );
  assert.equal(
    inspectFiles(["demo.png"], { "demo.png": { sha256 } }, () =>
      Buffer.from("changed"),
    )[0].rule,
    "media-review-required",
  );
  assert.ok(
    inspectMetadata(
      Buffer.from("<dc:" + "creator>Personal</dc:creator>"),
    ).includes("identifying-media-metadata"),
  );
  const header = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const chunk = Buffer.alloc(12);
  chunk.write("tEXt", 4);
  assert.ok(
    inspectMetadata(Buffer.concat([header, chunk])).includes(
      "unreviewed-png-metadata",
    ),
  );
});

test("fixture approvals apply only to the exact reviewed line", () => {
  const line = "https://" + "test:password@example.test",
    path = "example.test.ts";
  const lineSha256 = createHash("sha256").update(line).digest("hex");
  const fixtures = [
    {
      path,
      rule: "url-password",
      lineSha256,
      reason: "Synthetic URL rejection fixture",
    },
  ];
  assert.deepEqual(
    inspectFiles([path], {}, () => Buffer.from(line), fixtures),
    [],
  );
  assert.equal(
    inspectFiles(
      [path],
      {},
      () => Buffer.from(line + "?new=value"),
      fixtures,
    )[0].rule,
    "url-password",
  );
  assert.equal(
    inspectFiles(["other.test.ts"], {}, () => Buffer.from(line), fixtures)[0]
      .rule,
    "url-password",
  );
});
