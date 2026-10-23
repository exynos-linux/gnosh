// SPDX-License-Identifier: GPL-3.0-or-later
//
// gnosh: GNOME Shell's message tray API on top of Phosh's notification
// server (org.freedesktop.Notifications, served by Phosh itself).
// Supports the GNOME 46+ API (property bags) and the older
// `new Notification(source, title, banner, params)` form.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';

import * as Signals from '../misc/signals.js';

export const ANIMATION_TIME = 200;

export const State = {HIDDEN: 0, SHOWING: 1, SHOWN: 2, HIDING: 3};

export const NotificationDestroyedReason = {EXPIRED: 1, DISMISSED: 2, SOURCE_CLOSED: 3, REPLACED: 4};

export const Urgency = {LOW: 0, NORMAL: 1, HIGH: 2, CRITICAL: 3};

export const PrivacyScope = {USER: 0, SYSTEM: 1};

const FDO_NAME = 'org.freedesktop.Notifications';
const FDO_PATH = '/org/freedesktop/Notifications';

// fdo close reasons -> GNOME destroy reasons
const CLOSE_REASONS = {1: NotificationDestroyedReason.EXPIRED, 2: NotificationDestroyedReason.DISMISSED,
    3: NotificationDestroyedReason.SOURCE_CLOSED, 4: NotificationDestroyedReason.REPLACED};

const _byId = new Map();
let _signalsConnected = false;

function ensureSignals() {
    if (_signalsConnected)
        return;
    _signalsConnected = true;
    Gio.DBus.session.signal_subscribe(null, FDO_NAME, 'ActionInvoked', FDO_PATH, null,
        Gio.DBusSignalFlags.NONE, (c, s, p, i, n, params) => {
            const [id, key] = params.deepUnpack();
            _byId.get(id)?._gnoshInvoke(key);
        });
    Gio.DBus.session.signal_subscribe(null, FDO_NAME, 'NotificationClosed', FDO_PATH, null,
        Gio.DBusSignalFlags.NONE, (c, s, p, i, n, params) => {
            const [id, reason] = params.deepUnpack();
            const notification = _byId.get(id);
            if (notification) {
                _byId.delete(id);
                notification._gnoshClosedRemotely(CLOSE_REASONS[reason] ?? NotificationDestroyedReason.DISMISSED);
            }
        });
}

function iconString(gicon, iconName) {
    if (iconName)
        return iconName;
    if (gicon instanceof Gio.ThemedIcon)
        return gicon.get_names()[0] ?? '';
    if (gicon instanceof Gio.FileIcon)
        return gicon.get_file().get_path() ?? gicon.get_file().get_uri();
    return gicon?.to_string?.() ?? '';
}

export class NotificationPolicy extends GObject.Object {
    static {
        GObject.registerClass({
            Properties: {
                'enable': GObject.ParamSpec.boolean('enable', null, null, GObject.ParamFlags.READABLE, true),
                'enable-sound': GObject.ParamSpec.boolean('enable-sound', null, null, GObject.ParamFlags.READABLE, true),
                'show-banners': GObject.ParamSpec.boolean('show-banners', null, null, GObject.ParamFlags.READABLE, true),
                'force-expanded': GObject.ParamSpec.boolean('force-expanded', null, null, GObject.ParamFlags.READABLE, false),
                'show-in-lock-screen': GObject.ParamSpec.boolean('show-in-lock-screen', null, null, GObject.ParamFlags.READABLE, false),
                'details-in-lock-screen': GObject.ParamSpec.boolean('details-in-lock-screen', null, null, GObject.ParamFlags.READABLE, false),
            },
            Signals: {'changed': {}},
        }, this);
    }

    get enable() {
        return true;
    }

    get enableSound() {
        return true;
    }

    get showBanners() {
        return true;
    }

    get forceExpanded() {
        return false;
    }

    get showInLockScreen() {
        return false;
    }

    get detailsInLockScreen() {
        return false;
    }

    destroy() {
        this.run_dispose();
    }

    store() {}
}

