import { expect, it } from "vitest";
import { claudeChildEnvironment } from "../src/main/claude-environment";
it.each(["analysis", "safe_write"] as const)(
  "drops execution channels without changing %s credential and path data",
  (mode) => {
    const source = {
      node_options: "owned-loader",
      BUN_RUNTIME_TRANSPILER_CACHE_PATH: "owned-bun",
      LD_PRELOAD: "owned-library",
      DYLD_INSERT_LIBRARIES: "owned-library",
      PYTHONPATH: "owned-module",
      OPENSSL_MODULES: "owned-module",
      CLAUDE_CODE_POLICY_HELPER_PS: "owned-shell",
      USE_BUILTIN_RIPGREP: "0",
      Path: "owned-path",
      HOME: "owned-home",
      CLAUDE_CONFIG_DIR: "owned-config",
      NODE_EXTRA_CA_CERTS: "owned-cert",
      ANTHROPIC_API_KEY: "owned-inherited",
      HTTPS_PROXY: "owned-proxy",
      CUSTOM_PROVIDER_KEY: "owned-native-data",
    };
    const copy = { ...source };
    const env = claudeChildEnvironment(source, mode, {
      ANTHROPIC_API_KEY: "owned-user",
      NODE_OPTIONS: "owned-invalid-projection",
    });
    for (const key of [
      "node_options",
      "NODE_OPTIONS",
      "BUN_RUNTIME_TRANSPILER_CACHE_PATH",
      "LD_PRELOAD",
      "DYLD_INSERT_LIBRARIES",
      "PYTHONPATH",
      "OPENSSL_MODULES",
      "CLAUDE_CODE_POLICY_HELPER_PS",
    ])
      expect(env[key]).toBeUndefined();
    expect(env.USE_BUILTIN_RIPGREP).toBe("1");
    expect(env.ANTHROPIC_API_KEY).toBe("owned-user");
    for (const key of [
      "Path",
      "HOME",
      "CLAUDE_CONFIG_DIR",
      "NODE_EXTRA_CA_CERTS",
      "HTTPS_PROXY",
      "CUSTOM_PROVIDER_KEY",
    ])
      expect(env[key]).toBe(source[key as keyof typeof source]);
    expect(source).toEqual(copy);
  },
);
it.each(["full_access", "implementation"] as const)(
  "preserves explicit %s native environment",
  (mode) => {
    const source = {
      NODE_OPTIONS: "owned-loader",
      BUN_OPTIONS: "owned-options",
      USE_BUILTIN_RIPGREP: "0",
      ANTHROPIC_API_KEY: "owned-native",
    };
    const env = claudeChildEnvironment(source, mode, {
      ANTHROPIC_API_KEY: "owned-projection",
    });
    expect(env).toEqual(source);
    expect(env).not.toBe(source);
  },
);
