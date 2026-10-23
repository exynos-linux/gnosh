#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-or-later
#
# gnosh installer: run GNOME Shell extensions in Phosh.
#
#   curl -fsSL https://raw.githubusercontent.com/exynos-linux/gnosh/main/setup.sh | sh
#   git clone https://github.com/exynos-linux/gnosh && cd gnosh && ./setup.sh
#
# Installs for the current user only (~/.local, ~/.config, flatpak --user);
# nothing needs root, so it also works on immutable systems.
#
# Options:
#   --version X              install release X instead of the latest
#   --from-dir DIR           install from an unpacked release or git checkout
#   --no-extension-manager   do not install Extension Manager
#   --no-gext                do not install gnome-extensions-cli (gext)
#   --no-auto-update         do not enable the daily update timer
#   --update-only            only replace gnosh's files (used by self-update)
#   --uninstall              remove gnosh (extensions and settings are kept)
#   --force                  install even if Phosh is not found
#   -h, --help               show this help

set -eu

REPO="exynos-linux/gnosh"
PREFIX="${GNOSH_PREFIX:-$HOME/.local}"
DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME/.config}"
RUNTIME_DIR="$DATA_HOME/gnosh/runtime"
MODULE_DIR="$PREFIX/lib/gnosh"
BIN_DIR="$PREFIX/bin"
GEXT_HOME="$DATA_HOME/gnosh/gext"

VERSION=""
FROM_DIR=""
WITH_EM=1
WITH_GEXT=1
AUTO_UPDATE=1
UPDATE_ONLY=0
UNINSTALL=0
FORCE=0

if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
    B=$(printf '\033[1m'); G=$(printf '\033[32m'); Y=$(printf '\033[33m'); R=$(printf '\033[31m'); N=$(printf '\033[0m')
else
    B=""; G=""; Y=""; R=""; N=""
fi

say() { printf '%s\n' "$*"; }
step() { printf '%s==>%s %s\n' "$B" "$N" "$*"; }
ok() { printf '  %s✓%s %s\n' "$G" "$N" "$*"; }
warn() { printf '  %s!%s %s\n' "$Y" "$N" "$*" >&2; }
die() { printf '%serror:%s %s\n' "$R" "$N" "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

usage() {
    sed -n '3,25p' "$0" 2>/dev/null | sed 's/^# \{0,1\}//' || true
}

while [ $# -gt 0 ]; do
    case "$1" in
    --version) VERSION=${2:?--version needs a value}; shift 2 ;;
    --version=*) VERSION=${1#*=}; shift ;;
    --from-dir) FROM_DIR=${2:?--from-dir needs a value}; shift 2 ;;
    --no-extension-manager) WITH_EM=0; shift ;;
    --no-gext) WITH_GEXT=0; shift ;;
    --no-auto-update) AUTO_UPDATE=0; shift ;;
    --update-only) UPDATE_ONLY=1; shift ;;
    --uninstall) UNINSTALL=1; shift ;;
    --force) FORCE=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown option $1 (see --help)" ;;
    esac
done

[ "$(id -u)" -ne 0 ] || [ "${GNOSH_ALLOW_ROOT:-}" = 1 ] || \
    die "run setup.sh as the user who uses Phosh, not as root (gnosh installs into your home directory)"

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT INT TERM

fetch() { # URL FILE
    # The shell writes the file, not the downloader: a sandboxed curl (e.g. a
    # coldbrew wrapper with its own /tmp) cannot see our $TMP
    if have curl; then
        curl -fsSL --retry 3 "$1" > "$2"
    elif have wget; then
        wget -q -O - "$1" > "$2"
    else
        die "curl or wget is needed to download gnosh"
    fi
}

detect_arch() {
    case "$(uname -m)" in
    x86_64|amd64) echo x86_64 ;;
    aarch64|arm64) echo aarch64 ;;
    armv7*|armv8l|armhf) echo armv7l ;;
    riscv64) echo riscv64 ;;
    *) uname -m ;;
    esac
}

