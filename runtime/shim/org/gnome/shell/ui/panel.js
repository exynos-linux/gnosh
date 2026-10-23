// SPDX-License-Identifier: GPL-3.0-or-later
//
// gnosh: the GNOME Shell top bar. Extension indicators added here are shown
// in Phosh's top bar (status icon area), and every indicator that has a
// menu also gets a tile in Phosh's quick settings whose status page shows
// the menu. Quick settings items (toggles, sliders) become Phosh quick
// settings tiles.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as Main from './main.js';
import * as PanelMenu from './panelMenu.js';
import * as PopupMenu from './popupMenu.js';

const bridge = () => globalThis.__gnosh?.bridge ?? null;

/**
 * A top bar box whose children are packed straight into Phosh's status
 * icon box, one Phosh revealer per indicator, so Phosh can fit and hide
 * them individually.
 */
const TopBarBox = GObject.registerClass(
class TopBarBox extends St.BoxLayout {
    get _gnoshChildContainer() {
        return bridge()?.statusBox ?? null;
    }

    _gnoshUnpack(child) {
        const box = bridge()?.statusBox;
        const w = child._outer;
        if (!w)
            return;
        if (box && w.get_parent() && w.get_parent() !== box)
            box.remove(w);
        else
            w.get_parent()?.remove(w);
    }
});

/** Placeholder for GNOME's built-in indicators that Phosh replaces. */
const BuiltinIndicator = GObject.registerClass(
class BuiltinIndicator extends PanelMenu.Button {
    _init(name, extra = {}) {
        super._init(0.5, name, true);
        this._gnoshBuiltin = true;
        Object.assign(this, extra);
    }
});

/** The quick settings menu: items become Phosh quick setting tiles. */
class QuickSettingsMenu extends PopupMenu.PopupMenu {
    constructor(sourceActor) {
        super(sourceActor, 0, St.Side.TOP);
        this._grid = new St.Widget({
            style_class: 'quick-settings-grid',
            layout_manager: new Clutter.GridLayout(),
        });
        this.box.add_child(this._grid);
        this._items = [];
    }

    addItem(item, colSpan = 1) {
        this._grid.add_child(item);
        this._completeAddItem(item, colSpan);
    }

    insertItemBefore(item, sibling, colSpan = 1) {
        this._grid.insert_child_below(item, sibling);
        this._completeAddItem(item, colSpan);
    }

    _completeAddItem(item, colSpan) {
        item._gnoshColSpan = colSpan;
        this._items.push(item);
        item.connect('destroy', () => {
            this._items = this._items.filter(i => i !== item);
        });
        if (item.menu)
            item.menu.actor.hide();
        bridge()?.addQuickSettingsItem(item);
    }

    getFirstItem() {
        return this._grid.get_first_child();
    }

    _setDimmed() {}
}

/** Main.panel.statusArea.quickSettings */
const QuickSettings = GObject.registerClass(
class QuickSettings extends PanelMenu.Button {
    _init() {
        super._init(0.0, 'System', true);
        this._indicators = new St.BoxLayout({style_class: 'panel-status-indicators-box'});
        this.add_child(this._indicators);
        this.setMenu(new QuickSettingsMenu(this));
        this._gnoshBuiltin = true;
    }

    _addItems(items, colSpan = 1) {
        items.forEach(item => this.menu.addItem(item, colSpan));
    }

    _addItemsBefore(items, sibling, colSpan = 1) {
        items.forEach(item => this.menu.insertItemBefore(item, sibling, colSpan));
    }

    addExternalIndicator(indicator, colSpan = 1) {
        this._indicators.insert_child_at_index(indicator, 0);
        this._addItems(indicator.quickSettingsItems ?? [], colSpan);
    }

    get _backgroundApps() {
        return null;
    }
});

