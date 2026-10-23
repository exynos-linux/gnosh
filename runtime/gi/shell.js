// SPDX-License-Identifier: GPL-3.0-or-later
//
// The Shell namespace (GNOME Shell's C helpers) on top of GIO and GTK.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk?version=3.0';

import {Actor, P, installAccessors, makeProperties, warnOnce} from './actor.js';

// GLib >= 2.86 moved DesktopAppInfo to GioUnix.
const DesktopAppInfo = (() => {
    try {
        return imports.gi.GioUnix.DesktopAppInfo;
    } catch {
        return Gio.DesktopAppInfo;
    }
})();
import {Bin, BoxLayout, Icon, Widget} from './st.js';
import {Effect} from './clutter.js';
import {Shell as E} from './enums.js';

// --- applications ------------------------------------------------------------

export const App = GObject.registerClass({
    GTypeName: 'GnoshShellApp',
    Signals: {'windows-changed': {}},
}, class App extends GObject.Object {
    _init(appInfo) {
        this._p = {};
        super._init();
        this._info = appInfo;
    }

    get id() {
        return this._info?.get_id() ?? null;
    }

    get app_info() {
        return this._info;
    }

    get_id() {
        return this.id;
    }

    get_app_info() {
        return this._info;
    }

    get_name() {
        return this._info?.get_name() ?? this.id;
    }

    get_description() {
        return this._info?.get_description() ?? null;
    }

    get_icon() {
        return this._info?.get_icon() ?? Gio.ThemedIcon.new('application-x-executable');
    }

    get icon() {
        return this.get_icon();
    }

    create_icon_texture(size) {
        return new Icon({gicon: this.get_icon(), icon_size: size});
    }

    get_state() {
        return this.get_windows().length ? E.AppState.RUNNING : E.AppState.STOPPED;
    }

    get state() {
        return this.get_state();
    }

    get_windows() {
        const display = globalThis.global?.display;
        const id = this.id?.replace(/\.desktop$/, '');
        return display?.list_all_windows().filter(w => w.get_gtk_application_id() === id) ?? [];
    }

    get_n_windows() {
        return this.get_windows().length;
    }

    get_pids() {
        return [];
    }

    is_on_workspace() {
        return true;
    }

    is_window_backed() {
        return false;
    }

    get_busy() {
        return false;
    }

    can_open_new_window() {
        return true;
    }

    _launch(action = null) {
        if (!this._info)
            return false;
        const ctx = globalThis.global?.create_app_launch_context(0, -1) ?? null;
        try {
            if (action)
                this._info.launch_action(action, ctx);
            else
                this._info.launch([], ctx);
            return true;
        } catch (e) {
            logError(e, `gnosh: launching ${this.id}`);
            return false;
        }
    }

    activate() {
        return this._launch();
    }

    activate_full() {
        return this._launch();
    }

    activate_window() {
        return this._launch();
    }

    open_new_window() {
        return this._launch();
    }

    launch() {
        return this._launch();
    }

    launch_action(action) {
        return this._launch(action);
    }

    request_quit() {
        return false;
    }

    compare(other) {
        return this.get_name().localeCompare(other.get_name());
    }

    compare_by_name(other) {
        return this.compare(other);
    }

    get_action_group() {
        return null;
    }

    update_app_actions() {}

    get_last_user_time() {
        return 0;
    }
});

let _appSystem = null;

export const AppSystem = GObject.registerClass({
    GTypeName: 'GnoshShellAppSystem',
    Signals: {'installed-changed': {}, 'app-state-changed': {param_types: [App]}},
}, class AppSystem extends GObject.Object {
    static get_default() {
        _appSystem ??= new AppSystem();
        return _appSystem;
    }

    _init() {
        super._init();
        this._apps = new Map();
        this._monitor = Gio.AppInfoMonitor.get();
        this._monitor.connect('changed', () => {
            this._apps.clear();
            this.emit('installed-changed');
        });
    }

    lookup_app(id) {
        if (!id)
            return null;
        if (this._apps.has(id))
            return this._apps.get(id);
        let info = null;
        try {
            info = DesktopAppInfo.new(id);
        } catch {
            info = null;
        }
        if (!info)
            return null;
        const app = new App(info);
        this._apps.set(id, app);
        return app;
    }

    lookup_heuristic_basename(name) {
        return this.lookup_app(name) ?? this.lookup_app(`${name}.desktop`);
    }

    lookup_desktop_wmclass(wmclass) {
        return wmclass ? this.lookup_heuristic_basename(wmclass) : null;
    }

    lookup_startup_wmclass(wmclass) {
        return this.lookup_desktop_wmclass(wmclass);
    }

    get_installed() {
        return Gio.AppInfo.get_all().filter(i => i instanceof DesktopAppInfo);
    }

    get_running() {
        return [];
    }

    static search(terms) {
        return DesktopAppInfo.search(terms);
    }
});

