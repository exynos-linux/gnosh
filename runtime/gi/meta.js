// SPDX-License-Identifier: GPL-3.0-or-later
//
// Meta (Mutter) emulation. Phosh is not a compositor, so window management
// is limited to what Phosh knows: the toplevels shown in its overview
// (app id, fullscreen, maximized). Keyboard accelerators go through Phosh's
// org.gnome.Shell GrabAccelerator API, the clipboard through GTK.

import Gdk from 'gi://Gdk?version=3.0';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk?version=3.0';

import {P, installAccessors, makeProperties, warnOnce} from './actor.js';
import {Rectangle} from './mtk.js';
import {Meta as E} from './enums.js';

export {Rectangle};

// --- laters ------------------------------------------------------------------

const _laters = new Map();
let _laterId = 0;

export function later_add(type, func) {
    const id = ++_laterId;
    const priority = type === E.LaterType.IDLE ? GLib.PRIORITY_DEFAULT_IDLE : GLib.PRIORITY_DEFAULT;
    const source = GLib.idle_add(priority, () => {
        let again = false;
        try {
            again = Boolean(func());
        } catch (e) {
            logError(e, 'gnosh: Meta.later callback');
        }
        if (!again)
            _laters.delete(id);
        return again ? GLib.SOURCE_CONTINUE : GLib.SOURCE_REMOVE;
    });
    _laters.set(id, source);
    return id;
}

export function later_remove(id) {
    const source = _laters.get(id);
    if (source) {
        GLib.source_remove(source);
        _laters.delete(id);
    }
}

export class Laters {
    add(type, func) {
        return later_add(type, func);
    }

    remove(id) {
        later_remove(id);
    }
}

// --- selection (clipboard) ---------------------------------------------------

export const SelectionSource = GObject.registerClass({
    GTypeName: 'GnoshMetaSelectionSource',
    Signals: {'activated': {}, 'deactivated': {}},
}, class SelectionSource extends GObject.Object {
    get_mimetypes() {
        return this._mimetypes ?? [];
    }

    is_active() {
        return true;
    }
});

export const SelectionSourceMemory = GObject.registerClass({
    GTypeName: 'GnoshMetaSelectionSourceMemory',
}, class SelectionSourceMemory extends SelectionSource {
    static new(mimetype, bytes) {
        const s = new SelectionSourceMemory();
        s._mimetypes = [mimetype];
        s._bytes = bytes;
        return s;
    }
});

const _clipboardFor = type => Gtk.Clipboard.get(type === E.SelectionType.SELECTION_PRIMARY
    ? Gdk.SELECTION_PRIMARY : Gdk.SELECTION_CLIPBOARD);

