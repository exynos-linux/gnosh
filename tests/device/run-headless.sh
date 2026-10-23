#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-or-later
#
# Test gnosh on a real Phosh device without touching the running session.
# Run as root on the device:  sh run-headless.sh USER SRC_TARBALL "UUID ..."
#
# Starts a second, headless phoc + Phosh as USER with:
#  - a temporary HOME (the user's settings and extensions are not used),
#  - a private session bus that can only activate dconf,
#  - no system bus (so the test Phosh cannot register agents for the user),
# installs gnosh there with setup.sh, installs extensions with `gnosh
# install`, and takes screenshots. Everything lives in /tmp/gnosh-device-test.
set -eu
USER_NAME=$1
TARBALL=$2
INSTALL=${3:-"caffeine@patapon.info clipboard-indicator@tudmotu.com"}
BASE=/tmp/gnosh-device-test
rm -rf "$BASE"
mkdir -p "$BASE/src" "$BASE/home" "$BASE/xdg" "$BASE/out" "$BASE/dbus-services"
tar -xzf "$TARBALL" -C "$BASE/src"
SRC=$(find "$BASE/src" -mindepth 1 -maxdepth 1 -type d | head -n1)

# Only dconf may be activated on the private bus.
cp /usr/share/dbus-1/services/ca.desrt.dconf.service "$BASE/dbus-services/" 2>/dev/null || true
cat > "$BASE/session.conf" <<CONF
<!DOCTYPE busconfig PUBLIC "-//freedesktop//DTD D-Bus Bus Configuration 1.0//EN"
 "http://www.freedesktop.org/standards/dbus/1.0/busconfig.dtd">
<busconfig>
  <type>session</type>
  <listen>unix:tmpdir=$BASE</listen>
  <auth>EXTERNAL</auth>
  <servicedir>$BASE/dbus-services</servicedir>
  <policy context="default">
    <allow send_destination="*" eavesdrop="true"/>
    <allow eavesdrop="true"/>
    <allow own="*"/>
  </policy>
</busconfig>
CONF
chown -R "$USER_NAME" "$BASE"
chmod 700 "$BASE/xdg"

cat > "$BASE/inner.sh" <<'INNER'
#!/bin/sh
set -u
BASE=/tmp/gnosh-device-test
OUT=$BASE/out
export PATH="$HOME/.local/bin:$PATH"
echo "== setup.sh"
sh "$SRC/setup.sh" --no-extension-manager --no-auto-update > "$OUT/setup.log" 2>&1; echo "setup exit $?"
tail -5 "$OUT/setup.log"
dropin=$(ls "$HOME"/.config/systemd/user/*.service.d/50-gnosh.conf | head -n1)
module=$(sed -n 's/^Environment=GTK_MODULES=//p' "$dropin")
echo "module: $module ($(file -b "$module" 2>/dev/null | cut -c1-60))"
printf '[core]\nxwayland=false\n[output:HEADLESS-1]\nmode=800x1280\nscale=2\n' > "$BASE/phoc.ini"
export WLR_BACKENDS=headless WLR_HEADLESS_OUTPUTS=1 WLR_RENDERER=pixman
export XDG_CURRENT_DESKTOP=Phosh:GNOME XDG_SESSION_TYPE=wayland NO_AT_BRIDGE=1 GNOSH_UNSAFE=1
export DBUS_SYSTEM_BUS_ADDRESS=unix:path=$BASE/no-system-bus
unset WAYLAND_DISPLAY DISPLAY
GTK_MODULES="$module" phoc -C "$BASE/phoc.ini" -E "/usr/libexec/phosh -U" > "$OUT/phosh.log" 2>&1 &
pid=$!
i=0; while [ $i -lt 90 ] && ! gnosh status >/dev/null 2>&1; do sleep 1; i=$((i+1)); done
echo "== gnosh status ($i s)"; gnosh status
echo "== gnosh doctor"; gnosh doctor
echo "== gnosh install $INSTALL"; gnosh install $INSTALL
sleep 8
echo "== gnosh list"; gnosh list -v --enabled
call() { m=$1; shift; gdbus call --session --dest io.github.exynos_linux.Gnosh --object-path /io/github/exynos_linux/Gnosh --method "io.github.exynos_linux.Gnosh.$m" "$@"; }
shot() {
    if command -v grim >/dev/null; then WAYLAND_DISPLAY=$(ls "$XDG_RUNTIME_DIR" | grep '^wayland-[0-9]*$' | head -n1) grim "$OUT/$1.png"
    else gdbus call --session --dest org.gnome.Shell.Screenshot --object-path /org/gnome/Shell/Screenshot \
        --method org.gnome.Shell.Screenshot.Screenshot false false "$OUT/$1.png" >/dev/null; fi
}
call Unfold >/dev/null; sleep 2; shot drawer
for u in $INSTALL; do call ShowExtension "$u" >/dev/null 2>&1; sleep 3; shot "page-$u"; done
call GetStatus > "$OUT/status.txt"
echo "== memory"; grep -E "VmRSS|VmHWM" /proc/$(pgrep -n -x phosh)/status 2>/dev/null
kill $pid
INNER
chmod +x "$BASE/inner.sh"
runuser -u "$USER_NAME" -- env -i HOME="$BASE/home" USER="$USER_NAME" PATH=/usr/local/bin:/usr/bin:/bin \
    XDG_RUNTIME_DIR="$BASE/xdg" SRC="$SRC" INSTALL="$INSTALL" LANG=C.UTF-8 \
    dbus-run-session --config-file="$BASE/session.conf" -- "$BASE/inner.sh"
echo "== gnosh messages"
grep -E "gnosh|JS ERROR" "$BASE/out/phosh.log" | grep -v closure_unref | head -40