let _tracker = null;

export const WindowTracker = GObject.registerClass({
    GTypeName: 'GnoshShellWindowTracker',
    Properties: makeProperties({'focus-app': P.object(App)}),
    Signals: {'startup-sequence-changed': {param_types: [GObject.TYPE_OBJECT]}, 'tracked-windows-changed': {}},
}, class WindowTracker extends GObject.Object {
    static get_default() {
        _tracker ??= new WindowTracker();
        return _tracker;
    }

    get_window_app(window) {
        const id = window?.get_gtk_application_id?.();
        return id ? AppSystem.get_default().lookup_heuristic_basename(id) : null;
    }

    get_app_from_pid() {
        return null;
    }

    get_startup_sequences() {
        return [];
    }
});
installAccessors(WindowTracker, {'focus-app': P.object(App)});

export const AppUsage = GObject.registerClass({GTypeName: 'GnoshShellAppUsage'}, class AppUsage extends GObject.Object {
    static get_default() {
        AppUsage._instance ??= new AppUsage();
        return AppUsage._instance;
    }

    get_most_used() {
        return [];
    }

    compare() {
        return 0;
    }
});

// --- widgets -----------------------------------------------------------------

export const Stack = GObject.registerClass({GTypeName: 'GnoshShellStack'}, class Stack extends Widget {
    get _gnoshDefaultKind() {
        return 'bin';
    }
});

export const SquareBin = GObject.registerClass({GTypeName: 'GnoshShellSquareBin'}, class SquareBin extends Bin {});

export const GenericContainer = GObject.registerClass({GTypeName: 'GnoshShellGenericContainer'},
    class GenericContainer extends Widget {});

export const TrayIcon = GObject.registerClass({GTypeName: 'GnoshShellTrayIcon'}, class TrayIcon extends Widget {});

export const TrayManager = GObject.registerClass({
    GTypeName: 'GnoshShellTrayManager',
    Properties: {'bg-color': GObject.ParamSpec.jsobject('bg-color', null, null, GObject.ParamFlags.READWRITE)},
    Signals: {'tray-icon-added': {param_types: [Actor]}, 'tray-icon-removed': {param_types: [Actor]}},
}, class TrayManager extends GObject.Object {
    // XEmbed tray icons need an X11 compositor; Phosh never has one.
    manage_screen() {}

    unmanage_screen() {}

    set_bg_color() {}
});

// --- effects (no-ops under GTK) ----------------------------------------------

export const BlurEffect = GObject.registerClass({
    GTypeName: 'GnoshShellBlurEffect',
    Properties: makeProperties({'radius': P.int(0), 'sigma': P.int(0), 'brightness': P.float(1), 'mode': P.int(0)}),
}, class BlurEffect extends Effect {});
installAccessors(BlurEffect, {'radius': P.int(0), 'sigma': P.int(0), 'brightness': P.float(1), 'mode': P.int(0)});

export const GLSLEffect = GObject.registerClass({GTypeName: 'GnoshShellGLSLEffect'}, class GLSLEffect extends Effect {
    add_glsl_snippet() {}

    get_uniform_location() {
        return 0;
    }

    set_uniform_float() {}

    set_uniform_matrix() {}
});

export const InvertLightnessEffect = GObject.registerClass({GTypeName: 'GnoshShellInvertLightnessEffect'},
    class InvertLightnessEffect extends Effect {});

// --- misc helpers ------------------------------------------------------------

