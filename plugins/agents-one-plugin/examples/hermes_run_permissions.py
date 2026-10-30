"""Per-Run Hermes policy. Install at agent/agents_one_permissions.py."""
import json
import re
import uuid

_WORD = re.compile(r"(?:^|[_\s.-])(?:delete|remove|unlink|rmdir|trash)(?:$|[_\s.-])", re.I)
_COMMAND = [
    re.compile(r"(?:^|[\s;&|()\"'])(?:rm|rmdir|rd|del|erase|Remove-Item|Clear-RecycleBin)(?:$|[\s;&|()\"'])", re.I),
    re.compile(r"\.(?:unlink(?:Sync)?|rmdir(?:Sync)?|rm(?:Sync)?|rmtree|deleteFile|deleteDirectory)\s*\(", re.I),
    re.compile(r"\b(?:os|fs|shutil|File|Directory|Files)\s*\.\s*(?:remove|delete)\s*\(", re.I),
    re.compile(r"\*\*\* Delete File:"),
    re.compile(r"(?:^|[\s+_-])(?:delete|trash)(?:\s|$)", re.I),
]

def is_tool_deletion(name, args):
    if re.search(r"^(?:delete|remove|unlink|trash)(?:[A-Z]|$)", name) or _WORD.search(name) or name.startswith(("删除", "移入回收站")):
        return True
    def visit(value, depth=0):
        if depth > 12:
            return False
        if isinstance(value, list):
            return any(visit(item, depth + 1) for item in value)
        if not isinstance(value, dict):
            return False
        intent = next((value.get(k) for k in ("operation", "action", "kind", "type") if value.get(k)), "")
        if _WORD.search(str(intent)):
            return True
        for key in ("command", "cmd", "code", "script", "patch", "patchText", "diff"):
            command = value.get(key)
            if isinstance(command, list):
                command = " ".join(str(x) for x in command)
            if isinstance(command, str) and any(pattern.search(command) for pattern in _COMMAND):
                return True
        for key in ("input", "arguments", "tool_input", "rawInput", "changes", "fileChanges", "operations", "actions", "kind", "payload"):
            child = value.get(key)
            if visit(child, depth + 1):
                return True
            if key in ("changes", "fileChanges") and isinstance(child, dict) and any(visit(x, depth + 1) for x in child.values()):
                return True
        return False
    return visit(args)

# Run-local policy must precede native Smart and permanent allowlists.
def tool_permission_block(agent, name, args):
    mode = getattr(agent, "_agents_one_permission_mode", None)
    if mode is None:
        return None
    if mode in ("full_access", "implementation"):
        return None
    if mode not in ("analysis", "safe_write"):
        return "[Agents One] Unsupported Run permission mode; tool was not executed."
    if not isinstance(name, str) or not isinstance(args, dict):
        return "[Agents One] Tool intent could not be verified; tool was not executed."
    deletion = is_tool_deletion(name, args)
    if mode == "analysis":
        kind = args.get("operation") or args.get("kind") or ""
        reader = re.search(r"(?:^|[_\s.-])(?:read|search|query|list|get|fetch|grep|find|glob|think|snapshot)(?:$|[_\s.-])", name, re.I)
        return None if not deletion and (reader or kind in ("read", "search", "query", "list", "fetch", "think")) else "[Agents One] Read-only mode blocked this tool."
    if not deletion:
        return None
    denied = "[Agents One] 本次删除未获授权，工具未执行。Deletion was not approved for this operation."
    try:
        from tools import approval
        from agent.redact import redact_sensitive_text
        session = approval.get_current_session_key(default="")
        if not session:
            return denied
        with approval._lock:
            notify = approval._gateway_notify_cbs.get(session)
        if not callable(notify):
            return denied
        display = redact_sensitive_text("delete tool " + name + " " + json.dumps(args, ensure_ascii=False))
        if len(display.encode("utf-8")) > 240 * 1024:
            return denied
        key = "agents_one_delete_" + uuid.uuid4().hex
        decision = approval._await_gateway_decision(session, notify, {
            "command": display,
            "description": "Agents One: confirm this deletion only",
            "pattern_key": key,
            "pattern_keys": [key],
            "allow_session": False,
            "allow_permanent": False,
        }, surface="gateway")
        # Bypass global Smart/YOLO/allowlists, and never grant session authority.
        if isinstance(decision, dict) and decision.get("resolved") is True and decision.get("choice") == "once":
            return None
    except Exception:
        pass
    return denied
