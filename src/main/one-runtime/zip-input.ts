import { crc32, inflateRawSync } from "node:zlib";
import { isTextFile } from "../../shared/attachments";

type ZipEntry = { path: string; status: string; text?: string };

/** Read bounded ZIP text in memory. Never extract paths, execute code or install skills. */
export function readOneZip(
  bytes: Buffer,
  signal: AbortSignal,
): { entries: ZipEntry[] } {
  signal.throwIfAborted();
  if (bytes.length < 22 || bytes.length > 20 * 1024 * 1024)
    throw new Error("ZIP 文件损坏或超过大小限制。");
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (
      bytes.readUInt32LE(i) === 0x06054b50 &&
      i + 22 + bytes.readUInt16LE(i + 20) === bytes.length
    ) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error("ZIP 文件损坏或不是标准 ZIP。");
  const count = bytes.readUInt16LE(end + 10);
  const centralSize = bytes.readUInt32LE(end + 12),
    centralStart = bytes.readUInt32LE(end + 16);
  if (
    bytes.readUInt16LE(end + 4) ||
    bytes.readUInt16LE(end + 6) ||
    bytes.readUInt16LE(end + 8) !== count ||
    count > 128 ||
    centralStart + centralSize !== end
  )
    throw new Error("ZIP 仅支持单卷标准格式，最多 128 个条目，不支持 ZIP64。");
  const entries: ZipEntry[] = [],
    seen = new Set<string>();
  let offset = centralStart,
    expanded = 0;
  for (let i = 0; i < count; i++) {
    signal.throwIfAborted();
    if (offset + 46 > end || bytes.readUInt32LE(offset) !== 0x02014b50)
      throw new Error("ZIP 目录损坏。");
    const flags = bytes.readUInt16LE(offset + 8),
      method = bytes.readUInt16LE(offset + 10);
    const checksum = bytes.readUInt32LE(offset + 16),
      packed = bytes.readUInt32LE(offset + 20),
      unpacked = bytes.readUInt32LE(offset + 24);
    const nameSize = bytes.readUInt16LE(offset + 28),
      extraSize = bytes.readUInt16LE(offset + 30),
      commentSize = bytes.readUInt16LE(offset + 32);
    const attributes = bytes.readUInt32LE(offset + 38),
      local = bytes.readUInt32LE(offset + 42);
    if (
      offset + 46 + nameSize + extraSize + commentSize > end ||
      nameSize > 1024
    )
      throw new Error("ZIP 条目名称或目录无效。");
    const rawName = bytes.subarray(offset + 46, offset + 46 + nameSize);
    const name = new TextDecoder("utf-8", { fatal: true }).decode(rawName);
    offset += 46 + nameSize + extraSize + commentSize;
    const entry: ZipEntry = { path: name.slice(0, 240), status: "未读取" };
    entries.push(entry);
    const parts = name.split("/");
    if (
      name.length > 240 ||
      name.includes("\\") ||
      [...name].some(
        (character) => character.charCodeAt(0) < 32 || character === ":",
      ) ||
      name.startsWith("/") ||
      parts.some((p) => p === ".." || p === ".") ||
      ((attributes >>> 16) & 0xf000) === 0xa000
    ) {
      entry.status = "跳过不安全路径或符号链接";
      continue;
    }
    if (seen.has(name.toLowerCase())) {
      entry.status = "跳过重复路径";
      continue;
    }
    seen.add(name.toLowerCase());
    if (name.endsWith("/")) {
      entry.status = "目录";
      continue;
    }
    if (flags & 1) {
      entry.status = "不支持加密条目";
      continue;
    }
    if (
      !isTextFile("", name) ||
      /^(?:\.env(?:\..*)?|.*\.(?:pem|key|p12|pfx)|.*(?:credential|secret|token|password).*)$/i.test(
        parts.at(-1)!,
      )
    ) {
      entry.status = "未读取二进制或凭据文件";
      continue;
    }
    if (unpacked > 64 * 1024 || expanded + unpacked > 128 * 1024) {
      entry.status = "展开文本超过限制";
      continue;
    }
    try {
      if (
        local + 30 > centralStart ||
        bytes.readUInt32LE(local) !== 0x04034b50 ||
        bytes.readUInt16LE(local + 6) !== flags ||
        bytes.readUInt16LE(local + 8) !== method
      )
        throw new Error();
      const localNameSize = bytes.readUInt16LE(local + 26),
        localExtraSize = bytes.readUInt16LE(local + 28);
      const start = local + 30 + localNameSize + localExtraSize;
      if (
        start + packed > centralStart ||
        !rawName.equals(bytes.subarray(local + 30, local + 30 + localNameSize))
      )
        throw new Error();
      const data = bytes.subarray(start, start + packed);
      const content =
        method === 0
          ? data
          : method === 8
            ? inflateRawSync(data, { maxOutputLength: 64 * 1024 + 1 })
            : undefined;
      if (
        !content ||
        content.length !== unpacked ||
        crc32(content) !== checksum ||
        content.includes(0)
      )
        throw new Error();
      entry.text = new TextDecoder("utf-8", { fatal: true }).decode(content);
      expanded += content.length;
      entry.status = "已读取文本，未执行或安装";
    } catch {
      entry.status = "条目损坏、非 UTF-8 文本或不支持的压缩方式";
    }
  }
  if (offset !== end) throw new Error("ZIP 目录长度不一致。");
  return { entries };
}