export const Selection = GObject.registerClass({
    GTypeName: 'GnoshMetaSelection',
    Signals: {'owner-changed': {param_types: [GObject.TYPE_INT, GObject.TYPE_OBJECT]}},
}, class Selection extends GObject.Object {
    _init() {
        super._init();
        this._sources = {};
        for (const type of [E.SelectionType.SELECTION_PRIMARY, E.SelectionType.SELECTION_CLIPBOARD]) {
            // GTK on Wayland only sees selection changes while Phosh has
            // keyboard focus (e.g. while the quick settings drawer is open).
            _clipboardFor(type).connect('owner-change', () => this._gnoshOwnerChanged(type));
        }
    }

    _gnoshOwnerChanged(type, source = null) {
        this._sources[type] = source ?? new SelectionSource();
        this.emit('owner-changed', type, this._sources[type]);
    }

    get_mimetypes(type) {
        const [ok, atoms] = _clipboardFor(type).wait_for_targets();
        if (!ok)
            return [];
        return atoms.map(a => a.name());
    }

    set_owner(type, source) {
        if (source instanceof SelectionSourceMemory) {
            const mime = source._mimetypes[0] ?? '';
            const data = source._bytes?.toArray ? source._bytes.toArray() : source._bytes;
            if (mime.startsWith('text/') || mime === 'UTF8_STRING' || mime === 'STRING') {
                _clipboardFor(type).set_text(new TextDecoder().decode(data), -1);
            } else if (mime.startsWith('image/')) {
                try {
                    const loader = imports.gi.GdkPixbuf.PixbufLoader.new_with_mime_type(mime);
                    loader.write(data);
                    loader.close();
                    _clipboardFor(type).set_image(loader.get_pixbuf());
                } catch (e) {
                    warnOnce(`selection-${mime}`, `cannot put ${mime} on the clipboard: ${e.message}`);
                }
            } else {
                warnOnce(`selection-${mime}`, `clipboard type ${mime} is not supported`);
            }
        }
        this._gnoshOwnerChanged(type, source);
    }

    unset_owner(type) {
        _clipboardFor(type).clear();
    }

    transfer_async(type, mimetype, size, output, cancellable, callback) {
        const clipboard = _clipboardFor(type);
        const done = bytes => {
            const task = {bytes};
            try {
                if (bytes?.length)
                    output.write_all(bytes, null);
                output.close(null);
            } catch (e) {
                task.error = e;
            }
            callback?.(this, task);
        };
        if (mimetype.startsWith('text/') || mimetype === 'UTF8_STRING' || mimetype === 'STRING') {
            clipboard.request_text((cb, text) => done(text ? new TextEncoder().encode(text) : new Uint8Array()));
        } else {
            clipboard.request_contents(Gdk.Atom.intern(mimetype, false), (cb, data) =>
                done(data?.get_data() ?? new Uint8Array()));
        }
    }

    transfer_finish(task) {
        if (task?.error)
            throw task.error;
        return true;
    }
});

// --- windows -----------------------------------------------------------------

/**
 * A toplevel as Phosh's overview shows it. Backed by a PhoshActivity widget.
 */
