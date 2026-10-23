# Changelog

## 0.1.0 (2026-10-23)

First release.

- Runs GNOME Shell 45–51 extensions inside Phosh. A GTK module loads GJS
  into the stock Phosh process. St, Clutter, Meta and Shell are implemented
  on GTK 3, and GNOME Shell 50's own UI modules are reused.
- Indicators show in Phosh's top bar. Their menus, quick toggles and sliders
  become Phosh quick settings tiles and status pages. Dialogs use Phosh's
  system dialogs and notifications use Phosh's notification server.
- `org.gnome.Shell.Extensions` D-Bus API for Extension Manager, gext and
  gnome-extensions. Extensions installed while Phosh runs load immediately.
- Extension preferences run in a GTK 4 / libadwaita host.
- `gnosh` command: install, enable, disable, list, search, update, prefs,
  doctor, self-update, shell, config and log. It refuses to run outside Phosh.
- `setup.sh`: per-user installer (curl | sh or git clone) that also
  installs Extension Manager (flatpak --user) and gnome-extensions-cli, and
  sets up a daily update timer.
- Crash guard: gnosh stays out of Phosh after two unstable starts.
- Prebuilt modules for x86_64, aarch64, armv7l and riscv64 (glibc and musl).
