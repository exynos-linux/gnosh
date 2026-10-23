// SPDX-License-Identifier: GPL-3.0-or-later
//
// gnosh prefs host: shows a GNOME Shell extension's preferences (prefs.js,
// GTK 4 + libadwaita) the way GNOME's Extensions app does.
//
//   gjs -m prefs/main.js UUID

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import System from 'system';

imports.gi.versions.Gtk = '4.0';
imports.gi.versions.Gdk = '4.0';
imports.gi.versions.Adw = '1';

const RUNTIME_DIR = GLib.path_get_dirname(GLib.path_get_dirname(GLib.filename_from_uri(import.meta.url)[0]));

function readFile(path) {
    return GLib.file_get_contents(path)[1];
}

function collect(dir, prefix, out) {
    const e = Gio.File.new_for_path(dir).enumerate_children('standard::name,standard::type', 0, null);
    for (let info; (info = e.next_file(null));) {
        const path = `${dir}/${info.get_name()}`;
        if (info.get_file_type() === Gio.FileType.DIRECTORY)
            collect(path, `${prefix}/${info.get_name()}`, out);
        else
            out.set(`${prefix}/${info.get_name()}`, readFile(path));
    }
}

async function registerResources() {
    const {buildResource} = await import('../shell/gresource.js');
    const files = new Map();
    const shim = `${RUNTIME_DIR}/shim/org/gnome/shell`;
    const ext = '/org/gnome/Shell/Extensions/js';
    collect(`${shim}/misc`, `${ext}/misc`, files);
    // Some prefs.js import the shell-side config by mistake; it works in
    // GNOME because the shell resource is not needed for config.js.
    files.set('/org/gnome/shell/misc/config.js', readFile(`${shim}/misc/config.js`));
    files.set(`${ext}/extensions/sharedInternals.js`, readFile(`${shim}/extensions/sharedInternals.js`));
    files.set(`${ext}/extensions/prefs.js`, readFile(`${RUNTIME_DIR}/prefs/prefs.js`));
    files.set(`${ext}/extensionsService.js`, readFile(`${RUNTIME_DIR}/prefs/extensionsService.js`));
    Gio.resources_register(Gio.Resource.new_from_data(buildResource(files)));
}

function findExtension(uuid) {
    const dirs = [GLib.build_filenamev([GLib.get_user_data_dir(), 'gnome-shell', 'extensions'])];
    for (const d of GLib.get_system_data_dirs())
        dirs.push(GLib.build_filenamev([d, 'gnome-shell', 'extensions']));
    for (const base of dirs) {
        const dir = Gio.File.new_for_path(`${base}/${uuid}`);
        if (dir.get_child('metadata.json').query_exists(null)) {
            const metadata = JSON.parse(new TextDecoder().decode(readFile(`${dir.get_path()}/metadata.json`)));
            return {uuid, dir, path: dir.get_path(), metadata, hasPrefs: dir.get_child('prefs.js').query_exists(null)};
        }
    }
    return null;
}

function readConfig() {
    try {
        const path = GLib.build_filenamev([GLib.get_user_config_dir(), 'gnosh', 'config.json']);
        return JSON.parse(new TextDecoder().decode(readFile(path)));
    } catch {
        return {};
    }
}

async function main(argv) {
    const uuid = argv[0];
    if (!uuid) {
        printerr('usage: gnosh-prefs UUID');
        return 2;
    }
    let version = 'dev';
    try {
        version = new TextDecoder().decode(readFile(`${RUNTIME_DIR}/VERSION`)).trim();
    } catch {
        // development tree
    }
    globalThis.__gnosh = {version, shellVersion: readConfig().shellVersion ?? '50.0', localeDir: '/usr/share/locale'};
    globalThis.__gnoshPrefs = {extensions: new Map()};

    await registerResources();
    const Adw = (await import('gi://Adw?version=1')).default;
    const Gtk = (await import('gi://Gtk?version=4.0')).default;

    const extension = findExtension(uuid);
    const app = new Adw.Application({
        application_id: 'io.github.exynos_linux.Gnosh.Prefs',
        flags: Gio.ApplicationFlags.NON_UNIQUE,
    });

    app.connect('activate', () => {
        const window = new Adw.PreferencesWindow({
            application: app,
            title: extension?.metadata.name ?? uuid,
            search_enabled: false,
            default_width: 600,
            default_height: 720,
        });
        const showError = e => {
            while (window.visible_page)
                window.remove(window.visible_page);
            window.set_title('Extension Error');
            const page = new Adw.PreferencesPage();
            const group = new Adw.PreferencesGroup({title: 'Something went wrong',
                description: 'The extension\'s preferences could not be shown in gnosh.'});
            const label = new Gtk.Label({label: `${e}\n\n${e.stack ?? ''}`, wrap: true, selectable: true, xalign: 0});
            label.add_css_class('monospace');
            group.add(label);
            page.add(group);
            window.add(page);
        };
        window.present();
        (async () => {
            if (!extension)
                throw new Error(`Extension ${uuid} is not installed`);
            if (!extension.hasPrefs)
                throw new Error(`${extension.metadata.name} has no preferences`);
            globalThis.__gnoshPrefs.extensions.set(uuid, extension);
            const prefsModule = await import(extension.dir.get_child('prefs.js').get_uri());
            const prefsObj = new prefsModule.default({...extension.metadata, dir: extension.dir, path: extension.path});
            extension.stateObj = prefsObj;
            await prefsObj.fillPreferencesWindow(window);
            if (!window.visible_page)
                throw new Error('Extension did not provide any UI');
        })().catch(e => {
            logError(e, `gnosh: preferences of ${uuid}`);
            showError(e);
        });
    });
    return app.runAsync ? app.runAsync([System.programInvocationName]) : app.run([System.programInvocationName]);
}

const status = await main(ARGV);
System.exit(status ?? 0);
