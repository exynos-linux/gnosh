// SPDX-License-Identifier: GPL-3.0-or-later
//
// Opens an extension's preferences in gnosh's prefs host (a GTK 4 /
// libadwaita process, as GNOME's Extensions app does).

import GLib from 'gi://GLib';

export function openPrefs(uuid, parentWindow = '', options = {}) {
    const runtimeDir = globalThis.__gnosh.runtimeDir;
    const argv = ['gjs', '-m', `${runtimeDir}/prefs/main.js`, uuid];
    if (options?.page)
        argv.push('--page', options.page.deepUnpack?.() ?? String(options.page));
    // Phosh's GTK 3 module variables must not leak into a GTK 4 app.
    let envp = GLib.get_environ();
    for (const name of ['GTK_MODULES', 'GNOSH_MAIN', 'GNOSH_UNSAFE', 'GI_TYPELIB_PATH'])
        envp = GLib.environ_unsetenv(envp, name);
    try {
        GLib.spawn_async(null, argv, envp, GLib.SpawnFlags.SEARCH_PATH, null);
        return true;
    } catch (e) {
        logError(e, `gnosh: cannot open preferences of ${uuid}`);
        return false;
    }
}