export class NotificationGenericPolicy extends NotificationPolicy {
    static {
        GObject.registerClass(this);
    }
}

export class NotificationApplicationPolicy extends NotificationPolicy {
    static {
        GObject.registerClass(this);
    }

    constructor(id) {
        super();
        this.id = id;
    }
}

export class Sound extends GObject.Object {
    static {
        GObject.registerClass(this);
    }

    constructor(file, themedName) {
        super();
        this._file = file;
        this._themedName = themedName;
    }

    play() {
        global.display.get_sound_player().play_from_theme(this._themedName ?? '', '', null);
    }
}

export class Action extends GObject.Object {
    static {
        GObject.registerClass(this);
    }

    constructor(label, callback) {
        super();
        this._label = label;
        this._callback = callback;
    }

    get label() {
        return this._label;
    }

    activate() {
        this._callback?.();
    }
}

export class Notification extends GObject.Object {
    static {
        GObject.registerClass({
            Properties: {
                'source': GObject.ParamSpec.object('source', null, null, GObject.ParamFlags.READWRITE, GObject.Object),
                'title': GObject.ParamSpec.string('title', null, null, GObject.ParamFlags.READWRITE, null),
                'body': GObject.ParamSpec.string('body', null, null, GObject.ParamFlags.READWRITE, null),
                'use-body-markup': GObject.ParamSpec.boolean('use-body-markup', null, null, GObject.ParamFlags.READWRITE, false),
                'gicon': GObject.ParamSpec.object('gicon', null, null, GObject.ParamFlags.READWRITE, Gio.Icon),
                'icon-name': GObject.ParamSpec.string('icon-name', null, null, GObject.ParamFlags.READWRITE, null),
                'sound': GObject.ParamSpec.object('sound', null, null, GObject.ParamFlags.READWRITE, Sound),
                'datetime': GObject.ParamSpec.boxed('datetime', null, null, GObject.ParamFlags.READWRITE, GLib.DateTime),
                'privacy-scope': GObject.ParamSpec.int('privacy-scope', null, null, GObject.ParamFlags.READWRITE, 0, 1, 0),
                'urgency': GObject.ParamSpec.int('urgency', null, null, GObject.ParamFlags.READWRITE, 0, 3, Urgency.NORMAL),
                'acknowledged': GObject.ParamSpec.boolean('acknowledged', null, null, GObject.ParamFlags.READWRITE, false),
                'resident': GObject.ParamSpec.boolean('resident', null, null, GObject.ParamFlags.READWRITE, false),
                'for-feedback': GObject.ParamSpec.boolean('for-feedback', null, null, GObject.ParamFlags.READWRITE, false),
                'is-transient': GObject.ParamSpec.boolean('is-transient', null, null, GObject.ParamFlags.READWRITE, false),
            },
            Signals: {
                'action-added': {param_types: [Action.$gtype]},
                'action-removed': {param_types: [Action.$gtype]},
                'activated': {},
                'destroy': {param_types: [GObject.TYPE_UINT]},
                'updated': {param_types: [GObject.TYPE_BOOLEAN]},
            },
        }, this);
    }

    constructor(...args) {
        // Legacy (GNOME <= 45): (source, title, banner, params)
        if (args.length > 1 || (args[0] && !(args[0].constructor === Object))) {
            const [source, title, banner, params = {}] = args;
            super({source, title, body: banner ?? null,
                gicon: params.gicon ?? null, use_body_markup: Boolean(params.bannerMarkup)});
        } else {
            const params = {...args[0] ?? {}};
            // camelCase keys from extensions
            const props = {};
            for (const [k, v] of Object.entries(params))
                props[k.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase()] = v;
            super(props);
        }
        this.actions = [];
        this._fdoId = 0;
        this._destroyed = false;
    }

    // legacy API
    update(title, banner, params = {}) {
        this.title = title;
        this.body = banner;
        if (params.gicon)
            this.gicon = params.gicon;
        if (this._fdoId)
            this._gnoshSend();
        this.emit('updated', false);
    }

    get bannerBodyText() {
        return this.body;
    }

