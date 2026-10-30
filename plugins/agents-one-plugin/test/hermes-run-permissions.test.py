import contextvars
import importlib.util
import json
import pathlib
import sys
import tempfile
import threading
import types
import unittest

CASES = json.loads(sys.stdin.read() or "[]")
SOURCE = pathlib.Path(__file__).resolve().parents[1] / "examples" / "hermes_run_permissions.py"
spec = importlib.util.spec_from_file_location("hermes_run_permissions", SOURCE)
policy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(policy)

class PolicyTests(unittest.TestCase):
    def setUp(self):
        self.session = contextvars.ContextVar("test-session", default="")
        self.requests = []
        self.choices = {}
        self.approval = types.ModuleType("tools.approval")
        self.approval._lock = threading.RLock()
        self.approval._gateway_notify_cbs = {}
        self.approval.get_current_session_key = lambda default="": self.session.get() or default
        self.approval._YOLO_MODE_FROZEN = True
        self.approval._get_approval_mode = lambda: "off"
        def decision(session, notify, data, surface):
            self.assertEqual(surface, "gateway")
            notify(data)
            return {"resolved": True, "choice": self.choices.get(session, "deny")}
        self.approval._await_gateway_decision = decision
        tools = types.ModuleType("tools"); tools.approval = self.approval
        redact = types.ModuleType("agent.redact")
        redact.redact_sensitive_text = lambda text: text.replace("secret-value", "[REDACTED]")
        self.old = {key: sys.modules.get(key) for key in ("tools", "tools.approval", "agent", "agent.redact")}
        sys.modules.update({"tools": tools, "tools.approval": self.approval, "agent": types.ModuleType("agent"), "agent.redact": redact})
        self.session.set("native")
        self.approval._gateway_notify_cbs["native"] = lambda data: self.requests.append(data)
        self.agent = types.SimpleNamespace(_agents_one_permission_mode="safe_write")
    def tearDown(self):
        for key, value in self.old.items():
            if value is None: sys.modules.pop(key, None)
            else: sys.modules[key] = value
    def test_javascript_deletion_intents_match(self):
        for case in CASES:
            with self.subTest(case=case):
                self.assertEqual(policy.is_tool_deletion(case["name"], case["input"]), case["deletion"])
    def test_denied_delete_preserves_file_and_allows_following_edit(self):
        with tempfile.TemporaryDirectory() as directory:
            file = pathlib.Path(directory) / "document.txt"; file.write_text("original")
            block = policy.tool_permission_block(self.agent, "terminal", {"command": "Remove-Item " + str(file)})
            if block is None: file.unlink()
            self.assertTrue(file.exists())
            self.assertIsNone(policy.tool_permission_block(self.agent, "write_file", {"path": str(file), "content": "edited"}))
            file.write_text("edited"); self.assertEqual(file.read_text(), "edited")
            self.assertEqual(len(self.requests), 1)
    def test_once_only_and_secret_redaction(self):
        for choice in ("session", "always", "deny", None):
            self.choices["native"] = choice
            self.assertIsNotNone(policy.tool_permission_block(self.agent, "delete_document", {"path": "document.md"}))
        self.choices["native"] = "once"
        self.assertIsNone(policy.tool_permission_block(self.agent, "delete_document", {"token": "secret-value"}))
        self.assertNotIn("secret-value", self.requests[-1]["command"])
        self.assertFalse(self.requests[-1]["allow_permanent"])
        self.assertFalse(self.requests[-1]["allow_session"])
        self.assertEqual(len({r["pattern_key"] for r in self.requests}), len(self.requests))
    def test_missing_callback_and_unknown_decisions_fail_closed(self):
        self.approval._gateway_notify_cbs.clear()
        self.assertIsNotNone(policy.tool_permission_block(self.agent, "delete_document", {}))
        self.approval._gateway_notify_cbs["native"] = lambda data: None
        self.approval._await_gateway_decision = lambda *a, **kw: {"resolved": False, "choice": "once"}
        self.assertIsNotNone(policy.tool_permission_block(self.agent, "delete_document", {}))
    def test_full_access_and_unmarked_clients_do_not_wait(self):
        for agent in (types.SimpleNamespace(_agents_one_permission_mode="full_access"), types.SimpleNamespace()):
            self.assertIsNone(policy.tool_permission_block(agent, "delete_document", {}))
        self.assertEqual(self.requests, [])
    def test_document_generation_and_xml_editing_remain_allowed(self):
        for name, args in [("execute_code", {"code": "paragraph._element.getparent().remove(paragraph._element)"}), ("terminal", {"command": "python generate_docx.py"}), ("write_file", {"content": "delete this sentence"})]:
            self.assertIsNone(policy.tool_permission_block(self.agent, name, args))
        self.assertEqual(self.requests, [])
    def test_readonly_blocks_unknown_execution_and_deletion(self):
        self.agent._agents_one_permission_mode = "analysis"
        self.assertIsNone(policy.tool_permission_block(self.agent, "read_file", {"path": "doc.md"}))
        for name in ("terminal", "write_file", "delete_document"):
            self.assertIsNotNone(policy.tool_permission_block(self.agent, name, {}))
    def test_run_context_is_not_shared(self):
        def worker(mode, session):
            self.session.set(session)
            self.approval._gateway_notify_cbs[session] = lambda data: self.requests.append((session, data))
            self.choices[session] = "deny"
            return policy.tool_permission_block(types.SimpleNamespace(_agents_one_permission_mode=mode), "delete_document", {})
        from concurrent.futures import ThreadPoolExecutor
        with ThreadPoolExecutor(max_workers=2) as pool:
            safe = pool.submit(worker, "safe_write", "safe"); full = pool.submit(worker, "full_access", "full")
            self.assertIsNotNone(safe.result()); self.assertIsNone(full.result())
        self.assertEqual([r[0] for r in self.requests], ["safe"])

if __name__ == "__main__": unittest.main()