uninstall() {
    step "Removing gnosh"
    if [ -x "$BIN_DIR/gnosh" ]; then
        GNOSH_FORCE=1 "$BIN_DIR/gnosh" shell disable >/dev/null 2>&1 || true
        GNOSH_FORCE=1 "$BIN_DIR/gnosh" config auto-update false >/dev/null 2>&1 || true
    fi
    rm -rf "$DATA_HOME/gnosh" "$MODULE_DIR"
    rm -f "$BIN_DIR/gnosh" "$BIN_DIR/gnosh-prefs"
    if [ -f "$BIN_DIR/gext" ] && grep -q "gnosh wrapper" "$BIN_DIR/gext" 2>/dev/null; then
        rm -f "$BIN_DIR/gext"
    fi
    ok "gnosh removed. Extensions in ~/.local/share/gnome-shell/extensions and Extension Manager were kept."
    say "Log out and back in to start Phosh without gnosh."
}

if [ "$UNINSTALL" = 1 ]; then
    uninstall
    exit 0
fi

# --- checks --------------------------------------------------------------------

step "Checking the system"
ARCH=$(detect_arch)
ok "architecture: $ARCH"
PHOSH_BIN=""
for p in /usr/libexec/phosh /usr/bin/phosh /usr/lib/phosh/phosh; do
    [ -x "$p" ] && PHOSH_BIN=$p && break
done
if [ -n "$PHOSH_BIN" ]; then
    ok "Phosh: $("$PHOSH_BIN" --version 2>/dev/null | head -n1)"
elif [ "$FORCE" = 1 ]; then
    warn "Phosh not found; installing anyway (--force)"
else
    die "Phosh is not installed. gnosh only works in Phosh (use --force to install anyway)."
fi
case "${XDG_CURRENT_DESKTOP:-}" in
*[Pp]hosh*|"") ;;
*) warn "this session is ${XDG_CURRENT_DESKTOP}; gnosh will only run once you log into Phosh" ;;
esac
if have gjs; then
    ok "gjs: $(gjs --version 2>/dev/null)"
else
    warn "gjs is missing; install gjs for gnosh to run"
fi
have python3 || die "python3 is needed for the gnosh command"
if ! have glib-compile-schemas; then
    warn "glib-compile-schemas is missing; extensions with settings need it (glib / libglib2.0-bin)"
fi

# --- get the files ---------------------------------------------------------------

SELF_DIR=$(CDPATH='' cd -- "$(dirname -- "$0")" 2>/dev/null && pwd || echo "")
if [ -z "$FROM_DIR" ] && [ -n "$SELF_DIR" ] && [ -f "$SELF_DIR/runtime/shell/main.js" ] && [ -f "$SELF_DIR/bin/gnosh" ]; then
    FROM_DIR=$SELF_DIR
fi

if [ -z "$FROM_DIR" ]; then
    step "Downloading gnosh"
    if [ -n "$VERSION" ]; then
        TAG="v${VERSION#v}"
        BASE="https://github.com/$REPO/releases/download/$TAG"
        NAME="gnosh-${VERSION#v}.tar.gz"
    else
        BASE="https://github.com/$REPO/releases/latest/download"
        NAME="gnosh.tar.gz"
    fi
    fetch "$BASE/$NAME" "$TMP/gnosh.tar.gz" || die "could not download $BASE/$NAME"
    if fetch "$BASE/$NAME.sha256" "$TMP/gnosh.tar.gz.sha256" 2>/dev/null; then
        expected=$(cut -d' ' -f1 < "$TMP/gnosh.tar.gz.sha256")
        actual=$(sha256sum "$TMP/gnosh.tar.gz" | cut -d' ' -f1)
        [ "$expected" = "$actual" ] || die "checksum mismatch for $NAME"
        ok "checksum verified"
    else
        warn "no checksum file published; skipping verification"
    fi
    mkdir -p "$TMP/src"
    tar -xzf "$TMP/gnosh.tar.gz" -C "$TMP/src"
    FROM_DIR=$(find "$TMP/src" -mindepth 1 -maxdepth 1 -type d | head -n1)
fi
[ -f "$FROM_DIR/runtime/shell/main.js" ] || die "$FROM_DIR does not contain gnosh"

if [ -f "$FROM_DIR/runtime/VERSION" ]; then
    NEW_VERSION=$(cat "$FROM_DIR/runtime/VERSION")
