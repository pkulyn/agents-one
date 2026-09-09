#!/usr/bin/env sh
set -eu
INSTALL_DIR="${AGENTS_ONE_CONNECTOR_HOME:-$HOME/.local/share/agents-one-connector}"
ADAPTER_PATH=""
STARTUP=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --adapter) ADAPTER_PATH="$2"; shift 2 ;;
    --startup) STARTUP=1; shift ;;
    --install-dir) INSTALL_DIR="$2"; shift 2 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done
mkdir -p "$INSTALL_DIR"
npm install --prefix "$INSTALL_DIR" --omit=dev "$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
if [ -n "$ADAPTER_PATH" ]; then
  CLI="$INSTALL_DIR/node_modules/@agents-one/connector-cli/bin/agents-one-connector.mjs"
  cat > "$INSTALL_DIR/run-connector.sh" <<EOF
#!/usr/bin/env sh
exec node "$CLI" run --adapter "$ADAPTER_PATH"
EOF
  chmod 700 "$INSTALL_DIR/run-connector.sh"
  if [ "$STARTUP" -eq 1 ] && command -v systemctl >/dev/null 2>&1; then
    mkdir -p "$HOME/.config/systemd/user"
    cat > "$HOME/.config/systemd/user/agents-one-connector.service" <<EOF
[Unit]
Description=Agents One Connector
After=network-online.target

[Service]
ExecStart=$INSTALL_DIR/run-connector.sh
Restart=always
RestartSec=3

[Install]
WantedBy=default.target
EOF
    systemctl --user daemon-reload
    systemctl --user enable --now agents-one-connector.service
  fi
fi
echo "安装完成：$INSTALL_DIR"
