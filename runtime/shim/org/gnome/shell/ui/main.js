// SPDX-License-Identifier: GPL-3.0-or-later
//
// gnosh: GNOME Shell's ui/main.js. Holds the shell singletons extensions
// use (Main.panel, Main.overview, Main.wm, Main.messageTray, ...), backed by
// Phosh where Phosh has an equivalent.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Signals from '../misc/signals.js';
import * as NotificationDaemon from './notificationDaemon.js';

export let componentManager = null;
export let extensionManager = null;
export let panel = null;
export let overview = null;
export let runDialog = null;
export let lookingGlass = null;
export let welcomeDialog = null;
export let wm = null;
export let messageTray = null;
export let screenShield = null;
export let notificationDaemon = null;
export let windowAttentionHandler = null;
export let ctrlAltTabManager = null;
export let padOsdService = null;
export let osdWindowManager = null;
export let osdMonitorLabeler = null;
export let sessionMode = null;
export let screenshotUI = null;
export let shellAccessDialogDBusService = null;
export let shellAudioSelectionDBusService = null;
export let shellDBusService = null;
export let shellMountOpDBusService = null;
export let screenSaverDBus = null;
export let modalCount = 0;
export let actionMode = Shell.ActionMode.NORMAL;
export let modalActorFocusStack = [];
export let uiGroup = null;
export let magnifier = null;
export let xdndHandler = null;
export let keyboard = null;
export let layoutManager = null;
export let kbdA11yDialog = null;
export let inputMethod = null;
export let introspectService = null;
export let locatePointer = null;
export let endSessionDialog = null;
export let breakManager = null;
export let screenTimeDBus = null;
export let breakManagerDispatcher = null;
export let timeLimitsManager = null;
export let timeLimitsDispatcher = null;
export let brightnessManager = null;
export let brightnessDBus = null;

const callShell = (name, path, iface, method, params, cb) =>
    Gio.DBus.session.call(name, path, iface, method, params, null, Gio.DBusCallFlags.NONE, -1, null,
        (conn, res) => {
            try {
                cb?.(conn.call_finish(res));
            } catch (e) {
                console.warn(`gnosh: ${iface}.${method}: ${e.message}`);
            }
        });

class SessionMode extends Signals.EventEmitter {
    constructor() {
        super();
        this.currentMode = 'user';
        this.parentMode = 'user';
        this.isLocked = false;
        this.isGreeter = false;
        this.isPrimary = true;
        this.hasOverview = false;
        this.hasAppMenu = false;
        this.hasRunDialog = false;
        this.hasWorkspaces = false;
        this.hasWindows = true;
        this.hasNotifications = true;
        this.hasBackgroundApps = false;
        this.allowSettings = true;
        this.allowScreencast = false;
        this.allowExtensions = true;
        this.allowKeybindingsWhenModal = false;
        this.showCalendarEvents = false;
        this.showWelcomeDialog = false;
        this.unlockDialog = null;
        this.loginDialog = null;
        this.components = [];
        this.panel = {left: [], center: [], right: []};
        this.panelStyle = null;
    }

    _setLocked(locked) {
        if (this.isLocked === locked)
            return;
        this.isLocked = locked;
        this.currentMode = locked ? 'unlock-dialog' : 'user';
        this.allowSettings = !locked;
        this.emit('updated');
    }

    pushMode(mode) {
        this._setLocked(mode === 'unlock-dialog');
    }

    popMode() {
        this._setLocked(false);
    }

    switchMode(mode) {
        this._setLocked(mode === 'unlock-dialog');
    }
}

class Overview extends Signals.EventEmitter {
    constructor() {
        super();
        this.visible = false;
        this.visibleTarget = false;
        this.animationInProgress = false;
        this.isDummy = true;
        this.dash = {showAppsButton: new St.Button(), _box: new St.BoxLayout(), iconSize: 48};
        this.dashIconSize = 48;
        this._overview = {_controls: null};
        this.searchEntry = new St.Entry();
    }

    show() {}

    hide() {}

    toggle() {}

    showApps() {}

    focusSearch() {}

    addAction() {}

    beginItemDrag() {}

    cancelledItemDrag() {}

    endItemDrag() {}

    beginWindowDrag() {}

    cancelledWindowDrag() {}

    endWindowDrag() {}

    init() {}
}

class WindowManager {
    constructor() {
        this._allowedKeybindings = {};
    }

    addKeybinding(name, settings, flags, modes, handler) {
        const action = global.display.add_keybinding(name, settings, flags, handler);
        if (action !== Meta.KeyBindingAction.NONE)
            this._allowedKeybindings[name] = modes;
        return action;
    }

    removeKeybinding(name) {
        if (global.display.remove_keybinding(name))
            delete this._allowedKeybindings[name];
    }

    allowKeybinding(name, modes) {
        this._allowedKeybindings[name] = modes;
    }

    setCustomKeybindingHandler() {}

    skipNextEffect() {}

    _blockAnimations() {}

    _unblockAnimations() {}

    _shouldAnimate() {
        return false;
    }
}

class OsdWindowManager {
    show(monitorIndex, icon, label, level, maxLevel) {
        const params = {};
        if (icon)
            params.icon = new GLib.Variant('s', icon.to_string?.() ?? String(icon));
        if (label)
            params.label = new GLib.Variant('s', label);
        if (level !== undefined && level !== null)
            params.level = new GLib.Variant('d', level);
        if (maxLevel !== undefined && maxLevel !== null)
            params.max_level = new GLib.Variant('d', maxLevel);
        callShell('org.gnome.Shell', '/org/gnome/Shell', 'org.gnome.Shell', 'ShowOSD',
            new GLib.Variant('(a{sv})', [params]));
    }

