// SPDX-License-Identifier: GPL-3.0-or-later
//
// gnosh runtime entry point. Loaded inside Phosh by the gnosh GTK module
// (libgnosh-phosh.so) once Phosh's main loop runs.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

imports.gi.versions.Gtk = '3.0';
imports.gi.versions.Gdk = '3.0';
imports.gi.versions.GdkX11 = '3.0';
imports.gi.versions.GnomeDesktop = '3.0';
imports.gi.versions.Soup = '3.0';
imports.gi.versions.Handy = '1';

const RUNTIME_DIR = GLib.path_get_dirname(GLib.path_get_dirname(GLib.filename_from_uri(import.meta.url)[0]));
const VERSION = (() => {
    try {
        return new TextDecoder().decode(GLib.file_get_contents(`${RUNTIME_DIR}/VERSION`)[1]).trim();
    } catch {
        return 'dev';
    }
})();

function readConfig() {
    try {
        const path = GLib.build_filenamev([GLib.get_user_config_dir(), 'gnosh', 'config.json']);
        return JSON.parse(new TextDecoder().decode(GLib.file_get_contents(path)[1]));
    } catch {
        return {};
    }
}

/** Collect the shim files: path under runtime/shim -> resource path. */
function collectShimFiles(dir, prefix, out) {
    const enumerator = Gio.File.new_for_path(dir).enumerate_children('standard::name,standard::type',
        Gio.FileQueryInfoFlags.NONE, null);
    for (let info; (info = enumerator.next_file(null));) {
        const name = info.get_name();
        const path = `${dir}/${name}`;
        if (info.get_file_type() === Gio.FileType.DIRECTORY)
            collectShimFiles(path, `${prefix}/${name}`, out);
        else
            out.set(`${prefix}/${name}`, GLib.file_get_contents(path)[1]);
    }
    return out;
}

async function registerShimResources() {
    const {buildResource} = await import('./gresource.js');
    const files = collectShimFiles(`${RUNTIME_DIR}/shim`, '', new Map());
    // The prefs-side modules extensions import from prefs.js live in a
    // separate process, but some extensions import shared modules from
    // the Extensions app prefix in extension.js too.
    const bytes = buildResource(files);
    Gio.resources_register(Gio.Resource.new_from_data(bytes));
    return files.size;
}

function markStableLater() {
    // The GTK module counts starts that never became stable; clear the
    // counter once gnosh has been running for a while.
    GLib.timeout_add_seconds(GLib.PRIORITY_LOW, 45, () => {
        const dir = GLib.build_filenamev([GLib.get_user_runtime_dir(), 'gnosh']);
        for (const name of ['unstable-starts', 'safe-mode'])
            GLib.unlink(`${dir}/${name}`);
        return GLib.SOURCE_REMOVE;
    });
}

async function start() {
    const config = readConfig();
    globalThis.__gnosh = {
        version: VERSION,
        runtimeDir: RUNTIME_DIR,
        dataDir: `${RUNTIME_DIR}/data`,
        shellVersion: config.shellVersion ?? '50.0',
        localeDir: '/usr/share/locale',
        unsafe: GLib.getenv('GNOSH_UNSAFE') === '1',
        startTime: GLib.get_monotonic_time(),
    };
    console.log(`gnosh ${VERSION}: starting in ${GLib.get_prgname()} (GNOME Shell ${globalThis.__gnosh.shellVersion} API)`);

    const stateDir = GLib.build_filenamev([GLib.get_user_runtime_dir(), 'gnosh']);
    GLib.mkdir_with_parents(stateDir, 0o700);

    const {installTypelibs, populateNamespaces} = await import('../gi/install.js');
    await installTypelibs(stateDir);
    await populateNamespaces();
    const nFiles = await registerShimResources();
    console.debug(`gnosh: registered ${nFiles} shim modules`);

    const Env = await import('./env.js');
    await Env.setup();
    const {createGlobal} = await import('./global.js');
    await createGlobal();

    const Style = await import('../gi/style.js');
    const theme = new TextDecoder().decode(GLib.file_get_contents(`${RUNTIME_DIR}/data/gnosh.css`)[1]);
    const {css, stRules} = Style.translateStylesheet(theme, '');
    Style.loadScreenCss('gnosh-base', css, 600 /* APPLICATION */);
    Style.addStRules(stRules, 'gnosh-base');

    const {Bridge} = await import('./bridge.js');
    const bridge = new Bridge();
    globalThis.__gnosh.bridge = bridge;
    await bridge.waitForPhosh();

    bridge.modules = {
        Layout: await import('resource:///org/gnome/shell/ui/layout.js'),
        MessageTray: await import('resource:///org/gnome/shell/ui/messageTray.js'),
        Panel: await import('resource:///org/gnome/shell/ui/panel.js'),
        QuickSettings: await import('resource:///org/gnome/shell/ui/quickSettings.js'),
        ExtensionSystem: await import('resource:///org/gnome/shell/ui/extensionSystem.js'),
    };
    const Main = await import('resource:///org/gnome/shell/ui/main.js');
    globalThis.__gnosh.main = Main;
    Main.start(bridge);
    bridge.attachPanel(Main.panel);
    bridge.watchLockState(locked => Main._gnoshSetLocked(locked));
    bridge.watchActivities(global.display);

    const {openPrefs} = await import('./prefs.js');
    const {exportServices} = await import('./dbus.js');
    // Keep the exported objects alive; GJS unexports them when collected.
    globalThis.__gnosh.dbus = exportServices({
        Main,
        bridge,
        Config: await import('resource:///org/gnome/shell/misc/config.js'),
        ExtensionUtils: await import('resource:///org/gnome/shell/misc/extensionUtils.js'),
        Downloader: await import('resource:///org/gnome/shell/ui/extensionDownloader.js'),
        openPrefs,
    });

    Main.extensionManager.init();
    markStableLater();
    console.log('gnosh: ready');
}

start().catch(e => {
    logError(e, 'gnosh: failed to start');
});
