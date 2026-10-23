# Steps for run-phosh.sh: official GNOME extensions in headless Phosh.
sleep 8
status status
shot 00-home
gnosh Unfold >/dev/null
sleep 2
shot 01-drawer
show places-menu@gnome-shell-extensions.gcampax.github.com
sleep 2
shot 02-places-menu