export const Window = GObject.registerClass({
    GTypeName: 'GnoshMetaWindow',
    Properties: makeProperties({
        'title': P.string(null), 'wm-class': P.string(null), 'gtk-application-id': P.string(null),
        'fullscreen': P.bool(false), 'maximized-horizontally': P.bool(false),
        'maximized-vertically': P.bool(false), 'appears-focused': P.bool(false),
        'minimized': P.bool(false), 'urgent': P.bool(false), 'demands-attention': P.bool(false),
        'skip-taskbar': P.bool(false), 'above': P.bool(false), 'window-type': P.int(E.WindowType.NORMAL),
        'on-all-workspaces': P.bool(false), 'resizeable': P.bool(true), 'mapped': P.bool(true),
        'decorated': P.bool(true), 'icon': P.js(null), 'mini-icon': P.js(null),
    }),
    Signals: {
        'unmanaged': {}, 'unmanaging': {}, 'focus': {}, 'raised': {}, 'workspace-changed': {},
        'position-changed': {}, 'size-changed': {}, 'shown': {}, 'icon-changed': {},
    },
}, class Window extends GObject.Object {
    _init(activity) {
        this._p = {};
        super._init();
        this._gnoshConstructed = true;
        this._activity = activity;
        this._stableId = ++Window._serial;
        if (activity)
            this._gnoshSync();
    }

    static _serial = 0;

    _gnoshSync() {
        const a = this._activity;
        const appId = a.app_id ?? null;
        const appInfo = a.app_info ?? null;
        this.title = appInfo?.get_display_name?.() ?? appId;
        this.wm_class = appId;
        this.gtk_application_id = appId;
        this.fullscreen = Boolean(a.fullscreen);
        this.maximized_horizontally = this.maximized_vertically = Boolean(a.maximized);
    }

    get_title() {
        return this.title;
    }

    get_wm_class() {
        return this.wm_class;
    }

    get_wm_class_instance() {
        return this.wm_class;
    }

    get_gtk_application_id() {
        return this.gtk_application_id;
    }

    get_sandboxed_app_id() {
        return this.gtk_application_id;
    }

    get_id() {
        return this._stableId;
    }

    get_stable_sequence() {
        return this._stableId;
    }

    get_pid() {
        return -1;
    }

    get_client_pid() {
        return -1;
    }

    is_fullscreen() {
        return this.fullscreen;
    }

    get_maximized() {
        return (this.maximized_horizontally ? E.MaximizeFlags.HORIZONTAL : 0) |
            (this.maximized_vertically ? E.MaximizeFlags.VERTICAL : 0);
    }

    is_maximized() {
        return this.maximized_horizontally && this.maximized_vertically;
    }

    has_focus() {
        return this.appears_focused;
    }

    get_window_type() {
        return E.WindowType.NORMAL;
    }

    is_skip_taskbar() {
        return false;
    }

    is_on_all_workspaces() {
        return true;
    }

    is_hidden() {
        return false;
    }

    is_attached_dialog() {
        return false;
    }

    is_override_redirect() {
        return false;
    }

    get_monitor() {
        return 0;
    }

    get_workspace() {
        return globalThis.global?.workspace_manager?.get_active_workspace() ?? null;
    }

    located_on_workspace() {
        return true;
    }

    get_frame_rect() {
        const g = Gdk.Display.get_default()?.get_primary_monitor()?.get_geometry();
        return new Rectangle({x: 0, y: 0, width: g?.width ?? 0, height: g?.height ?? 0});
    }

    get_buffer_rect() {
        return this.get_frame_rect();
    }

    get_work_area_current_monitor() {
        return this.get_frame_rect();
    }

    get_compositor_private() {
        return null;
    }

    get_transient_for() {
        return null;
    }

    foreach_transient() {}

    get_user_time() {
        return 0;
    }

    get_description() {
        return `${this.wm_class ?? '?'} (gnosh)`;
    }

    activate() {
        warnOnce('win-activate', 'Meta.Window.activate() is not available in Phosh');
    }

    activate_with_workspace() {
        this.activate();
    }

    delete() {
        warnOnce('win-delete', 'Meta.Window.delete() is not available in Phosh');
    }

    kill() {
        this.delete();
    }

    minimize() {}

    unminimize() {}

    maximize() {}

    unmaximize() {}

    make_fullscreen() {}

    unmake_fullscreen() {}

    change_workspace_by_index() {}

    change_workspace() {}

    move_frame() {}

    move_resize_frame() {}

    raise() {}

    lower() {}

    focus() {}

    make_above() {}

    unmake_above() {}

    stick() {}

    unstick() {}

    can_close() {
        return false;
    }

    can_maximize() {
        return false;
    }

    can_minimize() {
        return false;
    }

    allows_move() {
        return false;
    }

    allows_resize() {
        return false;
    }
});
installAccessors(Window, Object.fromEntries(Object.entries({
    'title': P.string(null), 'wm-class': P.string(null), 'gtk-application-id': P.string(null),
    'fullscreen': P.bool(false), 'maximized-horizontally': P.bool(false),
    'maximized-vertically': P.bool(false), 'appears-focused': P.bool(false),
    'minimized': P.bool(false), 'urgent': P.bool(false), 'demands-attention': P.bool(false),
    'skip-taskbar': P.bool(false), 'above': P.bool(false), 'window-type': P.int(E.WindowType.NORMAL),
    'on-all-workspaces': P.bool(false), 'resizeable': P.bool(true), 'mapped': P.bool(true),
    'decorated': P.bool(true), 'icon': P.js(null), 'mini-icon': P.js(null),
})));

export const WindowActor = GObject.registerClass({GTypeName: 'GnoshMetaWindowActor'}, class WindowActor extends GObject.Object {
    get_meta_window() {
        return this._window ?? null;
    }
});

// --- workspaces (Phosh has exactly one) ----------------------------------------

