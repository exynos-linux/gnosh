#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-or-later
#
# Run Phosh headless (phoc + phosh) with gnosh inside the test container and
# drive it with a steps script. Meant to run *inside* the container (see
# run-nested.sh).
#
#   run-phosh.sh [STEPS_FILE]
#
# STEPS_FILE is sourced inside the session once gnosh answers on D-Bus; it
# can use: shot NAME, status [NAME], gnosh METHOD [ARGS...], js CODE,
# show UUID, wait SECONDS. Without it, a default sequence runs.
#
# Environment:
#   GNOSH_SRC     gnosh source tree (default /gnosh)
#   EXT_SRC       directory with extracted extensions to install (optional)
#   EXTENSIONS    space-separated UUIDs to enable
#   OUT           output directory for screenshots and logs (default /out)
set -eu

GNOSH_SRC=${GNOSH_SRC:-/gnosh}
OUT=${OUT:-/out}
STEPS=${1:-}
mkdir -p "$OUT"

export XDG_RUNTIME_DIR=/tmp/xdg
mkdir -p "$XDG_RUNTIME_DIR" && chmod 700 "$XDG_RUNTIME_DIR"
export WLR_BACKENDS=headless WLR_RENDERER=pixman WLR_HEADLESS_OUTPUTS=1
export XDG_CURRENT_DESKTOP=Phosh:GNOME XDG_SESSION_DESKTOP=phosh XDG_SESSION_TYPE=wayland
export NO_AT_BRIDGE=1 GLYCIN_DISABLE_SANDBOX=1
export GNOSH_UNSAFE=1

arch=$(uname -m)
MODULE="$GNOSH_SRC/build/libgnosh-phosh-$arch.so"
[ -f "$MODULE" ] || { echo "missing $MODULE (run make module)" >&2; exit 1; }
export GTK_MODULES="$MODULE" GNOSH_MAIN="$GNOSH_SRC/runtime/shell/main.js"

printf '[core]\nxwayland=false\n[output:HEADLESS-1]\nmode=720x1440\nscale=2\n' > /tmp/phoc.ini

cat > /tmp/session.sh <<'SESSION'
#!/bin/sh
set -u
ext_dir="$HOME/.local/share/gnome-shell/extensions"
mkdir -p "$ext_dir"
if [ -n "${EXT_SRC:-}" ]; then
    for uuid in $EXTENSIONS; do
        [ -d "$EXT_SRC/$uuid" ] && cp -r "$EXT_SRC/$uuid" "$ext_dir/"
    done
fi
mkdir -p "$HOME/.local/share/applications"
cp "$GNOSH_SRC"/tests/integration/fixtures/applications/*.desktop "$HOME/.local/share/applications/" 2>/dev/null || true
list=$(printf "'%s'," $EXTENSIONS | sed 's/,$//')
gsettings set org.gnome.shell enabled-extensions "[$list]"
gsettings set org.gnome.shell disable-user-extensions false

phoc -C /tmp/phoc.ini -E "/usr/libexec/phosh -U" > "$OUT/phosh.log" 2>&1 &
phoc_pid=$!
# D-Bus activated services (e.g. GSConnect's daemon) need the display.
( sleep 2; dbus-update-activation-environment WAYLAND_DISPLAY=wayland-0 XDG_CURRENT_DESKTOP ) >/dev/null 2>&1 &

gnosh() {
    method=$1; shift
    timeout 20 gdbus call --session --dest io.github.dixonsolutions.Gnosh \
        --object-path /io/github/dixonsolutions/Gnosh \
        --method "io.github.dixonsolutions.Gnosh.$method" "$@"
}
shot() { WAYLAND_DISPLAY=wayland-0 grim "$OUT/$1.png" 2>/dev/null || echo "screenshot $1 failed"; }
status() { gnosh GetStatus > "$OUT/${1:-status}.txt" 2>&1 || echo "gnosh did not answer" >> "$OUT/${1:-status}.txt"; }
js() { gnosh Eval "$1" 2>&1; }
show() { gnosh ShowExtension "$1" >/dev/null 2>&1 || echo "show $1 failed"; }
wait_s() { sleep "$1"; }

i=0
while [ $i -lt 60 ]; do
    gnosh GetStatus >/dev/null 2>&1 && break
    sleep 1; i=$((i+1))
done

if [ -n "$STEPS_FILE" ]; then
    . "$STEPS_FILE"
else
    sleep 8
    shot 00-home
    gnosh Unfold >/dev/null 2>&1
    sleep 2
    shot 01-drawer
    status status
fi
timeout 10 gdbus call --session --dest org.gnome.Shell.Extensions --object-path /org/gnome/Shell/Extensions \
    --method org.gnome.Shell.Extensions.ListExtensions > "$OUT/list-extensions.txt" 2>&1 || true
kill $phoc_pid 2>/dev/null || true
wait $phoc_pid 2>/dev/null || true
SESSION
chmod +x /tmp/session.sh
export OUT EXTENSIONS="${EXTENSIONS:-}" EXT_SRC="${EXT_SRC:-}" STEPS_FILE="$STEPS" GNOSH_SRC
dbus-run-session -- /tmp/session.sh
echo "== gnosh log"
grep -E "gnosh|JS ERROR|JS WARNING|Gjs-CRITICAL|Gjs-WARNING|CRITICAL|signal [0-9]+" "$OUT/phosh.log" | grep -vE "closure_unref|Gvc-CRITICAL" | head -80 || true
