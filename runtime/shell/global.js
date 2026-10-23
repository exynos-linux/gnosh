// SPDX-License-Identifier: GPL-3.0-or-later
//
// `global`, GNOME Shell's Shell.Global singleton, as far as it makes sense
// inside Phosh.

import Gdk from 'gi://Gdk?version=3.0';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk?version=3.0';

export async function createGlobal() {
    const Clutter = (await import('gi://Clutter')).default;
    const Meta = (await import('gi://Meta')).default;
    const St = (await import('gi://St')).default;

    const userdatadir = GLib.build_filenamev([GLib.get_user_data_dir(), 'gnome-shell']);
    GLib.mkdir_with_parents(userdatadir, 0o700);

    const ShellGlobal = GObject.registerClass({
        GTypeName: 'GnoshShellGlobal',
        Signals: {
            'notify-error': {param_types: [GObject.TYPE_STRING, GObject.TYPE_STRING]},
            'locate-pointer': {},
            'shutdown': {},
        },
    }, class ShellGlobal extends GObject.Object {
        _init() {
            super._init();
            this.stage = new Clutter.Stage({name: 'stage'});
            this.display = new Meta.Display();
            this.workspace_manager = new Meta.WorkspaceManager();
            this.window_manager = new (GObject.registerClass({
                GTypeName: 'GnoshShellWM',
                Signals: Object.fromEntries(['minimize', 'unminimize', 'size-changed', 'map', 'destroy',
                    'switch-workspace', 'kill-switch-workspace', 'kill-window-effects', 'show-tile-preview',
                    'hide-tile-preview', 'show-window-menu', 'filter-keybinding', 'confirm-display-change',
                    'create-close-dialog', 'create-inhibit-shortcuts-dialog', 'size-change']
                    .map(n => [n, {param_types: [GObject.TYPE_OBJECT]}])),
            }, class extends GObject.Object {}))();
            this.window_group = new St.Widget({name: 'window_group'});
            this.top_window_group = new St.Widget({name: 'top_window_group'});
            this.settings = new Gio.Settings({schema_id: 'org.gnome.shell'});
            this.session_mode = 'user';
            this.userdatadir = userdatadir;
            this.datadir = '/usr/share/gnome-shell';
            this.imagedir = '/usr/share/gnome-shell/';
            this.userdatadir_path = userdatadir;
            this.focus_manager = St.FocusManager.get_for_stage(this.stage);
            this.frame_timestamps = false;
            this.frame_finish_timestamp = false;
            this.force_animations = false;
            this.automation_script = null;
            this.stage_input_mode = 0;
            this.compositor = {
                get_laters: () => new Meta.Laters(),
                get_window_group: () => this.window_group,
                get_top_window_group: () => this.top_window_group,
                disable_unredirect: () => {},
                enable_unredirect: () => {},
                get_display: () => this.display,
            };
            this.backend = Meta.get_backend();
            this.context = {
                get_backend: () => this.backend,
                get_display: () => this.display,
                unsafe_mode: false,
                get_unsafe_mode: () => false,
                set_unsafe_mode: () => {},
                get_compositor_type: () => 1,
            };
            this._persistent = {};
        }

        get screen_width() {
            return this.stage.get_width();
        }

        get screen_height() {
            return this.stage.get_height();
        }

        get_display() {
            return this.display;
        }

        get_stage() {
            return this.stage;
        }

        get_window_group() {
            return this.window_group;
        }

        get_top_window_group() {
            return this.top_window_group;
        }

        get_workspace_manager() {
            return this.workspace_manager;
        }

        get_session_mode() {
            return this.session_mode;
        }

        get_current_time() {
            return Gtk.get_current_event_time() || (GLib.get_monotonic_time() / 1000 | 0);
        }

        get_window_actors() {
            return [];
        }

        get_pointer() {
            const seat = Gdk.Display.get_default()?.get_default_seat();
            const pointer = seat?.get_pointer();
            if (!pointer)
                return [0, 0, 0];
            const [, x, y] = pointer.get_position();
            return [x, y, 0];
        }

        create_app_launch_context(timestamp = 0, workspace = -1) {
            const ctx = Gdk.Display.get_default()?.get_app_launch_context() ?? new Gio.AppLaunchContext();
            if (timestamp && ctx.set_timestamp)
                ctx.set_timestamp(timestamp);
            void workspace;
            return ctx;
        }

        _stateFile(key, persistent) {
            const dir = persistent ? userdatadir
                : GLib.build_filenamev([GLib.get_user_runtime_dir(), 'gnome-shell']);
            GLib.mkdir_with_parents(dir, 0o700);
            return Gio.File.new_for_path(GLib.build_filenamev([dir, `${key}.gvariant`]));
        }

        _readState(type, key, persistent) {
            try {
                const [, bytes] = this._stateFile(key, persistent).load_contents(null);
                return GLib.Variant.new_from_bytes(new GLib.VariantType(type), new GLib.Bytes(bytes), false);
            } catch {
                return null;
            }
        }

        _writeState(key, value, persistent) {
            const file = this._stateFile(key, persistent);
            if (!value) {
                try {
                    file.delete(null);
                } catch {
                    // already gone
                }
                return;
            }
            file.replace_contents(value.get_data_as_bytes().toArray(), null, false,
                Gio.FileCreateFlags.REPLACE_DESTINATION, null);
        }

        get_persistent_state(type, key) {
            return this._readState(type, key, true);
        }

        set_persistent_state(key, value) {
            this._writeState(key, value, true);
        }

        get_runtime_state(type, key) {
            return this._readState(type, key, false);
        }

        set_runtime_state(key, value) {
            this._writeState(key, value, false);
        }

        notify_error(msg, details) {
            this.emit('notify-error', msg, details ?? '');
        }

        log_structured(message) {
            console.log(message);
        }

        run_at_leisure(func) {
            GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                func();
                return GLib.SOURCE_REMOVE;
            });
        }

        begin_work() {}

        end_work() {}

        reexec_self() {}

        set_stage_input_region() {}

        get_frame_timestamps() {
            return false;
        }

        get_overlay_key_name() {
            return 'Super_L';
        }

        get_app_system() {
            return null;
        }
    });

    globalThis.global = new ShellGlobal();
    return globalThis.global;
}
