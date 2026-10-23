// SPDX-License-Identifier: GPL-3.0-or-later
//
// The bridge between GNOME Shell's UI model and Phosh's widgets.
//
// gnosh runs inside the Phosh process (loaded as a GTK module), so it can
// reach Phosh's widgets through the GTK widget tree:
//  - extension indicators (PanelMenu.Button) are packed into Phosh's top
//    bar status icon box;
//  - every indicator with a menu, and every quick settings item, gets a
//    native PhoshQuickSetting tile in the quick settings drawer; menus are
//    shown in the tile's PhoshStatusPage.
// Phosh types are not introspected; they are found by GType name and
// created with GObject.Object.new_with_properties().

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk?version=3.0';

const DRAG_STATE_UNFOLDED = 1;

export function typeName(obj) {
    try {
        return GObject.type_name(obj.constructor.$gtype);
    } catch {
        return '';
    }
}

function isA(obj, name) {
    const type = GObject.type_from_name(name);
    if (!type || !obj?.constructor?.$gtype)
        return false;
    return GObject.type_is_a(obj.constructor.$gtype, type);
}

export function findWidget(name, root = null) {
    const visit = w => {
        if (isA(w, name))
            return w;
        if (w instanceof Gtk.Container) {
            for (const c of w.get_children()) {
                const r = visit(c);
                if (r)
                    return r;
            }
        }
        return null;
    };
    if (root)
        return visit(root);
    for (const w of Gtk.Window.list_toplevels()) {
        const r = visit(w);
        if (r)
            return r;
    }
    return null;
}

function findAll(name, root) {
    const out = [];
    const visit = w => {
        if (isA(w, name))
            out.push(w);
        if (w instanceof Gtk.Container)
            w.get_children().forEach(visit);
    };
    visit(root);
    return out;
}

export function phoshNew(name, props = {}) {
    const type = GObject.type_from_name(name);
    if (!type)
        throw new Error(`gnosh: Phosh type ${name} is not available`);
    return GObject.Object.new_with_properties(type, Object.keys(props), Object.values(props));
}

/** The extension whose code is calling us (from the JS stack). */
export function callerExtension(extensionManager) {
    const stack = new Error().stack ?? '';
    const re = /(?:file:\/\/)?(\/[^:\s]*\/gnome-shell\/extensions\/([^/]+)\/)/g;
    let m;
    while ((m = re.exec(stack)) !== null) {
        const ext = extensionManager?.lookup(m[2]);
        if (ext)
            return ext;
    }
    return null;
}

function menuHasSettingsItem(actor) {
    if (!actor)
        return false;
    const St = imports.gi.St;
    const re = /^(settings|preferences|extension settings|open settings)…?$/i;
    const visit = a => {
        if (a instanceof St.Label && a.visible && re.test((a.text ?? '').trim()))
            return true;
        return (a.get_children?.() ?? []).some(visit);
    };
    return visit(actor);
}

/** Find the first St.Icon in an actor tree. */
function findIcon(actor, St) {
    if (!actor)
        return null;
    if (actor instanceof St.Icon && actor.visible)
        return actor;
    for (const child of actor.get_children?.() ?? []) {
        const r = findIcon(child, St);
        if (r)
            return r;
    }
    return null;
}

function findLabelText(actor, St) {
    if (!actor)
        return null;
    if (actor instanceof St.Label && actor.visible && actor.text)
        return actor.text;
    for (const child of actor.get_children?.() ?? []) {
        const r = findLabelText(child, St);
        if (r)
            return r;
    }
    return null;
}

/**
 * One Phosh quick settings tile with an optional status page.
 */
class Tile {
    constructor(bridge, {owner, ext, label, onClick, onShowStatus, onHideStatus, page}) {
        this._bridge = bridge;
        this.owner = owner;
        this.ext = ext;
        this._qs = phoshNew('PhoshQuickSetting', {visible: true});
        this._icon = phoshNew('PhoshStatusIcon', {visible: true, 'icon-name': 'application-x-addon-symbolic', info: label ?? ''});
        this._qs.status_icon = this._icon;
        this._qs.get_style_context().add_class('gnosh-tile');
        this._ids = [];
        if (onClick)
            this._ids.push([this._qs, this._qs.connect('clicked', () => this._safe(onClick))]);
        if (onShowStatus)
            this._ids.push([this._qs, this._qs.connect('show-status', () => this._safe(onShowStatus))]);
        if (onHideStatus)
            this._ids.push([this._qs, this._qs.connect('hide-status', () => this._safe(onHideStatus))]);
        if (page)
            this.setPage(page.title, page.content, page.footer);
        bridge._qsBox.add(this._qs);
    }