export const Workspace = GObject.registerClass({
    GTypeName: 'GnoshMetaWorkspace',
    Properties: makeProperties({'active': P.bool(true), 'n-windows': P.uint(0), 'workspace-index': P.uint(0)}),
    Signals: {'window-added': {param_types: [Window]}, 'window-removed': {param_types: [Window]}},
}, class Workspace extends GObject.Object {
    _init(manager) {
        this._p = {};
        super._init();
        this._manager = manager;
    }

    index() {
        return 0;
    }

    list_windows() {
        return globalThis.global?.display?.list_all_windows() ?? [];
    }

    get_neighbor() {
        return this;
    }

    activate() {}

    activate_with_focus() {}

    get_work_area_for_monitor(i) {
        return globalThis.global?.display?.get_monitor_geometry(i) ?? new Rectangle();
    }

    get_work_area_all_monitors() {
        return this.get_work_area_for_monitor(0);
    }

    get_display() {
        return globalThis.global?.display ?? null;
    }

    set_builtin_struts() {}
});
installAccessors(Workspace, {'active': P.bool(true), 'n-windows': P.uint(0), 'workspace-index': P.uint(0)});

export const WorkspaceManager = GObject.registerClass({
    GTypeName: 'GnoshMetaWorkspaceManager',
    Properties: makeProperties({'n-workspaces': P.int(1), 'layout-columns': P.int(1), 'layout-rows': P.int(1)}),
    Signals: {
        'workspace-added': {param_types: [GObject.TYPE_INT]},
        'workspace-removed': {param_types: [GObject.TYPE_INT]},
        'workspace-switched': {param_types: [GObject.TYPE_INT, GObject.TYPE_INT, GObject.TYPE_INT]},
        'active-workspace-changed': {},
        'showing-desktop-changed': {},
        'workspaces-reordered': {},
    },
}, class WorkspaceManager extends GObject.Object {
    _init() {
        this._p = {};
        super._init();
        this._workspace = new Workspace(this);
    }

    get_n_workspaces() {
        return 1;
    }

    get_active_workspace() {
        return this._workspace;
    }

    get_active_workspace_index() {
        return 0;
    }

    get_workspace_by_index(i) {
        return i === 0 ? this._workspace : null;
    }

    get_workspaces() {
        return [this._workspace];
    }

    append_new_workspace() {
        return this._workspace;
    }

    remove_workspace() {}

    reorder_workspace() {}

    override_workspace_layout() {}
});
installAccessors(WorkspaceManager, {'n-workspaces': P.int(1), 'layout-columns': P.int(1), 'layout-rows': P.int(1)});

// --- display -----------------------------------------------------------------

const ACCEL_FLAGS = 0;

export const SoundPlayer = GObject.registerClass({GTypeName: 'GnoshMetaSoundPlayer'}, class SoundPlayer extends GObject.Object {
    play_from_theme(name) {
        try {
            const GSound = imports.gi.GSound;
            this._ctx ??= new GSound.Context();
            this._ctx.init(null);
            this._ctx.play_simple({[GSound.ATTR_EVENT_ID]: name}, null);
        } catch {
            Gdk.Display.get_default()?.beep();
        }
    }

    play_from_file() {}
});