    setUrgency(urgency) {
        this.urgency = urgency;
    }

    setResident(resident) {
        this.resident = resident;
    }

    setTransient(transient) {
        this.isTransient = transient;
    }

    setForFeedback(v) {
        this.forFeedback = v;
    }

    setPrivacyScope(scope) {
        this.privacyScope = scope;
    }

    addAction(label, callback) {
        const action = new Action(label, callback);
        this.actions.push(action);
        this.emit('action-added', action);
        if (this._fdoId)
            this._gnoshSend();
        return action;
    }

    removeAction(action) {
        this.actions = this.actions.filter(a => a !== action);
        this.emit('action-removed', action);
    }

    clearActions() {
        this.actions.forEach(a => this.emit('action-removed', a));
        this.actions = [];
    }

    setDefaultAction(callback) {
        this._defaultCallback = callback;
    }

    playSound() {
        this.sound?.play();
    }

    activate() {
        this.emit('activated');
        this._defaultCallback?.();
        if (!this.resident)
            this.destroy();
    }

    _gnoshInvoke(key) {
        if (key === 'default') {
            this.activate();
            return;
        }
        const index = parseInt(key.replace(/^gnosh-/, ''), 10);
        this.actions[index]?.activate();
        if (!this.resident)
            this.destroy();
    }

    _gnoshSend() {
        ensureSignals();
        const source = this.source;
        const actions = ['default', ''];
        this.actions.forEach((a, i) => actions.push(`gnosh-${i}`, a.label));
        const hints = {
            'urgency': new GLib.Variant('y', Math.min(2, this.urgency)),
            'transient': new GLib.Variant('b', this.isTransient),
            'resident': new GLib.Variant('b', this.resident),
        };
        const desktopId = source?.policy?.id ?? source?._appId;
        if (desktopId)
            hints['desktop-entry'] = new GLib.Variant('s', desktopId.replace(/\.desktop$/, ''));
        const appIcon = iconString(this.gicon ?? source?.icon, this.iconName ?? source?.iconName);
        const params = new GLib.Variant('(susssasa{sv}i)', [
            source?.title ?? 'gnosh', this._fdoId, appIcon, this.title ?? '', this.body ?? '',
            actions, hints, this.isTransient ? 5000 : -1,
        ]);
        Gio.DBus.session.call(FDO_NAME, FDO_PATH, FDO_NAME, 'Notify', params, new GLib.VariantType('(u)'),
            Gio.DBusCallFlags.NONE, -1, null, (conn, res) => {
                try {
                    const [id] = conn.call_finish(res).deepUnpack();
                    if (this._destroyed) {
                        Notification._close(id);
                        return;
                    }
                    if (this._fdoId && this._fdoId !== id)
                        _byId.delete(this._fdoId);
                    this._fdoId = id;
                    _byId.set(id, this);
                } catch (e) {
                    console.warn(`gnosh: sending notification failed: ${e.message}`);
                }
            });
        this.playSound();
    }

    static _close(id) {
        Gio.DBus.session.call(FDO_NAME, FDO_PATH, FDO_NAME, 'CloseNotification',
            new GLib.Variant('(u)', [id]), null, Gio.DBusCallFlags.NONE, -1, null, null);
    }

    _gnoshClosedRemotely(reason) {
        this._fdoId = 0;
        this.destroy(reason);
    }

    destroy(reason = NotificationDestroyedReason.DISMISSED) {
        if (this._destroyed)
            return;
        this._destroyed = true;
        if (this._fdoId) {
            _byId.delete(this._fdoId);
            Notification._close(this._fdoId);
            this._fdoId = 0;
        }
        this.emit('destroy', reason);
        this.run_dispose();
    }
}

