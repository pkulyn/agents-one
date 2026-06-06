export default {
  title: "Gateway",
  messagingGateway: "Messaging Gateway",
  platforms: "Platforms",
  status: "Status",
  running: "Running",
  stopped: "Stopped",
  working: "Working…",
  restart: "Restart",
  restartFailed:
    "Gateway restart failed. Check gateway-stderr.log for details.",
  startFailed: "Gateway could not be started.",
  stopFailed: "Gateway could not be stopped.",
  startExited:
    "Gateway was started, but it stopped again before it became ready.",
  checkLog: "Check the gateway log:",
  gatewayHint:
    "Connects Hermes to Telegram, Discord, Slack, and other platforms",
  apiServerKey: {
    title: "API Server Key",
    configured: "Key is configured",
    missing: "Key is missing — chat will fail without it.",
    generate: "Generate key",
    regenerating: "Generating…",
    generateHint:
      "This key is shared between the desktop and the local gateway. Generating a new one restarts the gateway automatically.",
  },
} as const;