export const Display = GObject.registerClass({
    GTypeName: 'GnoshMetaDisplay',
    Properties: makeProperties({'focus-window': P.object(Window), 'compositor-modifiers': P.int(0)}),
    Signals: {
        'window-created': {param_types: [Window]},
        'in-fullscreen-changed': {},
        'accelerator-activated': {param_types: [GObject.TYPE_UINT, GObject.TYPE_OBJECT, GObject.TYPE_UINT]},
        'modifiers-accelerator-activated': {return_type: GObject.TYPE_BOOLEAN},
        'restacked': {},
        'workareas-changed': {},
        'grab-op-begin': {param_types: [Window, GObject.TYPE_INT]},
        'grab-op-end': {param_types: [Window, GObject.TYPE_INT]},
        'overlay-key': {},
        'showing-desktop-changed': {},
        'window-demands-attention': {param_types: [Window]},
        'window-marked-urgent': {param_types: [Window]},
        'window-entered-monitor': {param_types: [GObject.TYPE_INT, Window]},
        'window-left-monitor': {param_types: [GObject.TYPE_INT, Window]},
        'cursor-updated': {},
        'closing': {},
        'x11-display-setup': {},
        'x11-display-opened': {},
        'x11-display-closing': {},
        'pad-mode-switch': {},
        'show-osd': {},
    },
}, class Display extends GObject.Object {
    _init() {
        this._p = {};
        super._init();
        this._gnoshConstructed = true;
        this._selection = null;
        this._windows = new Map();
        this._accelerators = new Map();
        this._acceleratorSignal = 0;
        this._inFullscreen = false;
    }

    get_selection() {
        this._selection ??= new Selection();
        return this._selection;
    }

    get_sound_player() {
        this._soundPlayer ??= new SoundPlayer();
        return this._soundPlayer;
    }

    get_workspace_manager() {
        return globalThis.global?.workspace_manager ?? null;
    }

    get_context() {
        return globalThis.global?.context ?? null;
    }

    get_compositor() {
        return globalThis.global?.compositor ?? null;
    }

    get_x11_display() {
        return null;
    }

    _monitors() {
        const d = Gdk.Display.get_default();
        const n = d?.get_n_monitors() ?? 0;
        return Array.from({length: n}, (_, i) => d.get_monitor(i));
    }

    get_n_monitors() {
        return Math.max(1, this._monitors().length);
    }

    get_primary_monitor() {
        const d = Gdk.Display.get_default();
        const primary = d?.get_primary_monitor();
        return Math.max(0, this._monitors().indexOf(primary));
    }

    get_current_monitor() {
        return this.get_primary_monitor();
    }

    get_monitor_geometry(i) {
        const m = this._monitors()[i] ?? this._monitors()[0];
        const g = m?.get_geometry();
        return new Rectangle({x: g?.x ?? 0, y: g?.y ?? 0, width: g?.width ?? 360, height: g?.height ?? 720});
    }

    get_monitor_scale(i) {
        return this._monitors()[i]?.get_scale_factor() ?? 1;
    }

    get_monitor_index_for_rect() {
        return 0;
    }

    get_monitor_neighbor_index() {
        return -1;
    }

    get_monitor_in_fullscreen() {
        return this._inFullscreen;
    }

    get_focus_window() {
        return this.focus_window;
    }

    focus_default_window() {}

    get_tab_list() {
        return this.list_all_windows();
    }

    get_tab_current() {
        return null;
    }

    get_tab_next() {
        return null;
    }

    list_all_windows() {
        return [...this._windows.values()];
    }

    sort_windows_by_stacking(windows) {
        return windows;
    }

    get_current_time() {
        return Gtk.get_current_event_time();
    }

    get_current_time_roundtrip() {
        return Gtk.get_current_event_time() || (GLib.get_monotonic_time() / 1000 | 0);
    }

    get_last_user_time() {
        return this.get_current_time();
    }

    get_grab_op() {
        return E.GrabOp.NONE;
    }

    get_keybinding_action() {
        return 0;
    }

    is_pointer_emulating_sequence() {
        return false;
    }

    set_cursor() {}

    request_pad_osd() {}

    get_pad_button_label() {
        return null;
    }

    clear_mouse_mode() {}

    /** Update the window list from PhoshActivity widgets (see bridge). */
    _gnoshSetActivities(activities) {
        const seen = new Set();
        for (const activity of activities) {
            seen.add(activity);
            let win = this._windows.get(activity);
            if (!win) {
                win = new Window(activity);
                this._windows.set(activity, win);
                this.emit('window-created', win);
            } else {
                win._gnoshSync();
            }
        }
        for (const [activity, win] of this._windows) {
            if (!seen.has(activity)) {
                this._windows.delete(activity);
                win.emit('unmanaging');
                win.emit('unmanaged');
            }
        }
        const fullscreen = this.list_all_windows().some(w => w.fullscreen);
        if (fullscreen !== this._inFullscreen) {
            this._inFullscreen = fullscreen;
            this.emit('in-fullscreen-changed');
        }
    }

    // --- accelerators via Phosh's org.gnome.Shell interface ---

    _gnoshEnsureAcceleratorSignal() {
        if (this._acceleratorSignal)
            return;
        this._acceleratorSignal = Gio.DBus.session.signal_subscribe(null, 'org.gnome.Shell',
            'AcceleratorActivated', '/org/gnome/Shell', null, Gio.DBusSignalFlags.NONE,
            (conn, sender, path, iface, signal, params) => {
                const [action] = params.deepUnpack();
                if (this._accelerators.has(action))
                    this.emit('accelerator-activated', action, null, this.get_current_time());
            });
    }

    /**
     * Mutter's grab_accelerator is synchronous; Phosh answers over D-Bus in
     * the same process, so the id is allocated locally and mapped to Phosh's
     * action id when the reply arrives.
     */
    grab_accelerator(accelerator, flags = ACCEL_FLAGS) {
        if (!accelerator)
            return 0;
        this._gnoshEnsureAcceleratorSignal();
        const placeholder = 0x40000000 + (++Display._accelSerial);
        Gio.DBus.session.call('org.gnome.Shell', '/org/gnome/Shell', 'org.gnome.Shell', 'GrabAccelerator',
            new GLib.Variant('(suu)', [accelerator, 0xff, flags]), new GLib.VariantType('(u)'),
            Gio.DBusCallFlags.NONE, -1, null, (conn, res) => {
                try {
                    const [action] = conn.call_finish(res).deepUnpack();
                    if (action) {
                        this._accelerators.set(action, placeholder);
                        this._accelAlias ??= new Map();
                        this._accelAlias.set(placeholder, action);
                    }
                } catch (e) {
                    warnOnce(`grab-${accelerator}`, `cannot grab ${accelerator}: ${e.message}`);
                }
            });
        return placeholder;
    }

    ungrab_accelerator(id) {
        const action = this._accelAlias?.get(id);
        if (!action)
            return false;
        this._accelAlias.delete(id);
        this._accelerators.delete(action);
        Gio.DBus.session.call('org.gnome.Shell', '/org/gnome/Shell', 'org.gnome.Shell', 'UngrabAccelerator',
            new GLib.Variant('(u)', [action]), null, Gio.DBusCallFlags.NONE, -1, null, null);
        return true;
    }

    emit(signal, ...args) {
        // Report our own ids, not Phosh's, to accelerator-activated handlers.
        if (signal === 'accelerator-activated' && this._accelerators.has(args[0]))
            args[0] = this._accelerators.get(args[0]);
        return super.emit(signal, ...args);
    }

    add_keybinding(name, settings, flags, handler) {
        const accels = settings?.get_strv?.(name) ?? [];
        const ids = accels.map(a => this.grab_accelerator(a, flags));
        if (!ids.length)
            return 0;
        const sig = this.connect('accelerator-activated', (d, id) => {
            if (ids.includes(id))
                handler(this, null, null);
        });
        this._keybindings ??= new Map();
        this._keybindings.set(name, {ids, sig});
        return ids[0];
    }

    remove_keybinding(name) {
        const kb = this._keybindings?.get(name);
        if (!kb)
            return false;
        kb.ids.forEach(id => this.ungrab_accelerator(id));
        this.disconnect(kb.sig);
        this._keybindings.delete(name);
        return true;
    }
});
Display._accelSerial = 0;
installAccessors(Display, {'focus-window': P.object(Window), 'compositor-modifiers': P.int(0)});

