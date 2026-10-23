// SPDX-License-Identifier: GPL-3.0-or-later
//
// The JS environment GNOME Shell sets up before loading extensions
// (based on GNOME Shell's js/ui/environment.js, GPL-2.0-or-later).

import Cairo from 'cairo';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import * as Gettext from 'gettext';

export async function setup() {
    const Clutter = (await import('gi://Clutter')).default;
    const St = (await import('gi://St')).default;
    const Shell = (await import('gi://Shell')).default;
    const SignalTracker = await import('resource:///org/gnome/shell/misc/signalTracker.js');

    for (const [proto, name] of [
        [Gio.DataInputStream.prototype, 'fill_async'],
        [Gio.DataInputStream.prototype, 'read_line_async'],
        [Gio.DBus.prototype ?? null, null],
        [Gio.DBusConnection.prototype, 'call'],
        [Gio.DBusProxy.prototype, 'init_async'],
        [Gio.DBusProxy.prototype, 'call_with_unix_fd_list'],
        [Gio.File.prototype, 'query_info_async'],
    ]) {
        if (proto && name) {
            try {
                Gio._promisify(proto, name);
            } catch (e) {
                console.debug(`gnosh: cannot promisify ${name}: ${e.message}`);
            }
        }
    }

    globalThis._ ??= Gettext.gettext;
    globalThis.C_ ??= Gettext.pgettext;
    globalThis.ngettext ??= Gettext.ngettext;
    globalThis.N_ ??= s => s;

    // Two extensions may define classes with the same name.
    GObject.gtypeNameBasedOnJSPath = true;

    GObject.Object.prototype.connectObject = function (...args) {
        SignalTracker.connectObject(this, ...args);
    };
    GObject.Object.prototype.connect_object = function (...args) {
        SignalTracker.connectObject(this, ...args);
    };
    GObject.Object.prototype.disconnectObject = function (...args) {
        SignalTracker.disconnectObject(this, ...args);
    };
    GObject.Object.prototype.disconnect_object = function (...args) {
        SignalTracker.disconnectObject(this, ...args);
    };
    SignalTracker.registerDestroyableType(Clutter.Actor);

    Cairo.Context.prototype.setSourceColor = function (color) {
        const {red, green, blue, alpha} = color;
        const rgb = [red, green, blue].map(v => v / 255.0);
        if (alpha !== 0xff)
            this.setSourceRGBA(...rgb, alpha / 255.0);
        else
            this.setSourceRGB(...rgb);
    };

    const patchLayoutClass = (layoutClass, styleProps) => {
        layoutClass.prototype.hookup_style = function (container) {
            container.connect('style-changed', () => {
                const node = container.get_theme_node();
                for (const prop in styleProps) {
                    const [found, length] = node.lookup_length(styleProps[prop], false);
                    if (found)
                        this[prop] = length;
                }
            });
        };
    };
    patchLayoutClass(Clutter.GridLayout, {row_spacing: 'spacing-rows', column_spacing: 'spacing-columns'});
    patchLayoutClass(Clutter.BoxLayout, {spacing: 'spacing'});

    // Animations are not rendered; properties jump to their final values
    // and completion callbacks run from the main loop, as Clutter does
    // when animations are disabled.
    const easeActor = (actor, params) => {
        params = {...params};
        const onComplete = params.onComplete;
        const onStopped = params.onStopped;
        for (const key of ['onComplete', 'onStopped', 'duration', 'delay', 'mode', 'repeatCount',
            'autoReverse', 'animationRequired', 'progress_mode'])
            delete params[key];
        for (const [key, value] of Object.entries(params)) {
            if (key.startsWith('@')) {
                // '@effects.name.property' / '@actions.name.property'
                const [kind, name, prop] = key.slice(1).split('.');
                const meta = kind === 'effects' ? actor.get_effect?.(name) : actor.get_action?.(name);
                if (meta && prop)
                    meta[prop.replace(/-/g, '_')] = value;
                continue;
            }
            try {
                actor[key.replace(/-/g, '_')] = value;
            } catch (e) {
                console.debug(`gnosh: ease ${key}: ${e.message}`);
            }
        }
        return new Promise(resolve => {
            GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                try {
                    onComplete?.();
                    onStopped?.(true);
                } catch (e) {
                    logError(e, 'gnosh: ease callback');
                }
                resolve();
                return GLib.SOURCE_REMOVE;
            });
        });
    };

    Clutter.Actor.prototype.ease = function (props) {
        easeActor(this, props).catch(e => logError(e));
    };
    Clutter.Actor.prototype.ease_property = function (propName, target, params = {}) {
        easeActor(this, {...params, [propName]: target}).catch(e => logError(e));
    };
    Clutter.Actor.prototype.easeAsync = async function (props) {
        await easeActor(this, props);
    };
    Clutter.Actor.prototype.ease_property_async = async function (propName, target, params = {}) {
        await easeActor(this, {...params, [propName]: target});
    };
    St.Adjustment.prototype.ease = function (target, params = {}) {
        easeActor(this, {...params, value: target}).catch(e => logError(e));
    };
    St.Adjustment.prototype.easeAsync = async function (target, params = {}) {
        await easeActor(this, {...params, value: target});
    };

    Clutter.Actor.prototype[Symbol.iterator] = function* () {
        for (let c = this.get_first_child(); c; c = c.get_next_sibling())
            yield c;
    };

    Gio.File.prototype.touch_async = function (callback) {
        Shell.util_touch_file_async(this, callback);
    };
    Gio.File.prototype.touch_finish = function () {
        return true;
    };

    String.prototype.format = imports.format.format;

    // A few extensions use GTK 4 API from shell code (GNOME Shell can load
    // GTK 4 for icon lookups); gnosh runs inside GTK 3 Phosh.
    const Gtk = (await import('gi://Gtk?version=3.0')).default;
    Gtk.IconTheme.prototype.set_theme_name ??= function (name) {
        this.set_custom_theme(name);
    };
    Gtk.IconTheme.prototype.get_theme_name ??= function () {
        return Gtk.Settings.get_default()?.gtk_icon_theme_name ?? null;
    };
    Gtk.IconTheme.prototype.add_search_path ??= function (path) {
        this.append_search_path(path);
    };

    Math.clamp ??= function (x, lower, upper) {
        return Math.min(Math.max(x, lower), upper);
    };

    const slowdown = parseFloat(GLib.getenv('GNOME_SHELL_SLOWDOWN_FACTOR') ?? '');
    if (slowdown > 0)
        St.Settings.get().slow_down_factor = slowdown;
}