    _safe(fn) {
        try {
            fn();
        } catch (e) {
            logError(e, 'gnosh: tile handler');
        }
    }

    setPage(title, contentWidget, footerWidget = null) {
        const page = phoshNew('PhoshStatusPage', {visible: true, title: title ?? ''});
        const scroller = new Gtk.ScrolledWindow({
            hscrollbar_policy: Gtk.PolicyType.NEVER,
            vscrollbar_policy: Gtk.PolicyType.AUTOMATIC,
            propagate_natural_height: true,
            max_content_height: this._bridge.maxPageHeight(),
            visible: true,
        });
        scroller.get_style_context().add_class('gnosh-status-page');
        contentWidget.get_parent()?.remove(contentWidget);
        scroller.add(contentWidget);
        page.content = scroller;
        if (footerWidget) {
            page.footer = footerWidget;
            // Hide gnosh's Settings button when the menu has its own.
            this._updateFooter = () => {
                footerWidget.visible = !menuHasSettingsItem(contentWidget._gnoshActor);
            };
            this._updateFooter();
        }
        this._page = page;
        this._content = contentWidget;
        this._ids.push([page, page.connect('done', () => this.hideStatus())]);
        this._qs.status_page = page;
        this._qs.can_show_status = true;
    }

    setIcon(gicon) {
        if (!gicon)
            return;
        if (gicon instanceof Gio.ThemedIcon) {
            const theme = Gtk.IconTheme.get_default();
            const name = gicon.get_names().find(n => theme.has_icon(n)) ?? 'application-x-addon-symbolic';
            this._icon.icon_name = name;
            return;
        }
        // PhoshStatusIcon's image accepts any GIcon through its child.
        this._icon.icon_name = null;
        const image = this._findImage(this._icon);
        image?.set_from_gicon(gicon, Gtk.IconSize.MENU);
    }

    _findImage(w) {
        if (w instanceof Gtk.Image)
            return w;
        if (w instanceof Gtk.Container) {
            for (const c of w.get_children()) {
                const r = this._findImage(c);
                if (r)
                    return r;
            }
        }
        return null;
    }

    setLabel(text) {
        this._icon.info = text ?? '';
    }

    setActive(active) {
        this._qs.active = Boolean(active);
    }

    setVisible(visible) {
        this._qs.visible = Boolean(visible);
    }

    setSensitive(sensitive) {
        this._qs.sensitive = Boolean(sensitive);
    }

    showStatus() {
        // Showing the page opens the menu, which asks to show the page.
        if (this._busy || this._destroyed)
            return;
        this._busy = true;
        try {
            this._updateFooter?.();
            this._bridge.unfold();
            if (!this._qs.showing_status)
                this._qs.emit('show-status');
        } finally {
            this._busy = false;
        }
    }

    hideStatus() {
        if (this._busy || this._destroyed)
            return;
        this._busy = true;
        try {
            if (this._qs.showing_status)
                this._qs.emit('hide-status');
        } finally {
            this._busy = false;
        }
    }

    destroy() {
        if (this._destroyed)
            return;
        this._destroyed = true;
        for (const [obj, id] of this._ids) {
            try {
                obj.disconnect(id);
            } catch {
                // already gone
            }
        }
        this._ids = [];
        if (this._content)
            this._content.get_parent()?.remove(this._content);
        try {
            this._bridge._qsBox.remove(this._qs);
        } catch {
            // Phosh may have rebuilt the box
        }
        this._qs.destroy();
    }
}

export class Bridge {
    constructor() {
        this._tiles = new Map();
        this._sliderRows = new Map();
        this.modules = {};
        this.extensionManager = null;
        this._activityTimer = 0;
    }

