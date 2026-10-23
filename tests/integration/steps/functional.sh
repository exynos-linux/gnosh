# Functional checks (EXTENSIONS should include appindicatorsupport, clipboard-indicator, caffeine).
sleep 8
js 'globalThis.__gnosh.openDialogs?.forEach(d => d.close()); "ok"' >/dev/null

# 1. A StatusNotifierItem app shows up through AppIndicator support.
gjs -m "$GNOSH_SRC/tests/integration/fixtures/sni-app.js" > "$OUT/sni-app.log" 2>&1 &
sni_pid=$!
sleep 5
status after-sni
gnosh Unfold >/dev/null; sleep 2
shot f1-drawer-with-tray-icon
js 'const b = globalThis.__gnosh.bridge; const t = [...b._tiles.entries()].find(([o, e]) => /tray test/.test(e.tile._icon.info)); if (!t) "no tray tile"; else { e = t[1]; e.tile.showStatus(); "shown " + e.tile._icon.info }' > "$OUT/f-sni-show.txt" 2>&1
sleep 3
shot f2-tray-menu
js 'const St = imports.gi.St; const b = globalThis.__gnosh.bridge; const t = [...b._tiles.entries()].find(([o, e]) => /tray test/.test(e.tile._icon.info)); const labels = []; const walk = a => { if (a instanceof St.Label && a.text) labels.push(a.text); a.get_children().forEach(walk); }; if (t) walk(t[0].menu.actor); JSON.stringify(labels)' > "$OUT/f-sni-menu.txt" 2>&1
js 'globalThis.__gnosh.bridge._tiles.forEach(e => e.tile.hideStatus()); "ok"' >/dev/null

# 2. Clipboard Indicator records text copied by another app.
WAYLAND_DISPLAY=wayland-0 wl-copy "gnosh clipboard test $(date +%s)" &
sleep 2
show clipboard-indicator@tudmotu.com
sleep 3
shot f3-clipboard-history
js 'const St = imports.gi.St; const b = globalThis.__gnosh.bridge; const t = [...b._tiles.entries()].find(([o, e]) => e.tile.ext?.uuid === "clipboard-indicator@tudmotu.com"); const labels = []; const walk = a => { if (a instanceof St.Label && a.text) labels.push(a.text); a.get_children().forEach(walk); }; if (t) walk(t[0].menu.actor); JSON.stringify(labels)' > "$OUT/f-clipboard-labels.txt" 2>&1
js 'globalThis.__gnosh.bridge._tiles.forEach(e => e.tile.hideStatus()); "ok"' >/dev/null

# 3. Caffeine's quick toggle switches when its tile is clicked.
js 'const b = globalThis.__gnosh.bridge; const t = [...b._tiles.entries()].find(([o, e]) => e.tile.ext?.uuid === "caffeine@patapon.info"); const before = t[0].checked; t[1].tile._qs.emit("clicked"); JSON.stringify({before, after: t[0].checked, tileActive: t[1].tile._qs.active})' > "$OUT/f-caffeine-toggle.txt" 2>&1
sleep 2
shot f4-caffeine-on
kill $sni_pid 2>/dev/null
status final