// --- backend and friends -----------------------------------------------------

export const IdleMonitor = GObject.registerClass({GTypeName: 'GnoshMetaIdleMonitor'}, class IdleMonitor extends GObject.Object {
    _call(method, params, type, cb) {
        Gio.DBus.session.call('org.gnome.Mutter.IdleMonitor', '/org/gnome/Mutter/IdleMonitor/Core',
            'org.gnome.Mutter.IdleMonitor', method, params, type ? new GLib.VariantType(type) : null,
            Gio.DBusCallFlags.NONE, -1, null, (conn, res) => {
                try {
                    cb?.(conn.call_finish(res).deepUnpack());
                } catch (e) {
                    warnOnce(`idle-${method}`, `idle monitor ${method}: ${e.message}`);
                }
            });
    }

    _ensureSignal() {
        if (this._sig)
            return;
        this._watches = new Map();
        this._sig = Gio.DBus.session.signal_subscribe(null, 'org.gnome.Mutter.IdleMonitor', 'WatchFired',
            '/org/gnome/Mutter/IdleMonitor/Core', null, 0, (c, s, p, i, n, params) => {
                const [id] = params.deepUnpack();
                const w = this._watches.get(id);
                if (w) {
                    w.cb(this, w.local);
                    if (w.once)
                        this._watches.delete(id);
                }
            });
    }

    add_idle_watch(interval, callback) {
        this._ensureSignal();
        const local = ++IdleMonitor._serial;
        this._call('AddIdleWatch', new GLib.Variant('(t)', [interval]), '(u)', ([id]) =>
            this._watches.set(id, {cb: callback, local}));
        return local;
    }

    add_user_active_watch(callback) {
        this._ensureSignal();
        const local = ++IdleMonitor._serial;
        this._call('AddUserActiveWatch', null, '(u)', ([id]) =>
            this._watches.set(id, {cb: callback, local, once: true}));
        return local;
    }

    remove_watch(local) {
        for (const [id, w] of this._watches ?? []) {
            if (w.local === local) {
                this._call('RemoveWatch', new GLib.Variant('(u)', [id]), null);
                this._watches.delete(id);
            }
        }
    }

    get_idletime() {
        return 0;
    }
});
IdleMonitor._serial = 0;