elif [ -d "$FROM_DIR/.git" ] && have git; then
    NEW_VERSION="$(cat "$FROM_DIR/VERSION")+git.$(git -C "$FROM_DIR" rev-parse --short HEAD 2>/dev/null || echo unknown)"
else
    NEW_VERSION=$(cat "$FROM_DIR/VERSION" 2>/dev/null || echo dev)
fi

# The Phosh module: release layout, git checkout prebuilt, or compile.
MODULE_SRC=""
for m in "$FROM_DIR/modules/$ARCH/libgnosh-phosh.so" "$FROM_DIR/modules/prebuilt/$ARCH/libgnosh-phosh.so"; do
    [ -f "$m" ] && MODULE_SRC=$m && break
done
if [ -z "$MODULE_SRC" ] && [ -f "$FROM_DIR/src/module/gnosh-module.c" ] && have cc; then
    cc -O2 -fPIC -shared -nostdlib -fno-stack-protector -fvisibility=hidden -s \
        -o "$TMP/libgnosh-phosh.so" "$FROM_DIR/src/module/gnosh-module.c" && MODULE_SRC="$TMP/libgnosh-phosh.so"
fi
[ -n "$MODULE_SRC" ] || die "no gnosh module for $ARCH (supported: x86_64 aarch64 armv7l riscv64)"

# --- install ----------------------------------------------------------------------

step "Installing gnosh $NEW_VERSION"
mkdir -p "$DATA_HOME/gnosh" "$MODULE_DIR" "$BIN_DIR" "$CONFIG_HOME/gnosh"
rm -rf "$RUNTIME_DIR.new"
cp -R "$FROM_DIR/runtime" "$RUNTIME_DIR.new"
echo "$NEW_VERSION" > "$RUNTIME_DIR.new/VERSION"
rm -rf "$RUNTIME_DIR.old"
[ -d "$RUNTIME_DIR" ] && mv "$RUNTIME_DIR" "$RUNTIME_DIR.old"
mv "$RUNTIME_DIR.new" "$RUNTIME_DIR"
rm -rf "$RUNTIME_DIR.old"
ok "runtime: $RUNTIME_DIR"

# Replace the module atomically; the running Phosh keeps its mapped copy.
cp "$MODULE_SRC" "$MODULE_DIR/libgnosh-phosh.so.new"
mv "$MODULE_DIR/libgnosh-phosh.so.new" "$MODULE_DIR/libgnosh-phosh.so"
ok "Phosh module: $MODULE_DIR/libgnosh-phosh.so"

sed "s/^VERSION = \"dev\"/VERSION = \"$NEW_VERSION\"/" "$FROM_DIR/bin/gnosh" > "$BIN_DIR/gnosh.new"
chmod 755 "$BIN_DIR/gnosh.new"
mv "$BIN_DIR/gnosh.new" "$BIN_DIR/gnosh"
ok "command: $BIN_DIR/gnosh"

if [ "$UPDATE_ONLY" = 1 ]; then
    ok "gnosh updated to $NEW_VERSION"
    exit 0
fi

GNOSH="$BIN_DIR/gnosh"
step "Enabling gnosh in Phosh"
GNOSH_FORCE=1 "$GNOSH" shell enable | sed 's/^/  /'

# --- Extension Manager ---------------------------------------------------------------

install_extension_manager() {
    step "Installing Extension Manager"
    if have extension-manager; then
        ok "Extension Manager is installed (system package)"
        return
    fi
    if ! have flatpak; then
        warn "flatpak is not installed; install Extension Manager from your distribution if it packages it"
        return
    fi
    if flatpak info com.mattjakeman.ExtensionManager >/dev/null 2>&1; then
        ok "Extension Manager is installed (flatpak)"
        return
    fi
    flatpak --user remote-add --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo >/dev/null 2>&1 || \
        warn "could not add the Flathub remote"
    if flatpak --user install -y --noninteractive flathub com.mattjakeman.ExtensionManager; then
        ok "Extension Manager installed (flatpak --user)"
    else
        warn "installing Extension Manager failed; run: flatpak --user install flathub com.mattjakeman.ExtensionManager"
    fi
}

# --- gnome-extensions-cli (gext) ------------------------------------------------------

