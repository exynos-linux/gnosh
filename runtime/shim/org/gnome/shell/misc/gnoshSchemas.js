// SPDX-License-Identifier: GPL-3.0-or-later
//
// gnosh: GSettings schemas of extensions. Builds from extensions.gnome.org
// ship schema XML only; GNOME Shell compiles them when it installs an
// extension. gnosh compiles them on install and, as a fallback, before an
// extension's settings are first used (into ~/.cache/gnosh/schemas/<uuid>
// when the extension directory is not writable).

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

function mtime(file) {
    try {
        return file.query_info('time::modified', Gio.FileQueryInfoFlags.NONE, null)
            .get_attribute_uint64('time::modified');
    } catch {
        return 0;
    }
}

function schemaXmls(dir) {
    const out = [];
    try {
        const e = dir.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
        for (let info; (info = e.next_file(null));) {
            if (info.get_name().endsWith('.gschema.xml'))
                out.push(dir.get_child(info.get_name()));
        }
    } catch {
        // no schemas
    }
    return out;
}

function compile(srcDir, targetDir) {
    try {
        GLib.mkdir_with_parents(targetDir, 0o755);
        const proc = Gio.Subprocess.new(['glib-compile-schemas', '--targetdir', targetDir, srcDir],
            Gio.SubprocessFlags.STDERR_PIPE | Gio.SubprocessFlags.STDOUT_SILENCE);
        const [, , stderr] = proc.communicate_utf8(null, null);
        if (!proc.get_successful()) {
            console.warn(`gnosh: glib-compile-schemas ${srcDir}: ${stderr}`);
            return false;
        }
        return true;
    } catch (e) {
        console.warn(`gnosh: cannot compile schemas in ${srcDir}: ${e.message} ` +
            '(install glib-compile-schemas: glib / libglib2.0-bin / glib2)');
        return false;
    }
}

/**
 * The directory holding an up-to-date gschemas.compiled for an extension,
 * compiling it if needed; null if the extension has no schemas dir.
 *
 * @param {Gio.File} extensionDir
 * @param {string} uuid
 */
export function compiledSchemaDir(extensionDir, uuid) {
    const dir = extensionDir.get_child('schemas');
    if (!dir.query_exists(null))
        return null;
    const xmls = schemaXmls(dir);
    const newest = Math.max(0, ...xmls.map(mtime));
    const inPlace = dir.get_child('gschemas.compiled');
    if (inPlace.query_exists(null) && (xmls.length === 0 || mtime(inPlace) >= newest))
        return dir.get_path();
    const cacheDir = GLib.build_filenamev([GLib.get_user_cache_dir(), 'gnosh', 'schemas', uuid]);
    const cached = Gio.File.new_for_path(`${cacheDir}/gschemas.compiled`);
    if (cached.query_exists(null) && mtime(cached) >= newest)
        return cacheDir;
    if (!xmls.length)
        return inPlace.query_exists(null) ? dir.get_path() : null;
    if (compile(dir.get_path(), dir.get_path()))
        return dir.get_path();
    if (compile(dir.get_path(), cacheDir))
        return cacheDir;
    return null;
}
