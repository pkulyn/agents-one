import type { AgentRuntimeTaskInput } from "../shared/agent-runtimes";
const executionKeys = new Set([
  "NODE_OPTIONS",
  "NODE_PATH",
  "NODE_REPL_EXTERNAL_MODULE",
  "NODE_ICU_DATA",
  "NODE_V8_COVERAGE",
  "NODE_COMPILE_CACHE",
  "NODE_COMPILE_CACHE_PORTABLE",
  "NODE_REDIRECT_WARNINGS",
  "OPENSSL_CONF",
  "OPENSSL_CONF_INCLUDE",
  "OPENSSL_ENGINES",
  "OPENSSL_MODULES",
  "ELECTRON_RUN_AS_NODE",
  "RIPGREP_CONFIG_PATH",
  "BASH_ENV",
  "ENV",
  "SHELLOPTS",
  "BASHOPTS",
  "PROMPT_COMMAND",
  "ZDOTDIR",
  "ZSH_ENV",
  "PYTHONPATH",
  "PYTHONHOME",
  "PYTHONSTARTUP",
  "PYTHONINSPECT",
  "RUBYOPT",
  "RUBYLIB",
  "PERL5OPT",
  "PERL5LIB",
  "PERLLIB",
  "CLAUDE_CODE_GIT_BASH_PATH",
  "CLAUDE_CODE_POLICY_HELPER_PS",
  "CLAUDE_CODE_POLICY_HELPER_PSMODULEPATH",
]);
// @lat: [[runtime-chat#Claude restricted child environment]]
export function claudeChildEnvironment(
  source: NodeJS.ProcessEnv,
  mode: AgentRuntimeTaskInput["mode"],
  credentials: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
  if (mode !== "analysis" && mode !== "safe_write") return { ...source };
  const inherited = Object.fromEntries(
    Object.entries({ ...source, ...credentials }).filter(([key]) => {
      const name = key.toUpperCase();
      return (
        !executionKeys.has(name) &&
        !name.startsWith("BUN_") &&
        !name.startsWith("LD_") &&
        !name.startsWith("DYLD_") &&
        name !== "USE_BUILTIN_RIPGREP"
      );
    }),
  );
  return { ...inherited, USE_BUILTIN_RIPGREP: "1" };
}