export const MonitorManager = GObject.registerClass({
    GTypeName: 'GnoshMetaMonitorManager',
    Signals: {'monitors-changed': {}, 'monitors-changed-internal': {}, 'power-save-mode-changed': {}, 'confirm-display-change': {}},
}, class MonitorManager extends GObject.Object {
    static get() {
        return get_backend().get_monitor_manager();
    }

    get_monitor_for_connector() {
        return 0;
    }

    get_is_builtin_display_on() {
        return true;
    }

    get_display_configuration_timeout() {
        return 20;
    }

    can_switch_config() {
        return false;
    }

    get_switch_config() {
        return 0;
    }

    switch_config() {}

    get_panel_orientation_managed() {
        return false;
    }
});

export const CursorTracker = GObject.registerClass({
    GTypeName: 'GnoshMetaCursorTracker',
    Signals: {'cursor-changed': {}, 'position-invalidated': {}, 'visibility-changed': {}},
}, class CursorTracker extends GObject.Object {
    static get_for_display() {
        CursorTracker._instance ??= new CursorTracker();
        return CursorTracker._instance;
    }

    get_pointer() {
        return [{x: 0, y: 0}, 0];
    }

    get_pointer_visible() {
        return false;
    }

    set_pointer_visible() {}

    get_hot() {
        return [0, 0];
    }

    get_sprite() {
        return null;
    }

    get_scale() {
        return 1;
    }

    track_position() {}

    untrack_position() {}
});

export const RemoteAccessController = GObject.registerClass({
    GTypeName: 'GnoshMetaRemoteAccessController',
    Signals: {'new-handle': {param_types: [GObject.TYPE_OBJECT]}},
}, class RemoteAccessController extends GObject.Object {
    inhibit_remote_access() {}

    uninhibit_remote_access() {}
});