export const Screenshot = GObject.registerClass({
    GTypeName: 'GnoshShellScreenshot',
    Signals: {'screenshot-taken': {param_types: [GObject.TYPE_OBJECT]}},
}, class Screenshot extends GObject.Object {
    // Phosh implements org.gnome.Shell.Screenshot; use it.
    screenshot(includeCursor, stream, callback) {
        const path = GLib.build_filenamev([GLib.get_user_runtime_dir(), `gnosh-shot-${Date.now()}.png`]);
        Gio.DBus.session.call('org.gnome.Shell.Screenshot', '/org/gnome/Shell/Screenshot',
            'org.gnome.Shell.Screenshot', 'Screenshot', new GLib.Variant('(bbs)', [includeCursor, false, path]),
            null, Gio.DBusCallFlags.NONE, -1, null, (conn, res) => {
                const task = {path};
                try {
                    conn.call_finish(res);
                    const [, bytes] = GLib.file_get_contents(path);
                    stream.write_all(bytes, null);
                    stream.close(null);
                    GLib.unlink(path);
                } catch (e) {
                    task.error = e;
                }
                callback?.(this, task);
            });
    }

    screenshot_finish(task) {
        if (task?.error)
            throw task.error;
        return [true, null];
    }

    screenshot_area(x, y, w, h, stream, callback) {
        this.screenshot(false, stream, callback);
    }

    screenshot_area_finish(task) {
        return this.screenshot_finish(task);
    }

    screenshot_window(...args) {
        this.screenshot(false, args[2], args[3]);
    }

    screenshot_window_finish(task) {
        return this.screenshot_finish(task);
    }
});

export function util_get_week_start() {
    try {
        const out = GLib.spawn_command_line_sync('locale first_weekday')[1];
        const n = parseInt(new TextDecoder().decode(out), 10);
        return Number.isNaN(n) ? 0 : (n + 5) % 7;
    } catch {
        return 0;
    }
}

export function util_regex_escape(str) {
    return GLib.Regex.escape_string(str, -1);
}

export function util_get_translated_folder_name(name) {
    return name;
}

export function util_translate_time_string(str) {
    return str;
}

export function util_spawn_async(workingDir, argv, envp, flags) {
    const [, pid] = GLib.spawn_async(workingDir, argv, envp, flags, null);
    return pid;
}

export function util_spawn_async_with_pipes(workingDir, argv, envp, flags) {
    const [, ...rest] = GLib.spawn_async_with_pipes(workingDir, argv, envp, flags, null);
    return rest;
}

export function util_check_cloexec_fds() {}

export function util_has_x11_display_extension() {
    return false;
}

export function util_get_uid() {
    return parseInt(GLib.getenv('UID') ?? '', 10) || new Gio.Credentials().get_unix_user();
}

export function util_sd_notify() {}

export function util_start_systemd_unit(unit, mode, cancellable, callback) {
    Gio.DBus.session.call('org.freedesktop.systemd1', '/org/freedesktop/systemd1',
        'org.freedesktop.systemd1.Manager', 'StartUnit', new GLib.Variant('(ss)', [unit, mode]),
        null, 0, -1, cancellable, callback ?? null);
}

export function util_stop_systemd_unit(unit, mode, cancellable, callback) {
    Gio.DBus.session.call('org.freedesktop.systemd1', '/org/freedesktop/systemd1',
        'org.freedesktop.systemd1.Manager', 'StopUnit', new GLib.Variant('(ss)', [unit, mode]),
        null, 0, -1, cancellable, callback ?? null);
}

export function util_touch_file_async(file, callback) {
    file.replace_contents_async(new GLib.Bytes(new Uint8Array()), null, false, 0, null, callback ?? null);
}

export function util_composite_capture_images() {
    return null;
}

export function get_file_contents_utf8_sync(path) {
    const [, bytes] = GLib.file_get_contents(path);
    return new TextDecoder().decode(bytes);
}

export const KeyringPrompt = GObject.registerClass({GTypeName: 'GnoshShellKeyringPrompt'}, class KeyringPrompt extends GObject.Object {});
export const PolkitAuthenticationAgent = GObject.registerClass({GTypeName: 'GnoshShellPolkitAuthenticationAgent'},
    class PolkitAuthenticationAgent extends GObject.Object {
        register() {
            warnOnce('polkit', 'Phosh provides the polkit agent; extension agents are ignored');
        }

        unregister() {}
    });
export const NetworkAgent = GObject.registerClass({GTypeName: 'GnoshShellNetworkAgent'}, class NetworkAgent extends GObject.Object {});
export const MountOperation = GObject.registerClass({GTypeName: 'GnoshShellMountOperation'}, class MountOperation extends Gtk.MountOperation {});
export const WindowPreview = GObject.registerClass({GTypeName: 'GnoshShellWindowPreview'}, class WindowPreview extends Widget {});
export const WindowPreviewLayout = GObject.registerClass({GTypeName: 'GnoshShellWindowPreviewLayout'}, class WindowPreviewLayout extends BoxLayout {});
export const WorkspaceBackground = GObject.registerClass({GTypeName: 'GnoshShellWorkspaceBackground'}, class WorkspaceBackground extends Widget {});
