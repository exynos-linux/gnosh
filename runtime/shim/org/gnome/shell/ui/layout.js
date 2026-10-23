// SPDX-License-Identifier: GPL-3.0-or-later
//
// gnosh: GNOME Shell's LayoutManager positions the shell's chrome on the
// stage. Phosh owns the screen layout, so this keeps the monitor geometry
// and the actor groups extensions expect. Actors added as chrome are kept
// in the tree but are not shown on screen (Phosh has no free-floating
// overlay for them).

import Clutter from 'gi://Clutter';
import Gdk from 'gi://Gdk?version=3.0';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import St from 'gi://St';

export const STARTUP_ANIMATION_TIME = 500;
export const BACKGROUND_FADE_ANIMATION_TIME = 1000;
export const HOT_CORNER_PRESSURE_THRESHOLD = 100;
export const HOT_CORNER_PRESSURE_TIMEOUT = 1000;

class Monitor {
    constructor(index, gdkMonitor) {
        const g = gdkMonitor?.get_geometry();
        this.index = index;
        this.x = g?.x ?? 0;
        this.y = g?.y ?? 0;
        this.width = g?.width ?? 360;
        this.height = g?.height ?? 720;
        this.geometry_scale = gdkMonitor?.get_scale_factor() ?? 1;
        this.inFullscreen = false;
    }

    get geometry() {
        return new Meta.Rectangle({x: this.x, y: this.y, width: this.width, height: this.height});
    }
}

export const MonitorConstraint = GObject.registerClass({
    Properties: {
        'primary': GObject.ParamSpec.boolean('primary', null, null, GObject.ParamFlags.READWRITE, false),
        'index': GObject.ParamSpec.int('index', null, null, GObject.ParamFlags.READWRITE, -1, 64, -1),
        'work-area': GObject.ParamSpec.boolean('work-area', null, null, GObject.ParamFlags.READWRITE, false),
    },
}, class MonitorConstraint extends Clutter.Constraint {});

/**
 * A group whose children are part of the actor tree but are not packed
 * into a visible GTK container. The bridge "borrows" the widgets of popup
 * menus to show them in Phosh's quick settings.
 */
export const HiddenGroup = GObject.registerClass(
class HiddenGroup extends St.Widget {
    _gnoshPack() {}
});

export const LayoutManager = GObject.registerClass({
    Signals: {
        'hot-corners-changed': {},
        'startup-complete': {},
        'startup-prepared': {},
        'monitors-changed': {},
        'system-modal-opened': {},
        'keyboard-visible-changed': {param_types: [GObject.TYPE_BOOLEAN]},
    },
}, class LayoutManager extends GObject.Object {
    _init() {
        super._init();
        this._startingUp = false;
        this._rtl = Clutter.get_default_text_direction() === Clutter.TextDirection.RTL;
        this.monitors = [];
        this.primaryMonitor = null;
        this.primaryIndex = -1;
        this.hotCorners = [];
        this._chrome = [];
        this.isPhone = true;

        this.uiGroup = new HiddenGroup({name: 'uiGroup'});
        this.overviewGroup = new HiddenGroup({name: 'overviewGroup'});
        this.modalDialogGroup = new HiddenGroup({name: 'modalDialogGroup'});
        this.screenShieldGroup = new HiddenGroup({name: 'lockDialogGroup'});
        this.panelBox = new St.BoxLayout({name: 'panelBox', vertical: true});
        this.keyboardBox = new St.BoxLayout({name: 'keyboardBox'});
        this.uiGroup.add_child(this.overviewGroup);
        this.uiGroup.add_child(this.modalDialogGroup);
        this.uiGroup.add_child(this.screenShieldGroup);
        this.uiGroup.add_child(this.keyboardBox);

        this._updateMonitors();
        const display = Gdk.Display.get_default();
        display?.connect('monitor-added', () => this._monitorsChanged());
        display?.connect('monitor-removed', () => this._monitorsChanged());
    }

    _monitorsChanged() {
        this._updateMonitors();
        this.emit('monitors-changed');
    }

    _updateMonitors() {
        const display = Gdk.Display.get_default();
        const n = display?.get_n_monitors() ?? 0;
        this.monitors = [];
        for (let i = 0; i < n; i++)
            this.monitors.push(new Monitor(i, display.get_monitor(i)));
        if (!this.monitors.length)
            this.monitors.push(new Monitor(0, null));
        const primary = display?.get_primary_monitor();
        let idx = 0;
        for (let i = 0; i < n; i++) {
            if (display.get_monitor(i) === primary)
                idx = i;
        }
        this.primaryIndex = idx;
        this.primaryMonitor = this.monitors[idx];
        this.bottomIndex = idx;
        this.bottomMonitor = this.primaryMonitor;
    }

    get currentMonitor() {
        return this.primaryMonitor;
    }

    get focusIndex() {
        return this.primaryIndex;
    }

    get focusMonitor() {
        return this.primaryMonitor;
    }

    get keyboardMonitor() {
        return this.primaryMonitor;
    }

    get keyboardIndex() {
        return this.primaryIndex;
    }

    set keyboardIndex(v) {}

    get modalCount() {
        return 0;
    }

    _warnChrome(actor) {
        if (!this._chromeWarned) {
            this._chromeWarned = true;
            console.warn('gnosh: extension chrome (floating actors) is kept but not shown; Phosh has no overlay for it');
        }
        this._chrome.push(actor);
    }

    addChrome(actor) {
        this._warnChrome(actor);
        if (!actor.get_parent())
            this.uiGroup.add_child(actor);
    }

    addTopChrome(actor) {
        this.addChrome(actor);
    }

    trackChrome(actor) {
        this._warnChrome(actor);
    }

    untrackChrome(actor) {
        this._chrome = this._chrome.filter(a => a !== actor);
    }

    removeChrome(actor) {
        this.untrackChrome(actor);
        if (actor.get_parent() === this.uiGroup)
            this.uiGroup.remove_child(actor);
    }

    isTrackingChrome(actor) {
        return this._chrome.includes(actor);
    }

    getWorkAreaForMonitor(index) {
        const m = this.monitors[index] ?? this.primaryMonitor;
        return new Meta.Rectangle({x: m.x, y: m.y, width: m.width, height: m.height});
    }

    getWorkspacesActualGeometry() {
        return this.getWorkAreaForMonitor(this.primaryIndex);
    }

    findIndexForActor() {
        return this.primaryIndex;
    }

    findMonitorForActor() {
        return this.primaryMonitor;
    }

    findMonitorForWindow() {
        return this.primaryMonitor;
    }

    findIndexForWindow() {
        return this.primaryIndex;
    }

    setDummyCursorGeometry() {}

    showKeyboard() {}

    hideKeyboard() {}

    get keyboardVisible() {
        return false;
    }

    _queueUpdateRegions() {}

    _updateRegions() {}

    init() {}

    connectObject(...args) {
        return GObject.Object.prototype.connectObject.call(this, ...args);
    }
});
