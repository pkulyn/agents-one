import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "fs";
import { join } from "path";
import { HERMES_HOME, HERMES_REPO } from "./installer";

export const HERMES_AGENT_COMPAT_VERSION =
  "2026-06-11.dashboard-chat-model-library.v2";

export interface HermesAgentCompatResult {
  ok: boolean;
  target: "local" | "remote-http";
  compatible: boolean;
  applied: boolean;
  version: string;
  detail: string;
  path?: string;
  error?: string;
}

export interface DashboardSourcePatchResult {
  compatible: boolean;
  changed: boolean;
  source: string;
  detail: string;
}

export interface DashboardSourcePatchesResult {
  compatible: boolean;
  changed: boolean;
  source: string;
  detail: string;
}

const EMBEDDED_CHAT_FALSE_RE = /(\bembedded_chat\s*:\s*bool\s*=\s*)False\b/;
const EMBEDDED_CHAT_TRUE_RE = /\bembedded_chat\s*:\s*bool\s*=\s*True\b/;
const DASHBOARD_CHAT_ALWAYS_ON_RE =
  /\b_DASHBOARD_EMBEDDED_CHAT_ENABLED\s*=\s*True\b/;
const MODEL_LIBRARY_COMPAT_START =
  "# --- HERMES_ONE_MODEL_LIBRARY_COMPAT_V1 -------------------------------------";
const MODEL_LIBRARY_COMPAT_END =
  "# --- /HERMES_ONE_MODEL_LIBRARY_COMPAT_V1 ------------------------------------";
const DASHBOARD_SPA_MOUNT_ANCHOR = "mount_spa(app)";

const MODEL_LIBRARY_COMPAT_SOURCE = `

# --- HERMES_ONE_MODEL_LIBRARY_COMPAT_V1 -------------------------------------
# Compatibility endpoint installed by Agents One. Upstream Hermes Agent exposes
# /api/model/options and /api/model/set, but Agents One also needs a small
# configured-model shortcut library for remote model pickers. The library is
# deliberately stored in this agent's HERMES_HOME so remote shortcuts stay on
# the remote host and survive desktop restarts without changing upstream model
# assignment semantics.
def _hermes_one_model_library_path():
    return get_hermes_home() / "models.json"


def _hermes_one_short_model_label(model):
    text = str(model or "").strip()
    return (text.rsplit("/", 1)[-1] if text else "") or text


def _hermes_one_model_key(row):
    return (
        str(row.get("provider", "")).strip().lower(),
        str(row.get("model", "")).strip().lower(),
        str(row.get("baseUrl", row.get("base_url", ""))).strip().rstrip("/").lower(),
    )


def _hermes_one_normalize_model_row(row, index=0):
    if not isinstance(row, dict):
        return None
    provider = str(row.get("provider", "")).strip()
    model = str(row.get("model", "")).strip()
    if not provider or not model:
        return None
    base_url = str(row.get("baseUrl", row.get("base_url", "")) or "").strip()
    return {
        "id": str(row.get("id") or f"remote:library:{provider}:{index}:{model}"),
        "name": str(row.get("name") or _hermes_one_short_model_label(model) or provider),
        "provider": provider,
        "model": model,
        "baseUrl": base_url,
        "createdAt": row.get("createdAt") if isinstance(row.get("createdAt"), (int, float)) else 0,
    }


def _hermes_one_read_model_library():
    path = _hermes_one_model_library_path()
    try:
        raw = json.loads(path.read_text(encoding="utf-8")) if path.exists() else []
    except Exception:
        raw = []
    rows = []
    seen = set()
    for index, item in enumerate(raw if isinstance(raw, list) else []):
        row = _hermes_one_normalize_model_row(item, index)
        if not row:
            continue
        key = _hermes_one_model_key(row)
        if key in seen:
            continue
        seen.add(key)
        rows.append(row)
    return rows


def _hermes_one_write_model_library(rows):
    path = _hermes_one_model_library_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(rows, indent=2), encoding="utf-8")
    tmp.replace(path)


def _hermes_one_current_model_row():
    try:
        cfg = load_config()
    except Exception:
        return None
    model_cfg = cfg.get("model", {})
    if isinstance(model_cfg, dict):
        provider = str(model_cfg.get("provider", "") or "").strip()
        model = str(model_cfg.get("default", model_cfg.get("name", "")) or "").strip()
        base_url = str(model_cfg.get("base_url", "") or "").strip()
    else:
        provider = ""
        model = str(model_cfg or "").strip()
        base_url = ""
    if not provider or not model:
        return None
    return {
        "id": f"remote:active:{provider}:{model}",
        "name": _hermes_one_short_model_label(model) or provider,
        "provider": provider,
        "model": model,
        "baseUrl": base_url,
        "createdAt": 0,
    }


@app.get("/api/model/library")
def hermes_one_get_model_library():
    rows = _hermes_one_read_model_library()
    current = _hermes_one_current_model_row()
    if current:
        current_key = _hermes_one_model_key(current)
        rows = [current] + [row for row in rows if _hermes_one_model_key(row) != current_key]
    return {"models": rows}


@app.post("/api/model/library")
def hermes_one_add_model_library_row(body: Dict[str, Any]):
    provider = str(body.get("provider", "") or "").strip()
    model = str(body.get("model", "") or "").strip()
    if not provider or not model:
        raise HTTPException(status_code=400, detail="provider and model required")
    base_url = str(body.get("baseUrl", body.get("base_url", "")) or "").strip()
    name = str(body.get("name", "") or "").strip() or _hermes_one_short_model_label(model) or provider
    rows = _hermes_one_read_model_library()
    key = (provider.lower(), model.lower(), base_url.rstrip("/").lower())
    for row in rows:
        if _hermes_one_model_key(row) == key:
            return row
    row = {
        "id": f"remote:library:{secrets.token_hex(8)}",
        "name": name,
        "provider": provider,
        "model": model,
        "baseUrl": base_url,
        "createdAt": int(time.time() * 1000),
    }
    rows.append(row)
    _hermes_one_write_model_library(rows)
    return row


@app.patch("/api/model/library/{model_id:path}")
def hermes_one_update_model_library_row(model_id: str, body: Dict[str, Any]):
    rows = _hermes_one_read_model_library()
    for index, row in enumerate(rows):
        if row.get("id") != model_id:
            continue
        next_row = dict(row)
        for key in ("name", "provider", "model"):
            if key in body:
                next_row[key] = str(body.get(key, "") or "").strip()
        if "baseUrl" in body or "base_url" in body:
            next_row["baseUrl"] = str(body.get("baseUrl", body.get("base_url", "")) or "").strip()
        normalized = _hermes_one_normalize_model_row(next_row, index)
        if not normalized:
            raise HTTPException(status_code=400, detail="provider and model required")
        rows[index] = normalized
        _hermes_one_write_model_library(rows)
        return {"ok": True, "model": normalized}
    raise HTTPException(status_code=404, detail="model not found")


@app.delete("/api/model/library/{model_id:path}")
def hermes_one_delete_model_library_row(model_id: str):
    rows = _hermes_one_read_model_library()
    filtered = [row for row in rows if row.get("id") != model_id]
    if len(filtered) == len(rows):
        raise HTTPException(status_code=404, detail="model not found")
    _hermes_one_write_model_library(filtered)
    return {"ok": True}
# --- /HERMES_ONE_MODEL_LIBRARY_COMPAT_V1 ------------------------------------
`;