export const Panel = GObject.registerClass(
class Panel extends St.BoxLayout {
    _init() {
        super._init({name: 'panel', style_class: 'gnosh-panel', reactive: false, y_align: Clutter.ActorAlign.CENTER});

        this._leftBox = new TopBarBox({name: 'panelLeft', style_class: 'gnosh-panel-box'});
        this._centerBox = new TopBarBox({name: 'panelCenter', style_class: 'gnosh-panel-box'});
        this._rightBox = new TopBarBox({name: 'panelRight', style_class: 'gnosh-panel-box'});
        this.add_child(this._leftBox);
        this.add_child(this._centerBox);
        this.add_child(this._rightBox);

        this.statusArea = {};
        this.menuManager = new PopupMenu.PopupMenuManager(this);

        for (const box of [this._leftBox, this._centerBox, this._rightBox]) {
            box.connect('child-added', (b, child) => this._gnoshChildAdded(child));
            box.connect('child-removed', (b, child) => this._gnoshChildRemoved(child));
        }
    }

    _gnoshCreateBuiltins() {
        const notifications = new Gio.Settings({schema_id: 'org.gnome.desktop.notifications'});
        this.statusArea.activities = new BuiltinIndicator('Activities');
        this.statusArea.appMenu = new BuiltinIndicator('App Menu');
        this.statusArea.dateMenu = new BuiltinIndicator('Date', {
            _indicator: {_settings: notifications, connect: () => 0, disconnect: () => {}},
            _clock: null,
            _date: null,
        });
        this.statusArea.a11y = new BuiltinIndicator('Accessibility');
        this.statusArea.keyboard = new BuiltinIndicator('Keyboard');
        this.statusArea.dwellClick = new BuiltinIndicator('Dwell Click');
        this.statusArea.screenRecording = new BuiltinIndicator('Screen Recording');
        this.statusArea.screenSharing = new BuiltinIndicator('Screen Sharing');
        this.statusArea.quickSettings = new QuickSettings();
        // Builtins are not shown: Phosh has its own clock and indicators.
        // Only the quick settings indicator box (extension icons) is.
        this._rightBox.add_child(this.statusArea.quickSettings.container);
    }

    _gnoshIndicatorFor(child) {
        const actor = child instanceof St.Bin && child.child ? child.child : child;
        return actor instanceof PanelMenu.ButtonBox ? actor : null;
    }

    _gnoshChildAdded(child) {
        const indicator = this._gnoshIndicatorFor(child);
        if (indicator && !indicator._gnoshBuiltin)
            bridge()?.addIndicator(indicator);
    }

    _gnoshChildRemoved(child) {
        const indicator = this._gnoshIndicatorFor(child);
        if (indicator)
            bridge()?.removeIndicator(indicator);
    }

    addToStatusArea(role, indicator, position = 0, box = 'right') {
        if (this.statusArea[role])
            throw new Error(`Extension point conflict: there is already a status indicator for role ${role}`);

        if (!(indicator instanceof PanelMenu.Button))
            throw new TypeError('Status indicator must be an instance of PanelMenu.Button');

        position ??= 0;
        const boxes = {left: this._leftBox, center: this._centerBox, right: this._rightBox};
        const boxContainer = boxes[box] || this._rightBox;
        this.statusArea[role] = indicator;
        indicator._gnoshRole = role;
        this._addToPanelBox(role, indicator, position, boxContainer);
        return indicator;
    }

    _addToPanelBox(role, indicator, position, box) {
        const container = indicator.container;
        container.show();

        const parent = container.get_parent();
        if (parent)
            parent.remove_child(container);

        box.insert_child_at_index(container, position);
        this.menuManager.addMenu(indicator.menu);
        this.statusArea[role] = indicator;
        const destroyId = indicator.connect('destroy', emitter => {
            delete this.statusArea[role];
            emitter.disconnect(destroyId);
        });
        indicator.connect('menu-set', this._onMenuSet.bind(this));
        this._onMenuSet(indicator);
    }

    _onMenuSet(indicator) {
        if (!indicator.menu || indicator.menu.hasOwnProperty('_openChangedId'))
            return;
        this.menuManager.addMenu(indicator.menu);
        indicator.menu._openChangedId = indicator.menu.connect('open-state-changed', () => {});
        bridge()?.indicatorMenuChanged(indicator);
    }

    toggleCalendar() {}

    closeCalendar() {}

    toggleQuickSettings() {
        bridge()?.unfold();
    }

    closeQuickSettings() {
        bridge()?.fold();
    }

    toggleAppMenu() {}

    get boxOpacity() {
        return 255;
    }

    set boxOpacity(v) {}
});
