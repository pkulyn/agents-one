import markdown from "../assets/file-types/markdown.svg";

type FileType =
  | "docx"
  | "xlsx"
  | "pptx"
  | "pdf"
  | "markdown"
  | "txt"
  | "csv"
  | "photo"
  | "zip"
  | "code"
  | "genericfile";

const extensions: Partial<Record<string, FileType>> = Object.create(null);
for (const [type, names] of Object.entries({
  docx: "doc docx docm dot dotx dotm",
  xlsx: "xls xlsx xlsm xlsb xlt xltx xltm",
  pptx: "ppt pptx pptm pps ppsx ppsm pot potx potm",
  pdf: "pdf",
  markdown: "md markdown mdown mkd mdx",
  txt: "txt text log rtf",
  csv: "csv tsv",
  photo: "jpg jpeg png gif webp bmp svg avif ico heic heif tif tiff",
  zip: "zip rar 7z tar gz tgz bz2 xz zst",
  code: "json jsonc xml html htm css scss js jsx mjs cjs ts tsx py rb go rs java c h cpp hpp cs sh ps1 yaml yml toml sql vue svelte",
})) {
  for (const ext of names.split(" ")) extensions[ext] = type as FileType;
}

/** Display metadata only; file access and attachment transport stay with their owners. */
export function fileTypeFor(name: string, mime = ""): FileType {
  const filename = name.split(/[\\/]/).pop() || name;
  const ext = filename.includes(".")
    ? filename.split(".").pop()!.toLowerCase()
    : "";
  if (extensions[ext]) return extensions[ext];
  const mediaType = mime.split(";")[0].trim().toLowerCase();
  if (/^image\//.test(mediaType)) return "photo";
  if (
    /^application\/(msword|vnd\.ms-word\.|vnd\.openxmlformats-officedocument\.wordprocessingml\.)/.test(
      mediaType,
    )
  )
    return "docx";
  if (
    /^application\/(vnd\.ms-excel|vnd\.openxmlformats-officedocument\.spreadsheetml\.)/.test(
      mediaType,
    )
  )
    return "xlsx";
  if (
    /^application\/(vnd\.ms-powerpoint|vnd\.openxmlformats-officedocument\.presentationml\.)/.test(
      mediaType,
    )
  )
    return "pptx";
  if (mediaType === "application/pdf") return "pdf";
  if (["text/markdown", "text/x-markdown"].includes(mediaType))
    return "markdown";
  if (
    ["text/csv", "text/tab-separated-values", "application/csv"].includes(
      mediaType,
    )
  )
    return "csv";
  if (["text/plain", "application/rtf", "text/rtf"].includes(mediaType))
    return "txt";
  if (
    /^application\/(zip|x-zip-compressed|x-7z-compressed|x-rar-compressed|vnd\.rar|gzip|x-tar)$/.test(
      mediaType,
    )
  )
    return "zip";
  if (
    [
      "application/json",
      "application/xml",
      "text/xml",
      "text/html",
      "text/javascript",
      "application/javascript",
    ].includes(mediaType)
  )
    return "code";
  return "genericfile";
}

const assets = import.meta.glob<string>("../assets/file-types/*-*.svg", {
  eager: true,
  query: "?url",
  import: "default",
});

export function FileTypeIcon({
  name,
  mime,
  size = 16,
}: {
  name: string;
  mime?: string;
  size?: 16 | 24 | 48;
}): React.JSX.Element {
  const type = fileTypeFor(name, mime);
  return (
    <img
      className="file-type-icon"
      data-file-type={type}
      src={
        type === "markdown"
          ? markdown
          : assets[`../assets/file-types/${size}-${type}.svg`]
      }
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      draggable={false}
    />
  );
}
