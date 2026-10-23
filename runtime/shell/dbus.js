// SPDX-License-Identifier: GPL-3.0-or-later
//
// D-Bus services:
//  - org.gnome.Shell.Extensions, the interface GNOME Shell exports for
//    extension management. Extension Manager, gnome-extensions-cli (gext)
//    and gnome-extensions use it. It is exported on gnosh's own bus name
//    org.gnome.Shell.Extensions (object /org/gnome/Shell/Extensions) and,
//    because gnosh runs inside Phosh, also at /org/gnome/Shell on Phosh's
//    connection, which owns org.gnome.Shell.
//  - io.github.exynos_linux.Gnosh, gnosh's own status/control API used
//    by the `gnosh` command and the test suite.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const EXTENSIONS_IFACE = `
<node>
  <interface name="org.gnome.Shell.Extensions">
    <method name="ListExtensions"><arg type="a{sa{sv}}" name="extensions" direction="out"/></method>
    <method name="GetExtensionInfo"><arg type="s" name="uuid" direction="in"/><arg type="a{sv}" name="info" direction="out"/></method>
    <method name="GetExtensionErrors"><arg type="s" name="uuid" direction="in"/><arg type="as" name="errors" direction="out"/></method>
    <method name="InstallRemoteExtension"><arg type="s" name="uuid" direction="in"/><arg type="s" name="result" direction="out"/></method>
    <method name="UninstallExtension"><arg type="s" name="uuid" direction="in"/><arg type="b" name="success" direction="out"/></method>
    <method name="ReloadExtension"><arg type="s" name="uuid" direction="in"/></method>
    <method name="EnableExtension"><arg type="s" name="uuid" direction="in"/><arg type="b" name="success" direction="out"/></method>
    <method name="DisableExtension"><arg type="s" name="uuid" direction="in"/><arg type="b" name="success" direction="out"/></method>
    <method name="LaunchExtensionPrefs"><arg type="s" name="uuid" direction="in"/></method>
    <method name="OpenExtensionPrefs"><arg type="s" name="uuid" direction="in"/><arg type="s" name="parent_window" direction="in"/><arg type="a{sv}" name="options" direction="in"/></method>
    <method name="CheckForUpdates"/>
    <signal name="ExtensionStateChanged"><arg type="s" name="uuid"/><arg type="a{sv}" name="state"/></signal>
    <signal name="ExtensionStatusChanged"><arg type="s" name="uuid"/><arg type="i" name="state"/><arg type="s" name="error"/></signal>
    <property name="ShellVersion" type="s" access="read"/>
    <property name="UserExtensionsEnabled" type="b" access="readwrite"/>
  </interface>
</node>`;

const GNOSH_IFACE = `
<node>
  <interface name="io.github.exynos_linux.Gnosh">
    <method name="GetStatus"><arg type="s" name="json" direction="out"/></method>
    <method name="ShowExtension"><arg type="s" name="uuid" direction="in"/><arg type="b" name="shown" direction="out"/></method>
    <method name="Unfold"/>
    <method name="Fold"/>
    <method name="LoadExtension"><arg type="s" name="uuid" direction="in"/><arg type="b" name="loaded" direction="out"/></method>
    <method name="Eval"><arg type="s" name="code" direction="in"/><arg type="b" name="success" direction="out"/><arg type="s" name="result" direction="out"/></method>
    <property name="Version" type="s" access="read"/>
  </interface>
