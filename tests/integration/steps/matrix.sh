# shellcheck shell=sh
# Steps for run-phosh.sh: test one extension ($EXTENSIONS holds one uuid).
sleep 9
js 'const d = globalThis.__gnosh.openDialogs; const n = d?.size ?? 0; d?.forEach(x => x.close()); String(n)' > "$OUT/dialogs.txt" 2>&1
sleep 1
shot topbar
gnosh Unfold >/dev/null
sleep 2
shot drawer
show "$EXTENSIONS"
sleep 3
shot page
status status