function compatMarkerPath(): string {
  return join(HERMES_HOME, "desktop-compat", "dashboard-embedded-chat.json");
}

function writeLocalMarker(result: HermesAgentCompatResult): void {
  try {
    const marker = compatMarkerPath();
    mkdirSync(join(HERMES_HOME, "desktop-compat"), { recursive: true });
    writeFileSync(
      marker,
      JSON.stringify(
        {
          version: result.version,
          target: result.target,
          compatible: result.compatible,
          applied: result.applied,
          path: result.path,
          checkedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
      "utf-8",
    );
  } catch {
    // The marker is diagnostic only. A failed marker write must not block chat.
  }
}

export function patchDashboardEmbeddedChatSource(
  source: string,
): DashboardSourcePatchResult {
  if (DASHBOARD_CHAT_ALWAYS_ON_RE.test(source)) {
    return {
      compatible: true,
      changed: false,
      source,
      detail: "Dashboard embedded chat is always enabled by this Hermes Agent.",
    };
  }

  if (EMBEDDED_CHAT_TRUE_RE.test(source)) {
    return {
      compatible: true,
      changed: false,
      source,
      detail: "Dashboard embedded chat is already enabled by default.",
    };
  }

  if (!EMBEDDED_CHAT_FALSE_RE.test(source)) {
    return {
      compatible: false,
      changed: false,
      source,
      detail:
        "Could not find the Hermes Agent embedded_chat default in web_server.py.",
    };
  }

  return {
    compatible: true,
    changed: true,
    source: source.replace(EMBEDDED_CHAT_FALSE_RE, "$1True"),
    detail: "Patched Hermes Agent dashboard embedded_chat default to True.",
  };
}

export function patchDashboardModelLibrarySource(
  source: string,
): DashboardSourcePatchResult {
  const withoutExisting = removeModelLibraryCompatBlock(source);
  if (!withoutExisting.source.includes('@app.post("/api/model/set")')) {
    return {
      compatible: false,
      changed: false,
      source,
      detail:
        "Could not find Hermes Agent model REST endpoints in web_server.py.",
    };
  }

  const patched = insertModelLibraryCompatBlock(withoutExisting.source);
  if (patched === source) {
    return {
      compatible: true,
      changed: false,
      source,
      detail: "Agents One model library endpoint is already installed.",
    };
  }

  return {
    compatible: true,
    changed: true,
    source: patched,
    detail: withoutExisting.removed
      ? "Moved Agents One model library endpoint before the dashboard catch-all route."
      : "Installed Agents One model library endpoint.",
  };
}

function removeModelLibraryCompatBlock(source: string): {
  source: string;
  removed: boolean;
} {
  const start = source.indexOf(MODEL_LIBRARY_COMPAT_START);
  if (start < 0) return { source, removed: false };
  const end = source.indexOf(MODEL_LIBRARY_COMPAT_END, start);
  if (end < 0) return { source, removed: false };
  const afterEnd = end + MODEL_LIBRARY_COMPAT_END.length;
  const before = source.slice(0, start).replace(/\n*$/, "\n");
  const after = source.slice(afterEnd).replace(/^\n*/, "");
  return { source: before + after, removed: true };
}

function insertModelLibraryCompatBlock(source: string): string {
  const block = MODEL_LIBRARY_COMPAT_SOURCE.trimEnd();
  const anchorIndex = source.indexOf(DASHBOARD_SPA_MOUNT_ANCHOR);
  if (anchorIndex >= 0) {
    const before = source.slice(0, anchorIndex).replace(/\n*$/, "\n");
    const after = source.slice(anchorIndex);
    return `${before}${block}\n\n${after}`;
  }
  return `${source.trimEnd()}\n${block}\n`;
}

export function patchDashboardCompatibilitySource(
  source: string,
): DashboardSourcePatchesResult {
  const details: string[] = [];
  let changed = false;

  const embedded = patchDashboardEmbeddedChatSource(source);
  details.push(embedded.detail);
  if (!embedded.compatible) {
    return { ...embedded, detail: details.join(" ") };
  }
  changed ||= embedded.changed;

  const modelLibrary = patchDashboardModelLibrarySource(embedded.source);
  details.push(modelLibrary.detail);
  if (!modelLibrary.compatible) {
    return {
      compatible: false,
      changed,
      source: modelLibrary.source,
      detail: details.join(" "),
    };
  }
  changed ||= modelLibrary.changed;

  return {
    compatible: true,
    changed,
    source: modelLibrary.source,
    detail: details.join(" "),
  };
}

export function writeCompatFileAtomically(path: string, source: string): void {
  const backupPath = `${path}.orig`;
  const tmpPath = `${path}.hermes-one-${process.pid}-${Date.now()}.tmp`;
  if (!existsSync(backupPath)) {
    copyFileSync(path, backupPath);
  }
  try {
    writeFileSync(tmpPath, source, "utf-8");
    renameSync(tmpPath, path);
  } catch (err) {
    try {
      rmSync(tmpPath, { force: true });
    } catch {
      // Best effort cleanup only; preserve the original write error.
    }
    throw err;
  }
}

export function ensureLocalDashboardCompatibility(): HermesAgentCompatResult {
  const path = join(HERMES_REPO, "hermes_cli", "web_server.py");
  try {
    const source = readFileSync(path, "utf-8");
    const patched = patchDashboardCompatibilitySource(source);
    if (!patched.compatible) {
      const result: HermesAgentCompatResult = {
        ok: false,
        target: "local",
        compatible: false,
        applied: false,
        version: HERMES_AGENT_COMPAT_VERSION,
        detail: patched.detail,
        path,
      };
      writeLocalMarker(result);
      return result;
    }

    if (patched.changed) {
      writeCompatFileAtomically(path, patched.source);
    }

    const result: HermesAgentCompatResult = {
      ok: true,
      target: "local",
      compatible: true,
      applied: patched.changed,
      version: HERMES_AGENT_COMPAT_VERSION,
      detail: patched.detail,
      path,
    };
    writeLocalMarker(result);
    return result;
  } catch (err) {
    const result: HermesAgentCompatResult = {
      ok: false,
      target: "local",
      compatible: false,
      applied: false,
      version: HERMES_AGENT_COMPAT_VERSION,
      detail: "Could not inspect local Hermes Agent dashboard source.",
      path,
      error: err instanceof Error ? err.message : String(err),
    };
    writeLocalMarker(result);
    return result;
  }
}

export function remoteHttpCompatibilityResult(): HermesAgentCompatResult {
  return {
    ok: false,
    target: "remote-http",
    compatible: false,
    applied: false,
    version: HERMES_AGENT_COMPAT_VERSION,
    detail:
      "Plain remote HTTP can be probed but not patched by Agents One. Update the remote Hermes Agent directly.",
  };
}