    /** Wait until Phosh has built its panels. */
    async waitForPhosh(timeoutMs = 60000) {
        const start = GLib.get_monotonic_time();
        for (;;) {
            this._top = findWidget('PhoshTopPanel');
            this._statusBox = this._top ? findWidget('PhoshStatusIconsBox', this._top) : null;
            this._qsBox = this._top ? findWidget('PhoshQuickSettingsBox', this._top) : null;
            if (this._top && this._statusBox && this._qsBox)
                return true;
            if ((GLib.get_monotonic_time() - start) / 1000 > timeoutMs)
                throw new Error('gnosh: Phosh widgets did not appear (is this Phosh?)');
            await new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 250, () => {
                resolve();
                return GLib.SOURCE_REMOVE;
            }));
        }
    }

    maxPageHeight() {
        const display = imports.gi.Gdk.Display.get_default();
        const monitor = display?.get_primary_monitor() ?? display?.get_monitor(0);
        const h = monitor?.get_geometry().height ?? 720;
        return Math.round(h * 0.55);
    }

    // --- top bar ---

    get statusBox() {
        return this._statusBox;
    }

    attachPanel(panel) {
        // The panel boxes pack their children into Phosh's status box
        // themselves; the panel actor only holds them.
        this._panel = panel;
        panel.show();
    }

    // --- drawer ---

    unfold() {
        if (this._top && this._top.drag_state !== DRAG_STATE_UNFOLDED)
            this._top.emit('activated');
    }

    fold() {
        if (this._top && this._top.drag_state === DRAG_STATE_UNFOLDED)
            this._top.emit('activated');
    }

    // --- indicators ---

    _St() {
        return imports.gi.St;
    }

    addIndicator(indicator) {
        if (this._tiles.has(indicator))
            return;
        const ext = callerExtension(this.extensionManager) ?? indicator._gnoshExt ?? null;
        indicator._gnoshExt = ext;
        this._ensureIndicatorTile(indicator);
        this._indicatorClickInTopBar(indicator);
    }

    _indicatorLabel(indicator) {
        const St = this._St();
        const name = indicator._gnoshExt?.metadata?.name;
        const accessible = indicator.accessible_name?.trim();
        // Accessible names are often developer identifiers ("ClipboardIndicator").
        const readable = accessible && /\s/.test(accessible) ? accessible : null;
        return readable || name || accessible || findLabelText(indicator, St) || indicator._gnoshRole || 'Extension';
    }

    _ensureIndicatorTile(indicator) {
        if (this._tiles.has(indicator))
            this.removeIndicator(indicator);
        const menu = indicator.menu;
        const hasMenu = menu && menu.actor && !menu._gnoshDummy && typeof menu.open === 'function' &&
            menu.constructor.name !== 'PopupDummyMenu';
        const tile = new Tile(this, {
            owner: indicator,
            ext: indicator._gnoshExt,
            label: this._indicatorLabel(indicator),
            onClick: () => {
                if (hasMenu)
                    menu.toggle();
                else
                    this._synthesizeClick(indicator);
            },
            onShowStatus: hasMenu ? () => menu.open() : null,
            onHideStatus: hasMenu ? () => menu.close() : null,
        });
        const entry = {tile, ids: []};
        this._tiles.set(indicator, entry);

        if (hasMenu) {
            tile.setPage(this._indicatorLabel(indicator), menu.actor._outer, this._prefsFooter(indicator._gnoshExt));
            menu.actor.show();
            entry.ids.push([menu, menu.connect('open-state-changed', (m, open) => {
                if (open)
                    tile.showStatus();
                else
                    tile.hideStatus();
            })]);
        }
        const sync = () => {
            const St = this._St();
            const icon = findIcon(indicator, St);
            if (icon)
                tile.setIcon(icon.gicon ?? (icon.icon_name ? Gio.ThemedIcon.new(icon.icon_name) : null));
            tile.setLabel(this._indicatorLabel(indicator));
            tile.setVisible(indicator.visible && indicator.container?.visible !== false);
        };
        sync();
        // Indicators change their icon/label/visibility at runtime.
        let pending = 0;
        const queueSync = () => {
            if (pending)
                return;
            pending = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 200, () => {
                pending = 0;
                if (this._tiles.get(indicator) === entry)
                    sync();
                return GLib.SOURCE_REMOVE;
            });
        };
        entry.syncTimer = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, 2, () => {
            if (this._tiles.get(indicator) !== entry)
                return GLib.SOURCE_REMOVE;
            queueSync();
            return GLib.SOURCE_CONTINUE;
        });
        entry.ids.push([indicator, indicator.connect('notify::visible', queueSync)]);
        entry.ids.push([indicator, indicator.connect('destroy', () => this.removeIndicator(indicator))]);
    }

    _prefsFooter(ext) {
        if (!ext?.hasPrefs)
            return null;
        const button = new Gtk.Button({visible: true, hexpand: true, focus_on_click: false});
        const label = new Gtk.Label({label: imports.gettext.dgettext('gnome-shell', 'Settings'), visible: true, ellipsize: 3});
        button.add(label);
        button.connect('clicked', () => {
            this.fold();
            this.extensionManager.openExtensionPrefs(ext.uuid, '', {});
        });
        return button;
    }

    _indicatorClickInTopBar(indicator) {
        // A tap on an extension indicator in the top bar opens the drawer
        // straight at the indicator's tile/status page. The indicator's
        // own gesture toggles its menu; that opens the page.
        void indicator;
    }

    _synthesizeClick(indicator) {
        const Clutter = imports.gi.Clutter;
        const ev = new Clutter.Event({type: Clutter.EventType.BUTTON_PRESS, button: 1, source: indicator});
        const rel = new Clutter.Event({type: Clutter.EventType.BUTTON_RELEASE, button: 1, source: indicator});
        indicator._gnoshDispatch('button-press-event', ev);
        indicator._gnoshDispatch('button-release-event', rel);
        for (const action of indicator.get_actions?.() ?? []) {
            if (action._gnoshRecognize)
                action._gnoshRecognize();
        }
    }

    indicatorMenuChanged(indicator) {
        if (this._tiles.has(indicator))
            this._ensureIndicatorTile(indicator);
    }

    removeIndicator(indicator) {
        const entry = this._tiles.get(indicator);
        if (!entry)
            return;
        this._tiles.delete(indicator);
        if (entry.syncTimer)
            GLib.source_remove(entry.syncTimer);
        for (const [obj, id] of entry.ids) {
            try {
                obj.disconnect(id);
            } catch {
                // already destroyed
            }
        }
        entry.tile.destroy();
    }

    // --- quick settings items ---

    addQuickSettingsItem(item) {
        if (this._tiles.has(item))
            return;
        const ext = callerExtension(this.extensionManager);
        item._gnoshExt = ext;
        const QuickSettings = this.modules.QuickSettings;
        if (QuickSettings && item instanceof QuickSettings.QuickSlider) {
            this._addSliderItem(item);
            return;
        }
        const isToggle = QuickSettings && (item instanceof QuickSettings.QuickToggle ||
            item instanceof QuickSettings.QuickMenuToggle);
        const menu = item.menu ?? null;
        const titleOf = () => item.title || item._title?.text || ext?.metadata?.name || 'Extension';
        const tile = new Tile(this, {
            owner: item,
            ext,
            label: titleOf(),
            onClick: () => {
                if (isToggle || item instanceof imports.gi.St.Button) {
                    item._gnoshClicked ? item._gnoshClicked(1) : item.emit('clicked', 1);
                } else if (menu) {
                    menu.toggle();
                }
            },
            onShowStatus: menu ? () => menu.open() : null,
            onHideStatus: menu ? () => menu.close() : null,
        });
        const entry = {tile, ids: []};
        this._tiles.set(item, entry);
        if (menu) {
            // QuickToggleMenu animates its own height; show it fully.
            menu.actor.height = -1;
            menu.actor.show();
            tile.setPage(titleOf(), menu.actor._outer, this._prefsFooter(ext));
            entry.ids.push([menu, menu.connect('open-state-changed', (m, open) => {
                menu.actor.height = -1;
                menu.actor.show();
                if (open)
                    tile.showStatus();
                else
                    tile.hideStatus();
            })]);
        } else if (!isToggle) {
            // A custom quick settings widget: show the widget itself.
            const holder = new imports.gi.St.BoxLayout({vertical: true});
            item.get_parent()?.remove_child(item);
            holder.add_child(item);
            tile.setPage(titleOf(), holder._outer, this._prefsFooter(ext));
            entry.holder = holder;
        }
        const sync = () => {
            tile.setLabel(item.subtitle ? `${titleOf()} · ${item.subtitle}` : titleOf());
            const gicon = item.gicon ?? (item.icon_name || item.iconName
                ? Gio.ThemedIcon.new(item.icon_name ?? item.iconName) : null);
            if (gicon)
                tile.setIcon(gicon);
            tile.setActive(item.checked);
            tile.setVisible(item.visible);
            tile.setSensitive(item.reactive !== false);
        };
        sync();
        for (const prop of ['checked', 'title', 'subtitle', 'gicon', 'icon-name', 'visible', 'reactive'])
            entry.ids.push([item, item.connect(`notify::${prop}`, sync)]);
        entry.ids.push([item, item.connect('destroy', () => this.removeIndicator(item))]);
    }

    _addSliderItem(item) {
        // Sliders get a tile whose status page holds the slider.
        const ext = item._gnoshExt;
        const St = this._St();
        const box = new St.BoxLayout({vertical: true, style_class: 'gnosh-slider-page'});
        const label = ext?.metadata?.name ?? 'Slider';
        const iconName = item.icon_name ?? item.iconName;
        const tile = new Tile(this, {
            owner: item,
            ext,
            label,
            onClick: () => tile.showStatus(),
        });
        item.get_parent()?.remove_child(item);
        box.add_child(item);
        tile.setPage(label, box._outer, this._prefsFooter(ext));
        if (item.gicon || iconName)
            tile.setIcon(item.gicon ?? Gio.ThemedIcon.new(iconName));
        const entry = {tile, ids: [], holder: box};
        this._tiles.set(item, entry);
        entry.ids.push([item, item.connect('notify::visible', () => tile.setVisible(item.visible))]);
        entry.ids.push([item, item.connect('destroy', () => this.removeIndicator(item))]);
    }

    /** Open the drawer at the tile of an extension (tests, `gnosh show`). */
    showExtension(uuid) {
        for (const [owner, entry] of this._tiles) {
            if (entry.tile.ext?.uuid === uuid || owner._gnoshExt?.uuid === uuid) {
                entry.tile.showStatus();
                return true;
            }
        }
        return false;
    }

    listTiles() {
        return [...this._tiles.values()].map(e => ({
            uuid: e.tile.ext?.uuid ?? null,
            label: e.tile._icon.info,
            iconName: e.tile._icon.icon_name,
            active: e.tile._qs.active,
            visible: e.tile._qs.visible,
            hasPage: Boolean(e.tile._page),
        }));
    }

    // --- lock state and windows ---

    watchLockState(onChange) {
        const update = active => onChange(Boolean(active));
        Gio.DBus.session.signal_subscribe(null, 'org.gnome.ScreenSaver', 'ActiveChanged', '/org/gnome/ScreenSaver',
            null, Gio.DBusSignalFlags.NONE, (c, s, p, i, n, params) => update(params.deepUnpack()[0]));
        Gio.DBus.session.call('org.gnome.ScreenSaver', '/org/gnome/ScreenSaver', 'org.gnome.ScreenSaver',
            'GetActive', null, new GLib.VariantType('(b)'), Gio.DBusCallFlags.NONE, -1, null, (conn, res) => {
                try {
                    update(conn.call_finish(res).deepUnpack()[0]);
                } catch {
                    // Phosh not exporting the screensaver API yet
                }
            });
    }

    watchActivities(display) {
        const scan = () => {
            const overview = findWidget('PhoshOverview');
            const activities = overview ? findAll('PhoshActivity', overview) : [];
            display._gnoshSetActivities(activities);
            return GLib.SOURCE_CONTINUE;
        };
        scan();
        this._activityTimer = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, 2, scan);
    }
}