    showAll(icon, label, level, maxLevel) {
        this.show(-1, icon, label, level, maxLevel);
    }

    showOne(monitorIndex, icon, label, level, maxLevel) {
        this.show(monitorIndex, icon, label, level, maxLevel);
    }

    hideAll() {}
}

class ScreenShield extends Signals.EventEmitter {
    constructor() {
        super();
        this.locked = false;
        this.active = false;
    }

    lock() {
        callShell('org.gnome.ScreenSaver', '/org/gnome/ScreenSaver', 'org.gnome.ScreenSaver', 'Lock', null);
    }

    activate() {
        this.lock();
    }

    deactivate() {}

    _setLocked(locked) {
        if (this.locked === locked)
            return;
        this.locked = this.active = locked;
        this.emit('locked-changed');
        this.emit('active-changed');
    }
}

const InputMethod = GObject.registerClass({
    Properties: {
        'content-purpose': GObject.ParamSpec.int('content-purpose', null, null, GObject.ParamFlags.READWRITE, 0, 20, 0),
        'content-hints': GObject.ParamSpec.int('content-hints', null, null, GObject.ParamFlags.READWRITE, 0, 0x7fffffff, 0),
        'can-show-preedit': GObject.ParamSpec.boolean('can-show-preedit', null, null, GObject.ParamFlags.READWRITE, false),
    },
    Signals: {'commit': {param_types: [GObject.TYPE_STRING]}, 'request-surrounding': {}, 'input-panel-state': {param_types: [GObject.TYPE_INT]}},
}, class InputMethod extends GObject.Object {
    get currentFocus() {
        return null;
    }
});

class ModalGrab {
    constructor(actor) {
        this.actor = actor;
    }

    dismiss() {}

    get_seat_state() {
        return Clutter.GrabState?.ALL ?? 3;
    }
}

export function start(bridge) {
    layoutManager = new (bridge.modules.Layout.LayoutManager)();
    uiGroup = layoutManager.uiGroup;
    sessionMode = new SessionMode();
    overview = new Overview();
    wm = new WindowManager();
    osdWindowManager = new OsdWindowManager();
    screenShield = new ScreenShield();
    messageTray = new (bridge.modules.MessageTray.MessageTray)();
    extensionManager = new (bridge.modules.ExtensionSystem.ExtensionManager)();
    bridge.extensionManager = extensionManager;
    panel = new (bridge.modules.Panel.Panel)();
    panel._gnoshCreateBuiltins();
    notificationDaemon = new NotificationDaemon.NotificationDaemon();
    ctrlAltTabManager = {addGroup() {}, removeGroup() {}, focusGroup() {}};
    componentManager = {_allComponents: {}, _enabledComponents: []};
    keyboard = Object.assign(new Signals.EventEmitter(), {visible: false, open() {}, close() {}, _keyboard: null});
    magnifier = {setActive() {}, isActive: () => false};
    xdndHandler = new Signals.EventEmitter();
    screenshotUI = {open() {}, close() {}};
    endSessionDialog = null;
    inputMethod = new InputMethod();
    locatePointer = {show() {}};
    windowAttentionHandler = {};
    padOsdService = {};
    osdMonitorLabeler = {show() {}, hide() {}};
    introspectService = {};
}

export function getStyleVariant() {
    return 'dark';
}

export function createWorkspacesAdjustment() {
    return new St.Adjustment({value: 0, lower: 0, upper: 1, step_increment: 1, page_increment: 1, page_size: 1});
}

export function getThemeStylesheet() {
    return null;
}

export function setThemeStylesheet() {}

export function reloadThemeResource() {}

export function loadTheme() {}

function systemNotify(msg, details, error = false) {
    const MessageTray = globalThis.__gnosh?.bridge?.modules.MessageTray;
    if (!MessageTray)
        return;
    const source = MessageTray.getSystemSource();
    const notification = new MessageTray.Notification({
        source,
        title: msg,
        body: details ?? '',
        isTransient: true,
        urgency: error ? MessageTray.Urgency.HIGH : MessageTray.Urgency.NORMAL,
    });
    source.addNotification(notification);
}

export function notify(msg, details) {
    systemNotify(msg, details);
}

export function notifyError(msg, details) {
    if (details)
        console.warn(`error: ${msg}: ${details}`);
    else
        console.warn(`error: ${msg}`);
    systemNotify(msg, details, true);
}

export function pushModal(actor, params) {
    modalCount++;
    return new ModalGrab(actor, params);
}

export function popModal() {
    modalCount = Math.max(0, modalCount - 1);
}

export function createLookingGlass() {
    return null;
}

export function openRunDialog() {}

export function openWelcomeDialog() {}

export function activateWindow(window) {
    window?.activate?.(global.get_current_time());
}

export function moveWindowToMonitorAndWorkspace() {}

export function initializeDeferredWork(actor, callback) {
    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
        callback();
        return GLib.SOURCE_REMOVE;
    });
    return `deferred-${GObject.type_name(actor.constructor.$gtype)}`;
}

export function queueDeferredWork() {}

// gnosh helpers for the bridge
export function _gnoshSetLocked(locked) {
    sessionMode?._setLocked(locked);
    screenShield?._setLocked(locked);
}
