// SPDX-License-Identifier: GPL-3.0-or-later
//
// gnosh: which extensions can run in Phosh, and user configuration
// (~/.config/gnosh/config.json).

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const gnosh = () => globalThis.__gnosh ?? {};
const CONFIG_PATH = GLib.build_filenamev([GLib.get_user_config_dir(), 'gnosh', 'config.json']);

let _compat = null;

function compatData() {
    if (_compat)
        return _compat;
    _compat = {minShellVersion: 45, maxShellVersion: 51, incompatible: {}};
    try {
        const path = GLib.build_filenamev([gnosh().dataDir ?? '', 'compat.json']);
        const [, bytes] = GLib.file_get_contents(path);
        _compat = {..._compat, ...JSON.parse(new TextDecoder().decode(bytes))};
    } catch (e) {
        console.warn(`gnosh: cannot read compat.json: ${e.message}`);
    }
    return _compat;
}

export function readConfig() {
    try {
        const [, bytes] = GLib.file_get_contents(CONFIG_PATH);
        return JSON.parse(new TextDecoder().decode(bytes));
    } catch {
        return {};
    }
}

export function isSupportedShellVersion(versions = []) {
    const {minShellVersion, maxShellVersion} = compatData();
    return versions.some(v => {
        const major = parseInt(String(v).split('.')[0], 10);
        return major >= minShellVersion && major <= maxShellVersion;
    });
}

export function outOfDateMessage(extension) {
    const {minShellVersion, maxShellVersion} = compatData();
    const listed = (extension.metadata['shell-version'] ?? []).join(', ');
    return `Built for GNOME Shell ${listed}; gnosh runs extensions made for GNOME Shell ` +
        `${minShellVersion}–${maxShellVersion}. Install a newer version of the extension.`;
}

/** A reason string if the extension cannot work in Phosh, else null. */
export function phoshIncompatibility(extension) {
    if (readConfig().allowUnsupported)
        return null;
    const reason = compatData().incompatible[extension.uuid];
    return reason ? `Not supported in Phosh: ${reason}.` : null;
}

export function phoshDisabledExtensions() {
    const list = readConfig().phoshDisabled;
    return Array.isArray(list) ? list : [];
}

let _monitor = null;

export function watchConfig(callback) {
    try {
        const file = Gio.File.new_for_path(CONFIG_PATH);
        GLib.mkdir_with_parents(GLib.path_get_dirname(CONFIG_PATH), 0o700);
        _monitor = file.monitor_file(Gio.FileMonitorFlags.NONE, null);
        _monitor.connect('changed', (m, f, other, event) => {
            if (event === Gio.FileMonitorEvent.CHANGES_DONE_HINT || event === Gio.FileMonitorEvent.CREATED ||
                event === Gio.FileMonitorEvent.DELETED)
                callback();
        });
    } catch (e) {
        console.warn(`gnosh: cannot watch ${CONFIG_PATH}: ${e.message}`);
    }
}
