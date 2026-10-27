export interface PiNativeToolsApi {
  getSettings: () => { defaultTools?: unknown };
  getActiveTools: () => string[];
  getAllTools: () => Array<{ name: string; sourceInfo?: { path?: string } }>;
  setActiveTools: (names: string[]) => void;
}

/** Self-contained: serialized into the reviewed native Pi1.4 startup extension. */
// @lat: [[runtime-chat#Pi native mode tool selection]]
export function restorePiNativeTools(pi: PiNativeToolsApi): void {
  const defaults = ["read", "bash", "edit", "write"];
  const raw = pi.getSettings().defaultTools;
  const entries =
    raw === undefined
      ? defaults
      : Array.isArray(raw)
        ? raw.filter((item): item is string => typeof item === "string")
        : [];
  const modifier = (item: string): boolean =>
    item.startsWith("+") || item.startsWith("-");
  const plain = entries.filter((item) => !modifier(item));
  const selected = [
    ...(plain.length || entries.length === 0 ? plain : defaults),
  ];
  for (const item of entries) {
    if (!modifier(item)) continue;
    const name = item.slice(1),
      index = selected.indexOf(name);
    if (item.startsWith("+") && index < 0 && name) selected.push(name);
    else if (item.startsWith("-") && index >= 0) selected.splice(index, 1);
  }
  const tools = new Map(pi.getAllTools().map((tool) => [tool.name, tool]));
  const extensions = pi
    .getActiveTools()
    .filter((name) => tools.get(name)?.sourceInfo?.path !== "builtin:" + name);
  pi.setActiveTools([...new Set([...selected, ...extensions])]);
}

export function piNativeToolsExtensionSource(): string {
  return (
    "export default function(pi){pi.on('session_start',()=> (" +
    restorePiNativeTools.toString() +
    ")(pi));}"
  );
}