export class Source extends GObject.Object {
    static {
        GObject.registerClass({
            Properties: {
                'count': GObject.ParamSpec.int('count', null, null, GObject.ParamFlags.READABLE, 0, GLib.MAXINT32, 0),
                'policy': GObject.ParamSpec.object('policy', null, null, GObject.ParamFlags.READWRITE, NotificationPolicy),
                'title': GObject.ParamSpec.string('title', null, null, GObject.ParamFlags.READWRITE, null),
                'icon': GObject.ParamSpec.object('icon', null, null, GObject.ParamFlags.READWRITE, Gio.Icon),
                'icon-name': GObject.ParamSpec.string('icon-name', null, null, GObject.ParamFlags.READWRITE, null),
                'allow-banners': GObject.ParamSpec.boolean('allow-banners', null, null, GObject.ParamFlags.READWRITE, true),
            },
            Signals: {
                'destroy': {param_types: [GObject.TYPE_UINT]},
                'notification-added': {param_types: [Notification.$gtype]},
                'notification-removed': {param_types: [Notification.$gtype]},
                'notification-request-banner': {param_types: [Notification.$gtype]},
            },
        }, this);
    }

    constructor(...args) {
        // Legacy: (title, iconName)
        if (typeof args[0] === 'string' || args.length > 1) {
            super({title: args[0] ?? null, icon_name: args[1] ?? null});
        } else {
            const props = {};
            for (const [k, v] of Object.entries(args[0] ?? {}))
                props[k.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase()] = v;
            super(props);
        }
        this.notifications = [];
        this.policy ??= new NotificationGenericPolicy();
    }

    get count() {
        return this.notifications.length;
    }

    get unseenCount() {
        return this.notifications.filter(n => !n.acknowledged).length;
    }

    get countVisible() {
        return this.count > 1;
    }

    get narrowestPrivacyScope() {
        return PrivacyScope.SYSTEM;
    }

    get isOnLockScreen() {
        return false;
    }

    createIcon() {
        return null;
    }

    getIcon() {
        return this.icon ?? (this.iconName ? Gio.ThemedIcon.new(this.iconName) : null);
    }

    addNotification(notification) {
        if (this.notifications.includes(notification)) {
            notification._gnoshSend();
            return;
        }
        notification.source ??= this;
        this.notifications.push(notification);
        notification.connect('destroy', () => {
            this.notifications = this.notifications.filter(n => n !== notification);
            this.emit('notification-removed', notification);
            this.notify('count');
            if (!this.notifications.length && !this._persistent)
                this.destroy(NotificationDestroyedReason.SOURCE_CLOSED);
        });
        this.emit('notification-added', notification);
        this.emit('notification-request-banner', notification);
        this.notify('count');
        notification._gnoshSend();
    }

    // legacy API
    showNotification(notification) {
        this.addNotification(notification);
    }

    pushNotification(notification) {
        this.addNotification(notification);
    }

    destroy(reason = NotificationDestroyedReason.SOURCE_CLOSED) {
        if (this._destroyed)
            return;
        this._destroyed = true;
        for (const n of [...this.notifications])
            n.destroy(reason);
        this.emit('destroy', reason);
        this.run_dispose();
    }

    open() {}

    destroyNonResidentNotifications() {
        for (const n of [...this.notifications]) {
            if (!n.resident)
                n.destroy();
        }
    }
}

export class MessageTray extends Signals.EventEmitter {
    constructor() {
        super();
        this._sources = new Set();
        this.bannerBlocked = false;
        this.bannerAlignment = 0;
        this.queueCount = 0;
    }

    add(source) {
        if (this._sources.has(source))
            return;
        this._sources.add(source);
        source.connect('destroy', () => {
            this._sources.delete(source);
            this.emit('source-removed', source);
        });
        this.emit('source-added', source);
    }

    contains(source) {
        return this._sources.has(source);
    }

    getSources() {
        return [...this._sources];
    }

    get _sourcesArray() {
        return this.getSources();
    }

    clearableCount() {
        return 0;
    }
}

let _systemSource = null;

export function getSystemSource() {
    if (!_systemSource || _systemSource._destroyed) {
        _systemSource = new Source({title: 'System', iconName: 'emblem-system-symbolic'});
        _systemSource._persistent = true;
        globalThis.__gnosh?.main?.messageTray?.add(_systemSource);
    }
    return _systemSource;
}