</node>`;

class ExtensionsService {
    constructor(ctx) {
        this._ctx = ctx;
        this._impls = [];
    }

    get _manager() {
        return this._ctx.Main.extensionManager;
    }

    get _utils() {
        return this._ctx.ExtensionUtils;
    }

    ListExtensions() {
        const out = {};
        for (const uuid of this._manager.getUuids())
            out[uuid] = this._utils.serializeExtension(this._manager.lookup(uuid));
        return out;
    }

    GetExtensionInfo(uuid) {
        const ext = this._manager.lookup(uuid);
        return ext ? this._utils.serializeExtension(ext) : {};
    }

    GetExtensionErrors(uuid) {
        const ext = this._manager.lookup(uuid);
        if (!ext)
            return [];
        return ext.errors ?? (ext.error ? [ext.error] : []);
    }

    InstallRemoteExtensionAsync([uuid], invocation) {
        this._ctx.Downloader.installExtension(uuid, invocation).catch(e => logError(e));
    }

    UninstallExtensionAsync([uuid], invocation) {
        this._ctx.Downloader.uninstallExtension(uuid)
            .then(ok => invocation.return_value(new GLib.Variant('(b)', [ok])))
            .catch(e => invocation.return_value(new GLib.Variant('(b)', [false])) ?? logError(e));
    }

    ReloadExtensionAsync([uuid], invocation) {
        const ext = this._manager.lookup(uuid);
        const done = () => invocation.return_value(null);
        if (!ext) {
            done();
            return;
        }
        this._manager.reloadExtension(ext).then(done).catch(e => {
            logError(e);
            done();
        });
    }

    EnableExtension(uuid) {
        return this._manager.enableExtension(uuid);
    }

    DisableExtension(uuid) {
        return this._manager.disableExtension(uuid);
    }

    LaunchExtensionPrefs(uuid) {
        this.OpenExtensionPrefs(uuid, '', {});
    }

    OpenExtensionPrefs(uuid, parentWindow, options) {
        this._ctx.openPrefs(uuid, parentWindow, options);
    }

    CheckForUpdates() {
        this._ctx.Downloader.checkForUpdates().catch(e => logError(e));
    }

    get ShellVersion() {
        return this._ctx.Config.PACKAGE_VERSION;
    }

    get UserExtensionsEnabled() {
        return !global.settings.get_boolean('disable-user-extensions');
    }

    set UserExtensionsEnabled(enable) {
        global.settings.set_boolean('disable-user-extensions', !enable);
    }

    export(connection, path) {
        const impl = Gio.DBusExportedObject.wrapJSObject(EXTENSIONS_IFACE, this);
        impl.export(connection, path);
        this._impls.push(impl);
        return impl;
    }

    emitStateChanged(extension) {
        const state = this._utils.serializeExtension(extension);
        for (const impl of this._impls) {
            impl.emit_signal('ExtensionStateChanged', new GLib.Variant('(sa{sv})', [extension.uuid, state]));
            impl.emit_signal('ExtensionStatusChanged', new GLib.Variant('(sis)',
                [extension.uuid, extension.state, extension.error ?? '']));
        }
    }

    emitPropertiesChanged() {
        for (const impl of this._impls)
            impl.emit_property_changed('UserExtensionsEnabled', new GLib.Variant('b', this.UserExtensionsEnabled));
    }
}

class GnoshService {
    constructor(ctx) {
        this._ctx = ctx;
    }

    get Version() {
        return globalThis.__gnosh.version;
    }

    GetStatus() {
        const manager = this._ctx.Main.extensionManager;
        const State = this._ctx.ExtensionUtils.ExtensionState;
        const stateName = s => Object.keys(State).find(k => State[k] === s) ?? String(s);
        const extensions = manager.getUuids().map(uuid => {
            const e = manager.lookup(uuid);
            return {
                uuid, name: e.metadata.name, version: e.metadata.version ?? null,
                shellVersion: e.metadata['shell-version'], state: stateName(e.state),
                enabled: Boolean(e.enabled), error: e.error || null, path: e.path,
                type: e.type === 2 ? 'user' : 'system', hasPrefs: e.hasPrefs, hasUpdate: e.hasUpdate,
            };
        });
        return JSON.stringify({
            gnosh: globalThis.__gnosh.version,
            shellVersion: this._ctx.Config.PACKAGE_VERSION,
            phosh: true,
            locked: this._ctx.Main.sessionMode?.isLocked ?? false,
            unsafe: Boolean(globalThis.__gnosh.unsafe),
            extensions,
            tiles: this._ctx.bridge.listTiles(),
            topbar: this._ctx.bridge.listTopbar(),
            uptime: Math.round((GLib.get_monotonic_time() - globalThis.__gnosh.startTime) / 1e6),
        });
    }

    ShowExtension(uuid) {
        return this._ctx.bridge.showExtension(uuid);
    }

    LoadExtensionAsync([uuid], invocation) {
        this._ctx.loadUserExtension(uuid)
            .then(ok => invocation.return_value(new GLib.Variant('(b)', [ok])))
            .catch(e => {
                logError(e);
                invocation.return_value(new GLib.Variant('(b)', [false]));
            });
    }

    Unfold() {
        this._ctx.bridge.unfold();
    }

    Fold() {
        this._ctx.bridge.fold();
    }

    Eval(code) {
        if (!globalThis.__gnosh.unsafe)
            return [false, 'Eval is only available when Phosh runs with GNOSH_UNSAFE=1'];
        try {
            // eslint-disable-next-line no-eval
            const result = (0, eval)(code);
            return [true, typeof result === 'string' ? result : JSON.stringify(result) ?? String(result)];
        } catch (e) {
            return [false, `${e}\n${e.stack ?? ''}`];
        }
    }
}

export function exportServices(ctx) {
    const connection = Gio.DBus.session;
    const extensions = new ExtensionsService(ctx);
    // On Phosh's own org.gnome.Shell connection (same process).
    extensions.export(connection, '/org/gnome/Shell');
    // On our own bus name, where Extension Manager looks for it.
    extensions.export(connection, '/org/gnome/Shell/Extensions');
    Gio.bus_own_name_on_connection(connection, 'org.gnome.Shell.Extensions',
        Gio.BusNameOwnerFlags.REPLACE | Gio.BusNameOwnerFlags.ALLOW_REPLACEMENT, null,
        () => console.warn('gnosh: could not own org.gnome.Shell.Extensions'));

    const gnosh = Gio.DBusExportedObject.wrapJSObject(GNOSH_IFACE, new GnoshService(ctx));
    gnosh.export(connection, '/io/github/exynos_linux/Gnosh');
    Gio.bus_own_name_on_connection(connection, 'io.github.exynos_linux.Gnosh', Gio.BusNameOwnerFlags.NONE, null,
        () => console.warn('gnosh: could not own io.github.exynos_linux.Gnosh'));

    ctx.Main.extensionManager.connect('extension-state-changed', (m, extension) =>
        extensions.emitStateChanged(extension));
    global.settings.connect('changed::disable-user-extensions', () => extensions.emitPropertiesChanged());
    return {extensions, gnosh};
}
