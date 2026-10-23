// SPDX-License-Identifier: GPL-3.0-or-later
//
// Makes `gi://St`, `gi://Clutter`, `gi://Meta`, `gi://Shell`, `gi://Mtk` and
// `gi://Cogl` resolve to gnosh's implementations.
//
// GJS resolves gi:// imports through GObject-Introspection. gnosh writes
// tiny empty typelibs for those namespaces, puts them first in the
// typelib search path, and then fills the (empty) namespace objects with
// its own classes, functions and the real enum values.

import GLib from 'gi://GLib';
import System from 'system';

import {TYPELIBS, VERSION} from './typelibs.js';
import * as Enums from './enums.js';

export const NAMESPACES = Object.keys(TYPELIBS);

async function prependSearchPath(dir) {
    // GJS >= 1.80 uses girepository-2.0 (GIRepository-3.0 typelib).
    if (System.version >= 17902) {
        const {default: GIRepository} = await import('gi://GIRepository?version=3.0');
        GIRepository.Repository.dup_default().prepend_search_path(dir);
    } else {
        const {default: GIRepository} = await import('gi://GIRepository?version=2.0');
        GIRepository.Repository.prepend_search_path(dir);
    }
}

/** Write the typelibs and make GI find them first. */
export async function installTypelibs(runtimeDir) {
    const dir = GLib.build_filenamev([runtimeDir, 'typelib']);
    GLib.mkdir_with_parents(dir, 0o700);
    for (const [ns, b64] of Object.entries(TYPELIBS)) {
        const path = GLib.build_filenamev([dir, `${ns}-${VERSION}.typelib`]);
        GLib.file_set_contents(path, GLib.base64_decode(b64));
    }
    for (const ns of NAMESPACES)
        imports.gi.versions[ns] = VERSION;
    await prependSearchPath(dir);
    return dir;
}

/** Fill the namespace objects with gnosh's implementation. */
export async function populateNamespaces() {
    const modules = {
        Clutter: await import('./clutter.js'),
        Cogl: await import('./cogl.js'),
        Meta: await import('./meta.js'),
        Mtk: await import('./mtk.js'),
        Shell: await import('./shell.js'),
        St: await import('./st.js'),
    };
    for (const ns of NAMESPACES) {
        const target = imports.gi[ns];
        if (target.__version__ !== VERSION)
            throw new Error(`gnosh: ${ns} resolved to version ${target.__version__}, expected gnosh's ${VERSION}`);
        // Enums and constants first, implementation second.
        for (const [key, value] of Object.entries(Enums[ns] ?? {})) {
            const frozen = value && typeof value === 'object' ? Object.freeze({...value}) : value;
            Object.defineProperty(target, key, {value: frozen, enumerable: true, configurable: true, writable: true});
        }
        for (const [key, value] of Object.entries(modules[ns])) {
            Object.defineProperty(target, key, {value, enumerable: true, configurable: true, writable: true});
        }
    }
    // Meta.Rectangle is Mtk.Rectangle since GNOME 45.
    imports.gi.Meta.Rectangle = imports.gi.Mtk.Rectangle;
    return modules;
}