let _backend = null;

export const Backend = GObject.registerClass({
    GTypeName: 'GnoshMetaBackend',
    Signals: {'keymap-changed': {}, 'keymap-layout-group-changed': {param_types: [GObject.TYPE_UINT]},
        'last-device-changed': {param_types: [GObject.TYPE_OBJECT]}, 'lid-is-closed-changed': {param_types: [GObject.TYPE_BOOLEAN]},
        'gpu-added': {param_types: [GObject.TYPE_OBJECT]}, 'prepare-shutdown': {}},
}, class Backend extends GObject.Object {
    get_monitor_manager() {
        this._mm ??= new MonitorManager();
        return this._mm;
    }

    get_core_idle_monitor() {
        this._idle ??= new IdleMonitor();
        return this._idle;
    }

    get_cursor_tracker() {
        return CursorTracker.get_for_display();
    }

    get_remote_access_controller() {
        this._rac ??= new RemoteAccessController();
        return this._rac;
    }

    get_settings() {
        return null;
    }

    get_dnd() {
        return null;
    }

    get_stage() {
        return globalThis.global?.stage ?? null;
    }

    get_default_seat() {
        return imports.gi.Clutter?.get_default_backend?.().get_default_seat() ?? null;
    }

    is_rendering_hardware_accelerated() {
        return true;
    }

    is_headless() {
        return false;
    }

    get_capabilities() {
        return 0;
    }

    lock_layout_group() {}

    set_keymap() {}

    get_keymap_layout_group() {
        return 0;
    }

    freeze_keyboard() {}

    unfreeze_keyboard() {}

    set_numlock() {}

    get_context() {
        return globalThis.global?.context ?? null;
    }
});

export function get_backend() {
    _backend ??= new Backend();
    return _backend;
}

export function is_wayland_compositor() {
    return true;
}

export function is_restart() {
    return false;
}

export function restart() {}

export function exit() {}

export function get_debug_paint_flags() {
    return 0;
}

export function add_debug_paint_flag() {}

export function remove_debug_paint_flag() {}

export function keybindings_set_custom_handler() {
    return false;
}

export function prefs_get_button_layout() {
    return {left_buttons: [], right_buttons: []};
}

export function prefs_get_workspaces_only_on_primary() {
    return true;
}

export function prefs_get_dynamic_workspaces() {
    return false;
}

export function prefs_get_num_workspaces() {
    return 1;
}

export function get_window_actors() {
    return [];
}

export function get_window_group_for_display() {
    return null;
}

export function get_top_window_group_for_display() {
    return null;
}

export function disable_unredirect_for_display() {}

export function enable_unredirect_for_display() {}

export function external_binding_name_for_action(action) {
    return `external-grab-${action}`;
}

function stubClass(name, methods = []) {
    const klass = GObject.registerClass({GTypeName: `GnoshMeta${name}`}, class extends GObject.Object {
        destroy() {}
    });
    for (const m of methods)
        klass.prototype[m] = () => null;
    return klass;
}

export const Background = stubClass('Background', ['set_file', 'set_color', 'set_gradient']);
export const BackgroundActor = stubClass('BackgroundActor');
export const BackgroundContent = stubClass('BackgroundContent');
export const BackgroundGroup = stubClass('BackgroundGroup');
export const BackgroundImageCache = stubClass('BackgroundImageCache', ['load', 'purge']);
export const Barrier = stubClass('Barrier', ['release']);
export const Compositor = stubClass('Compositor');
export const Context = stubClass('Context', ['get_backend', 'get_display']);
export const Dnd = stubClass('Dnd');
export const KeyBinding = stubClass('KeyBinding', ['get_name', 'get_modifiers', 'get_mask']);
export const ShapedTexture = stubClass('ShapedTexture');
export const WaylandClient = stubClass('WaylandClient');
export const X11Display = stubClass('X11Display');
