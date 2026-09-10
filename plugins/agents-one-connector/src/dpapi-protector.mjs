import { spawnSync } from "node:child_process";

const SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$raw = [Console]::In.ReadToEnd().Trim()
$bytes = [Convert]::FromBase64String($raw)
if ($env:AGENTS_ONE_DPAPI_OPERATION -eq 'protect') {
  $result = [Security.Cryptography.ProtectedData]::Protect($bytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
} elseif ($env:AGENTS_ONE_DPAPI_OPERATION -eq 'unprotect') {
  $result = [Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
} else {
  throw 'Unsupported DPAPI operation.'
}
[Console]::Out.Write([Convert]::ToBase64String($result))
`;

const ENCODED_SCRIPT = Buffer.from(SCRIPT, "utf16le").toString("base64");

function invoke(operation, input) {
  const result = spawnSync(
    "powershell.exe",
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      ENCODED_SCRIPT,
    ],
    {
      env: { ...process.env, AGENTS_ONE_DPAPI_OPERATION: operation },
      input: Buffer.from(input).toString("base64"),
      encoding: "utf8",
      windowsHide: true,
      timeout: 15_000,
      maxBuffer: 2 * 1024 * 1024,
    },
  );
  if (result.status !== 0 || !result.stdout?.trim()) {
    throw new Error("Windows credential protection failed.");
  }
  try {
    return Buffer.from(result.stdout.trim(), "base64");
  } catch {
    throw new Error("Windows credential protection returned invalid data.");
  }
}

export function protectForCurrentWindowsUser(value) {
  return invoke("protect", Buffer.from(value, "utf8")).toString("base64");
}

export function unprotectForCurrentWindowsUser(ciphertext) {
  return invoke("unprotect", Buffer.from(ciphertext, "base64")).toString(
    "utf8",
  );
}
