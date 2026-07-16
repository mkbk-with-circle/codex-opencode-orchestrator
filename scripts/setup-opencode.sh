#!/usr/bin/env bash
set -euo pipefail
# Install OpenCode CLI into ~/.opencode/bin from GitHub releases

BIN_DIR="${OPENCODE_BIN_DIR:-$HOME/.opencode/bin}"
mkdir -p "$BIN_DIR"
export PATH="$BIN_DIR:$PATH"

if command -v opencode >/dev/null 2>&1; then
  echo "opencode already installed: $(command -v opencode)"
  opencode --version || true
  exit 0
fi

# Prefer GitHub release (with optional CN mirror)
TAG="${OPENCODE_VERSION:-v1.18.3}"
ASSET_DEFAULT=""
ARCH="$(uname -m)"
OS="$(uname -s)"
if [[ "$OS" == "Darwin" ]]; then
  case "$ARCH" in
    arm64|aarch64) ASSET_DEFAULT="opencode-darwin-arm64.zip" ;;
    *) ASSET_DEFAULT="opencode-darwin-x64.zip" ;;
  esac
else
  case "$ARCH" in
    aarch64|arm64) ASSET_DEFAULT="opencode-linux-arm64.tar.gz" ;;
    *) ASSET_DEFAULT="opencode-linux-x64.tar.gz" ;;
  esac
fi
ASSET="${OPENCODE_ASSET:-$ASSET_DEFAULT}"
GH="https://github.com/anomalyco/opencode/releases/download/${TAG}/${ASSET}"
URL="${OPENCODE_DOWNLOAD_URL:-https://ghfast.top/${GH}}"

TMP="$(mktemp -d)"
echo "Downloading $URL ..."
curl -fL --retry 3 --retry-delay 2 -o "$TMP/oc.zip" "$URL"
unzip -o "$TMP/oc.zip" -d "$BIN_DIR"
# zip may contain nested folder or bare binary
if [[ -f "$BIN_DIR/opencode" ]]; then
  chmod +x "$BIN_DIR/opencode"
elif [[ -f "$BIN_DIR/bin/opencode" ]]; then
  ln -sf "$BIN_DIR/bin/opencode" "$BIN_DIR/opencode"
  chmod +x "$BIN_DIR/opencode"
else
  FOUND="$(find "$BIN_DIR" -type f -name opencode | head -1)"
  if [[ -n "$FOUND" ]]; then
    ln -sf "$FOUND" "$BIN_DIR/opencode"
    chmod +x "$FOUND" "$BIN_DIR/opencode"
  else
    echo "Could not locate opencode binary after unzip"; exit 1
  fi
fi

"$BIN_DIR/opencode" --version
echo "Installed to $BIN_DIR/opencode"
echo "Add to PATH: export PATH=\"$BIN_DIR:\$PATH\""
