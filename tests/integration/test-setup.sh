#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-or-later
#
# End-to-end test, run inside the test container as a fresh user:
# setup.sh -> Phosh started the way the installed systemd drop-in says ->
# gnosh CLI installs extensions from extensions.gnome.org into the running
# Phosh -> screenshots and status in $OUT.
#
# Environment: SETUP_SOURCE=git (default: install from the mounted checkout)
#              or SETUP_SOURCE=release (curl | sh from GitHub).
#              INSTALL="uuid ..." extensions to install with gnosh.
set -eu
OUT=${OUT:-/out}
mkdir -p "$OUT"
INSTALL=${INSTALL:-"caffeine@patapon.info clipboard-indicator@tudmotu.com"}
export XDG_RUNTIME_DIR=/tmp/xdg
mkdir -p "$XDG_RUNTIME_DIR" && chmod 700 "$XDG_RUNTIME_DIR"
export PATH="$HOME/.local/bin:$PATH"

echo "== setup.sh ($SETUP_SOURCE) as $(id -un), home $HOME"
if [ "${SETUP_SOURCE:-git}" = release ]; then
    curl -fsSL https://raw.githubusercontent.com/exynos-linux/gnosh/main/setup.sh |
        sh -s -- --no-extension-manager --no-auto-update 2>&1 | tee "$OUT/setup.log"
else
    sh /gnosh/setup.sh --no-extension-manager --no-auto-update 2>&1 | tee "$OUT/setup.log"
fi

echo "== installed files"
# shellcheck disable=SC2012 # human-readable listing for the test log
ls -la "$HOME/.local/bin" "$HOME/.local/lib/gnosh" "$HOME/.local/share/gnosh" | tee "$OUT/files.txt"
gnosh --version
dropin=""
for f in "$HOME"/.config/systemd/user/*.service.d/50-gnosh.conf; do
    [ -f "$f" ] && { dropin=$f; break; }
done
echo "drop-in: ${dropin:-none}"
[ -n "$dropin" ] && cat "$dropin"
module=$(sed -n 's/^Environment=GTK_MODULES=//p' "$dropin")
[ -f "$module" ] || { echo "module from drop-in not found: $module"; exit 1; }

export WLR_BACKENDS=headless WLR_RENDERER=pixman WLR_HEADLESS_OUTPUTS=1
export XDG_CURRENT_DESKTOP=Phosh:GNOME XDG_SESSION_DESKTOP=phosh XDG_SESSION_TYPE=wayland
export NO_AT_BRIDGE=1 GLYCIN_DISABLE_SANDBOX=1
printf '[core]\nxwayland=false\n[output:HEADLESS-1]\nmode=720x1440\nscale=2\n' > /tmp/phoc.ini

cat > /tmp/session.sh <<SESSION
#!/bin/sh
set -u
gsettings set org.gnome.shell enabled-extensions "[]"
# What the systemd drop-in does for mobi.phosh.Shell.service:
GTK_MODULES="$module" phoc -C /tmp/phoc.ini -E "/usr/libexec/phosh -U" > "$OUT/phosh.log" 2>&1 &
pid=\$!
( sleep 2; dbus-update-activation-environment WAYLAND_DISPLAY=wayland-0 ) >/dev/null 2>&1 &
i=0; while [ \$i -lt 60 ] && ! gnosh status >/dev/null 2>&1; do sleep 1; i=\$((i+1)); done
echo "== gnosh status"; gnosh status
echo "== gnosh doctor"; gnosh doctor || true
echo "== gnosh install $INSTALL"; gnosh install $INSTALL
sleep 6
echo "== gnosh list"; gnosh list -v
echo "== gext list"; gext list 2>&1 | head -20 || true
echo "== gnosh search"; gnosh search clipboard -n 3 || true
gdbus call --session --dest io.github.exynos_linux.Gnosh --object-path /io/github/exynos_linux/Gnosh \
    --method io.github.exynos_linux.Gnosh.Unfold >/dev/null
sleep 2
WAYLAND_DISPLAY=wayland-0 grim "$OUT/setup-drawer.png"
gdbus call --session --dest io.github.exynos_linux.Gnosh --object-path /io/github/exynos_linux/Gnosh \
    --method io.github.exynos_linux.Gnosh.GetStatus > "$OUT/status.txt"
kill \$pid
SESSION
chmod +x /tmp/session.sh
export GNOSH_FORCE_UNUSED=1
dbus-run-session -- /tmp/session.sh 2>&1 | tee "$OUT/session.log"
echo "== gnosh messages"
grep -E "gnosh|JS ERROR" "$OUT/phosh.log" | grep -v closure_unref | head -30
