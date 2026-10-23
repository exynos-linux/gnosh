#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-or-later
#
# Inside the test container: setup.sh installs Extension Manager (flatpak
# --user from Flathub); Extension Manager then talks to gnosh's
# org.gnome.Shell.Extensions service in headless Phosh. Screenshots in $OUT.
set -eu
OUT=${OUT:-/out}
mkdir -p "$OUT"
export XDG_RUNTIME_DIR=/tmp/xdg
mkdir -p "$XDG_RUNTIME_DIR" && chmod 700 "$XDG_RUNTIME_DIR"
export PATH="$HOME/.local/bin:$PATH"
command -v flatpak >/dev/null || sudo apk add -q flatpak >/dev/null
echo "== setup.sh (with Extension Manager)"
sh /gnosh/setup.sh --no-gext --no-auto-update 2>&1 | tee "$OUT/setup.log"
flatpak --user list --app | tee "$OUT/flatpak-list.txt"

dropin=$(ls "$HOME"/.config/systemd/user/*.service.d/50-gnosh.conf | head -n1)
module=$(sed -n 's/^Environment=GTK_MODULES=//p' "$dropin")
export WLR_BACKENDS=headless WLR_RENDERER=pixman WLR_HEADLESS_OUTPUTS=1
export XDG_CURRENT_DESKTOP=Phosh:GNOME XDG_SESSION_TYPE=wayland NO_AT_BRIDGE=1 GLYCIN_DISABLE_SANDBOX=1
printf '[core]\nxwayland=false\n[output:HEADLESS-1]\nmode=720x1440\nscale=2\n' > /tmp/phoc.ini
cat > /tmp/session.sh <<SESSION
#!/bin/sh
set -u
dbus-update-activation-environment WAYLAND_DISPLAY=wayland-0 XDG_CURRENT_DESKTOP >/dev/null 2>&1
GTK_MODULES="$module" phoc -C /tmp/phoc.ini -E "/usr/libexec/phosh -U" > "$OUT/phosh.log" 2>&1 &
pid=\$!
i=0; while [ \$i -lt 60 ] && ! gnosh status >/dev/null 2>&1; do sleep 1; i=\$((i+1)); done
gnosh install caffeine@patapon.info clipboard-indicator@tudmotu.com
sleep 3
WAYLAND_DISPLAY=wayland-0 flatpak run com.mattjakeman.ExtensionManager > "$OUT/extension-manager.log" 2>&1 &
sleep 25
WAYLAND_DISPLAY=wayland-0 grim "$OUT/em-installed.png"
gnosh status
kill \$pid
SESSION
chmod +x /tmp/session.sh
dbus-run-session -- /tmp/session.sh 2>&1 | tee "$OUT/session.log"
tail -20 "$OUT/extension-manager.log"