install_gext() {
    step "Installing gnome-extensions-cli (gext)"
    real=""
    if [ -x "$GEXT_HOME/bin/gext" ]; then
        real="$GEXT_HOME/bin/gext"
    elif python3 -m venv "$GEXT_HOME" >/dev/null 2>&1 && [ -x "$GEXT_HOME/bin/pip" ]; then
        if "$GEXT_HOME/bin/pip" install --quiet --disable-pip-version-check gnome-extensions-cli; then
            real="$GEXT_HOME/bin/gext"
        fi
    fi
    if [ -z "$real" ] && have pipx; then
        pipx install --force gnome-extensions-cli >/dev/null 2>&1 || true
        venvs=$(pipx environment --value PIPX_LOCAL_VENVS 2>/dev/null || echo "$HOME/.local/pipx/venvs")
        [ -x "$venvs/gnome-extensions-cli/bin/gext" ] && real="$venvs/gnome-extensions-cli/bin/gext"
    fi
    if [ -z "$real" ]; then
        rm -rf "$GEXT_HOME"
        if python3 -m pip install --user --quiet gnome-extensions-cli 2>/dev/null ||
            python3 -m pip install --user --quiet --break-system-packages gnome-extensions-cli 2>/dev/null; then
            real=$(python3 -c 'import site, os; print(os.path.join(site.USER_BASE, "bin", "gext"))')
        fi
    fi
    if [ -z "$real" ] || [ ! -x "$real" ]; then
        warn "could not install gext (needs python3-venv, pipx or pip); gnosh works without it"
        return
    fi
    # gext asks GNOME Shell for its version over D-Bus; Phosh does not report
    # one, so the wrapper uses gext's filesystem backend and gives it the
    # GNOME Shell version gnosh implements.
    mkdir -p "$DATA_HOME/gnosh/gext-shim"
    cat > "$DATA_HOME/gnosh/gext-shim/gnome-shell" <<'SHIM'
#!/bin/sh
# gnosh: reports the GNOME Shell API version gnosh implements (for gext only)
version=$(sed -n 's/.*"shellVersion": *"\([0-9.]*\)".*/\1/p' "${XDG_CONFIG_HOME:-$HOME/.config}/gnosh/config.json" 2>/dev/null)
echo "GNOME Shell ${version:-50.0}"
SHIM
    chmod 755 "$DATA_HOME/gnosh/gext-shim/gnome-shell"
    if [ "$real" = "$BIN_DIR/gext" ]; then
        # pip --user put gext where the wrapper goes; keep it next to gnosh.
        mv "$real" "$DATA_HOME/gnosh/gext-real"
        real="$DATA_HOME/gnosh/gext-real"
    fi
    cat > "$BIN_DIR/gext" <<WRAP
#!/bin/sh
# gnosh wrapper for gnome-extensions-cli: use the filesystem backend in Phosh.
export PATH="$DATA_HOME/gnosh/gext-shim:\$PATH"
for a in "\$@"; do
    case "\$a" in --dbus|-D|--filesystem|-F) exec "$real" "\$@" ;; esac
done
exec "$real" --filesystem "\$@"
WRAP
    chmod 755 "$BIN_DIR/gext"
    ok "gext installed ($BIN_DIR/gext)"
}

[ "$WITH_EM" = 1 ] && install_extension_manager
[ "$WITH_GEXT" = 1 ] && install_gext

if [ "$AUTO_UPDATE" = 1 ]; then
    step "Enabling automatic updates"
    if have systemctl && systemctl --user show-environment >/dev/null 2>&1; then
        GNOSH_FORCE=1 "$GNOSH" config auto-update true | sed 's/^/  /'
    else
        warn "no systemd user session; run 'gnosh self-update' by hand"
    fi
fi

step "Done"
case ":$PATH:" in
*":$BIN_DIR:"*) ;;
*) warn "$BIN_DIR is not in your PATH; add it in ~/.profile" ;;
esac
say ""
say "  ${B}gnosh $NEW_VERSION is installed.${N} Log out and back in (or reboot) to start it in Phosh."
say "  Then:  gnosh install clipboard-indicator@tudmotu.com"
say "         gnosh list     gnosh doctor     gnosh --help"
say "  GNOME Shell extensions show up in Phosh's top bar and quick settings."
