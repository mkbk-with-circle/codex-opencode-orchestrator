#!/usr/bin/env bash
set -euo pipefail
umask 077
# Install OpenCode CLI into ~/.opencode/bin from GitHub releases

BIN_DIR="${OPENCODE_BIN_DIR:-$HOME/.opencode/bin}"
mkdir -p "$BIN_DIR"
export PATH="$BIN_DIR:$PATH"

if command -v opencode >/dev/null 2>&1; then
  echo "opencode already installed: $(command -v opencode)"
  opencode --version || true
  exit 0
fi

# Prefer the official GitHub release. A mirror must be explicitly supplied.
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
URL="${OPENCODE_DOWNLOAD_URL:-$GH}"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
echo "Downloading $URL ..."
ARCHIVE="$TMP/$ASSET"
curl -fL --retry 3 --retry-delay 2 -o "$ARCHIVE" "$URL"
if [[ -n "${OPENCODE_SHA256:-}" ]]; then
  if command -v shasum >/dev/null 2>&1; then
    actual_sha="$(shasum -a 256 "$ARCHIVE" | awk '{print $1}')"
  elif command -v sha256sum >/dev/null 2>&1; then
    actual_sha="$(sha256sum "$ARCHIVE" | awk '{print $1}')"
  else
    echo "缺少 shasum/sha256sum，无法校验 OpenCode archive" >&2
    exit 1
  fi
  if [[ "$actual_sha" != "$OPENCODE_SHA256" ]]; then
    echo "OpenCode archive checksum mismatch" >&2
    exit 1
  fi
else
  echo "WARN: 未设置 OPENCODE_SHA256；建议在自动化安装中固定校验值" >&2
fi
EXTRACT_DIR="$TMP/extracted"
mkdir -p "$EXTRACT_DIR"
case "$ASSET" in
  *.zip)
    if unzip -Z1 "$ARCHIVE" | grep -Eq '(^/|(^|/)\.\.(/|$))'; then
      echo "Unsafe path in OpenCode zip archive" >&2
      exit 1
    fi
    unzip -q "$ARCHIVE" -d "$EXTRACT_DIR"
    ;;
  *.tar.gz|*.tgz)
    if tar -tzf "$ARCHIVE" | grep -Eq '(^/|(^|/)\.\.(/|$))'; then
      echo "Unsafe path in OpenCode tar archive" >&2
      exit 1
    fi
    tar -xzf "$ARCHIVE" -C "$EXTRACT_DIR"
    ;;
  *) echo "Unsupported OpenCode archive: $ASSET" >&2; exit 1 ;;
esac
FOUND="$(find "$EXTRACT_DIR" -type f -name opencode | head -1)"
if [[ -z "$FOUND" ]]; then
  echo "Could not locate opencode binary after extraction" >&2
  exit 1
fi
install -m 0755 "$FOUND" "$BIN_DIR/opencode"

"$BIN_DIR/opencode" --version
echo "Installed to $BIN_DIR/opencode"
echo "Add to PATH: export PATH=\"$BIN_DIR:\$PATH\""
