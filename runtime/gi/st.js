// SPDX-License-Identifier: GPL-3.0-or-later
//
// St (Shell Toolkit) emulation on GTK 3: St.Widget and its subclasses,
// theming helpers, clipboard, settings and icon/texture helpers.

import Gdk from 'gi://Gdk?version=3.0';
import GdkPixbuf from 'gi://GdkPixbuf';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk?version=3.0';
import Pango from 'gi://Pango';

import {Actor, Event, P, installAccessors, makeProperties, warnOnce} from './actor.js';
import {Text} from './text.js';
import {Color} from './color.js';
import {Clutter as CE, St as SE} from './enums.js';
import * as Style from './style.js';

const PSEUDO_STATE = {
    hover: Gtk.StateFlags.PRELIGHT,
    active: Gtk.StateFlags.ACTIVE,
    checked: Gtk.StateFlags.CHECKED,
    focus: Gtk.StateFlags.FOCUSED,
    insensitive: Gtk.StateFlags.INSENSITIVE,
    selected: Gtk.StateFlags.SELECTED,
    highlighted: Gtk.StateFlags.SELECTED,
};

// Icon sizes GNOME Shell's theme gives these classes.
const CLASS_ICON_SIZES = {
    'system-status-icon': 16,
    'popup-menu-icon': 16,
    'popup-menu-arrow': 16,
    'popup-menu-ornament': 16,
    'quick-toggle-icon': 16,
    'quick-toggle-arrow': 16,
    'quick-menu-toggle-arrow': 16,
    'panel-icon': 16,
    'message-icon': 32,
};
const DEFAULT_ICON_SIZE = 16;

// Icons from GNOME Shell's own theme that the Adwaita icon theme lacks.
const ICON_ALIASES = {
    'ornament-check-symbolic': 'object-select-symbolic',
    'ornament-dot-checked-symbolic': 'media-record-symbolic',
    'ornament-dot-unchecked-symbolic': null,
    'ornament-check-unchecked-symbolic': null,
    'shell-network-offline-symbolic': 'network-offline-symbolic',
    'toggle-on-symbolic': 'object-select-symbolic',
};

function aliasIcon(name) {
    return name in ICON_ALIASES ? ICON_ALIASES[name] : name;
}

// --- ThemeNode ---------------------------------------------------------------

function rgbaToColor(rgba) {
    return new Color({
        red: Math.round(rgba.red * 255), green: Math.round(rgba.green * 255),
        blue: Math.round(rgba.blue * 255), alpha: Math.round(rgba.alpha * 255),
    });
}

export class ThemeNode {
    constructor(widget) {
        this._widget = widget;
    }

    get _ctx() {
        return this._widget._gnoshInner?.get_style_context() ?? null;
    }

    get _state() {
        return this._ctx?.get_state() ?? Gtk.StateFlags.NORMAL;
    }

    _st(prop) {
        return this._widget._gnoshStProps?.()[prop];
    }

    lookup_length(prop) {
        const v = Style.parseLength(this._st(prop));
        return v === null ? [false, 0] : [true, v];
    }

    get_length(prop) {
        const [, v] = this.lookup_length(prop);
        return v;
    }

    lookup_double(prop) {
        const v = parseFloat(this._st(prop));
        return Number.isNaN(v) ? [false, 0] : [true, v];
    }

    get_double(prop) {
        return this.lookup_double(prop)[1];
    }

    lookup_color(prop) {
        const ctx = this._ctx;
        if (!ctx)
            return [false, new Color()];
        if (prop === 'color')
            return [true, rgbaToColor(ctx.get_color(this._state))];
        const st = this._st(prop);
        if (st) {
            const rgba = new Gdk.RGBA();
            if (rgba.parse(st))
                return [true, rgbaToColor(rgba)];
        }
        if (prop === 'background-color') {
            // eslint-disable-next-line no-restricted-syntax
            const bg = ctx.get_property('background-color', this._state);
            if (bg instanceof Gdk.RGBA)
                return [true, rgbaToColor(bg)];
        }
        return [false, new Color()];
    }

    get_color(prop) {
        return this.lookup_color(prop)[1];
    }

    get_foreground_color() {
        return this.get_color('color');
    }

    get_background_color() {
        return this.get_color('background-color');
    }

    get_border_color() {
        return this.get_color('border-color');
    }

    get_icon_colors() {
        const fg = this.get_foreground_color();
        return {foreground: fg, warning: fg, error: fg, success: fg, accent: fg};
    }

    get_icon_style() {
        return SE.IconStyle.REQUESTED;
    }

    get_font() {
        const ctx = this._ctx;
        if (!ctx)
            return Pango.FontDescription.from_string('Sans 11');
        try {
            // eslint-disable-next-line no-restricted-syntax
            return ctx.get_property('font', this._state);
        } catch {
            return Pango.FontDescription.from_string('Sans 11');
        }
    }

    get_font_features() {
        return null;
    }

    _border(fn, side) {
        const ctx = this._ctx;
        if (!ctx)
            return 0;
        const b = ctx[fn](this._state);
        return [b.top, b.right, b.bottom, b.left][side] ?? 0;
    }

    get_padding(side) {
        return this._border('get_padding', side);
    }

    get_margin(side) {
        return this._border('get_margin', side);
    }

    get_border_width(side) {
        return this._border('get_border', side);
    }

    get_border_radius() {
        return 0;
    }

    get_horizontal_padding() {
        return this.get_padding(SE.Side.LEFT) + this.get_padding(SE.Side.RIGHT);
    }

    get_vertical_padding() {
        return this.get_padding(SE.Side.TOP) + this.get_padding(SE.Side.BOTTOM);
    }

    get_width() {
        return Style.parseLength(this._st('width')) ?? -1;
    }

    get_height() {
        return Style.parseLength(this._st('height')) ?? -1;
    }

    get_min_width() {
        return Style.parseLength(this._st('min-width')) ?? -1;
    }

    get_min_height() {
        return Style.parseLength(this._st('min-height')) ?? -1;
    }

    get_max_width() {
        return Style.parseLength(this._st('max-width')) ?? -1;
    }

    get_max_height() {
        return Style.parseLength(this._st('max-height')) ?? -1;
    }

    get_transition_duration() {
        return 0;
    }

    get_text_align() {
        return SE.TextAlign.LEFT;
    }

    get_text_decoration() {
        return 0;
    }

    get_text_shadow() {
        return null;
    }

    get_box_shadow() {
        return null;
    }

    get_background_image() {
        return null;
    }

    get_background_gradient() {
        return [SE.GradientType.NONE, new Color(), new Color()];
    }

    get_outline_color() {
        return new Color();
    }

    get_outline_width() {
        return 0;
    }

    get_element_classes() {
        return this._widget.get_style_class_name()?.split(/\s+/).filter(Boolean) ?? [];
    }

    get_pseudo_classes() {
        return this._widget.get_style_pseudo_class()?.split(/\s+/).filter(Boolean) ?? [];
    }

    get_element_id() {
        return this._widget.name;
    }

    get_parent() {
        const p = this._widget.get_parent?.();
        return p?.get_theme_node ? p.get_theme_node() : null;
    }

    get_theme() {
        return ThemeContext.get_for_stage(null).get_theme();
    }

    adjust_for_height(h) {
        return h;
    }

    adjust_for_width(w) {
        return w;
    }

    adjust_preferred_width(min, nat) {
        return [min, nat];
    }

    adjust_preferred_height(min, nat) {
        return [min, nat];
    }

    get_content_box(box) {
        return box;
    }

    get_paint_box(box) {
        return box;
    }

    equal(other) {
        return other === this;
    }

    paint_equal(other) {
        return other === this;
    }
}

// --- Widget ------------------------------------------------------------------

const WIDGET_PROPERTIES = {
    'style-class': P.string(null),
    'style': P.string(null),
    'pseudo-class': P.string(null),
    'track-hover': P.bool(false),
    'hover': P.bool(false),
    'can-focus': P.bool(false),
    'label-actor': P.object(Actor),
    'important': P.bool(false),
};

export const Widget = GObject.registerClass({
    GTypeName: 'GnoshStWidget',
    Properties: makeProperties(WIDGET_PROPERTIES),
    Signals: {
        'style-changed': {},
        'popup-menu': {},
    },
}, class Widget extends Actor {
    _propChanged(key, value) {
        super._propChanged(key, value);
        if (!this._gnoshInner)
            return;
        switch (key) {
        case 'style_class':
            this._gnoshSyncClasses();
            break;
        case 'pseudo_class':
            this._gnoshSyncPseudo();
            break;
        case 'style':
            this._gnoshApplyCss();
            break;
        case 'can_focus':
            (this._gnoshFocusWidget ?? this._gnoshOuter).can_focus = value;
            break;
        case 'hover':
            this._gnoshSetPseudo('hover', value);
            break;
        }
    }

    _gnoshSyncClasses() {
        const ctx = this._gnoshInner.get_style_context();
        const wanted = new Set((this._gnoshP.style_class ?? '').split(/\s+/).filter(Boolean));
        for (const cls of this._gnoshAppliedClasses ?? []) {
            if (!wanted.has(cls))
                ctx.remove_class(cls);
        }
        for (const cls of wanted)
            ctx.add_class(cls);
        this._gnoshAppliedClasses = wanted;
        this._gnoshApplyCss();
    }

    _gnoshSyncPseudo() {
        const wanted = new Set((this._gnoshP.pseudo_class ?? '').split(/\s+/).filter(Boolean));
        let flags = 0;
        for (const p of wanted)
            flags |= PSEUDO_STATE[p] ?? 0;
        const mask = Object.values(PSEUDO_STATE).reduce((a, b) => a | b, 0);
        this._gnoshInner.unset_state_flags(mask & ~flags & ~Gtk.StateFlags.INSENSITIVE);
        if (flags)
            this._gnoshInner.set_state_flags(flags & ~Gtk.StateFlags.INSENSITIVE, false);
        this.emit('style-changed');
    }

    /** St-only properties from the inline style and loaded stylesheets. */
    _gnoshStProps() {
        const classes = (this._gnoshP.style_class ?? '').split(/\s+/).filter(Boolean);
        const out = Style.lookupStProperties(classes);
        const {st} = Style.splitDeclarations(Style.parseDeclarations(this._gnoshP.style));
        return Object.assign(out, st);
    }

    _gnoshApplyCss() {
        if (!this._gnoshInner)
            return;
        const decls = Style.parseDeclarations(this._gnoshP.style);
        const {css} = Style.splitDeclarations(decls);
        const extra = Object.values(this._gnoshExtraCssSlots ?? {}).join(' ');
        this._gnoshCssState ??= {};
        Style.setWidgetCss(this._gnoshInner, `${css} ${extra}`.trim(), this._gnoshCssState);
        this._gnoshApplyStProps(this._gnoshStProps());
        this.emit('style-changed');
        this.vfunc_style_changed();
    }

    /** Apply St-only properties (spacing, icon-size, ...). Subclasses extend. */
    _gnoshApplyStProps(st) {
        if ('spacing' in st && this._gnoshInner instanceof Gtk.Box) {
            const s = Style.parseLength(st.spacing);
            if (s !== null)
                this._gnoshInner.spacing = s;
        }
        if (('width' in st || 'height' in st) && (this._gnoshP.width ?? -1) < 0 && (this._gnoshP.height ?? -1) < 0) {
            const w = Style.parseLength(st.width) ?? -1;
            const h = Style.parseLength(st.height) ?? -1;
            this._gnoshOuter.set_size_request(w, h);
        }
    }

    _gnoshHoverChanged(inside) {
        if (this._gnoshP.track_hover)
            this.hover = inside;
    }

    _gnoshSetPseudo(name, on) {
        const set = new Set((this._gnoshP.pseudo_class ?? '').split(/\s+/).filter(Boolean));
        if (on)
            set.add(name);
        else
            set.delete(name);
        this.pseudo_class = [...set].join(' ') || null;
    }

    vfunc_style_changed() {}

    vfunc_navigate_focus(from, direction) {
        return this._gnoshNavigateFocus(from, direction);
    }

    vfunc_popup_menu() {}

    vfunc_get_focus_chain() {
        return this.get_children().filter(c => c.visible);
    }

    // --- St.Widget API ---

    get_style_class_name() {
        return this._gnoshP.style_class ?? null;
    }

    set_style_class_name(name) {
        this.style_class = name;
    }

    add_style_class_name(name) {
        const set = new Set((this._gnoshP.style_class ?? '').split(/\s+/).filter(Boolean));
        for (const n of String(name).split(/\s+/).filter(Boolean))
            set.add(n);
        this.style_class = [...set].join(' ');
    }

    remove_style_class_name(name) {
        const remove = new Set(String(name).split(/\s+/));
        const kept = (this._gnoshP.style_class ?? '').split(/\s+/).filter(c => c && !remove.has(c));
        this.style_class = kept.join(' ') || null;
    }

    has_style_class_name(name) {
        return (this._gnoshP.style_class ?? '').split(/\s+/).includes(name);
    }

    get_style_pseudo_class() {
        return this._gnoshP.pseudo_class ?? null;
    }

    set_style_pseudo_class(p) {
        this.pseudo_class = p;
    }

    add_style_pseudo_class(name) {
        this._gnoshSetPseudo(name, true);
    }

    remove_style_pseudo_class(name) {
        this._gnoshSetPseudo(name, false);
    }

    has_style_pseudo_class(name) {
        return (this._gnoshP.pseudo_class ?? '').split(/\s+/).includes(name);
    }

    get_style() {
        return this._gnoshP.style ?? null;
    }

    set_style(style) {
        this.style = style;
    }

    get_theme_node() {
        this._gnoshThemeNode ??= new ThemeNode(this);
        return this._gnoshThemeNode;
    }

    peek_theme_node() {
        return this.get_theme_node();
    }

    ensure_style() {}

    style_changed() {
        this._gnoshApplyCss();
    }

    get_track_hover() {
        return this.track_hover;
    }

    set_track_hover(v) {
        this.track_hover = v;
    }

    get_hover() {
        return this.hover;
    }

    set_hover(v) {
        this.hover = v;
    }

    sync_hover() {}

    get_can_focus() {
        return this.can_focus;
    }

    set_can_focus(v) {
        this.can_focus = v;
    }

    get_label_actor() {
        return this.label_actor;
    }

    set_label_actor(a) {
        this.label_actor = a;
    }

    navigate_focus(from, direction, wrap) {
        return this.vfunc_navigate_focus(from, direction, wrap);
    }

    _gnoshNavigateFocus() {
        const focusable = [];
        const walk = a => {
            for (const c of a.get_children()) {
                if (!c.visible)
                    continue;
                if (c.can_focus)
                    focusable.push(c);
                walk(c);
            }
        };
        walk(this);
        if (this.can_focus && focusable.length === 0) {
            this.grab_key_focus();
            return true;
        }
        if (focusable.length) {
            focusable[0].grab_key_focus();
            return true;
        }
        return false;
    }

    get_focus_chain() {
        return this.vfunc_get_focus_chain();
    }

    popup_menu() {
        this.emit('popup-menu');
    }

    paint_background() {}

    get_background_image() {
        return null;
    }

    get_resource_scale() {
        return this._gnoshOuter?.get_scale_factor() ?? 1;
    }

    set_important(v) {
        this.important = v;
    }

    set_offscreen_redirect() {}
});
installAccessors(Widget, WIDGET_PROPERTIES);

// --- BoxLayout ---------------------------------------------------------------

const BOX_PROPERTIES = {
    'vertical': P.bool(false),
    'orientation': P.int(CE.Orientation.HORIZONTAL),
    'pack-start': P.bool(false),
};

export const BoxLayout = GObject.registerClass({
    GTypeName: 'GnoshStBoxLayout',
    Properties: makeProperties(BOX_PROPERTIES),
}, class BoxLayout extends Widget {
    get _gnoshDefaultKind() {
        return 'box';
    }

    _gnoshCreateContainer() {
        if (this._gnoshP.layout_manager && this._gnoshP.layout_manager._gnoshKind !== 'box')
            return super._gnoshCreateContainer();
        return new Gtk.Box({orientation: this._gnoshVertical() ? Gtk.Orientation.VERTICAL : Gtk.Orientation.HORIZONTAL});
    }

    _gnoshVertical() {
        return this._gnoshP.vertical || this._gnoshP.orientation === CE.Orientation.VERTICAL;
    }

    _propChanged(key, value) {
        if (key === 'vertical' && this._gnoshP.orientation !== (value ? 1 : 0))
            this._gnoshP.orientation = value ? CE.Orientation.VERTICAL : CE.Orientation.HORIZONTAL;
        else if (key === 'orientation')
            this._gnoshP.vertical = value === CE.Orientation.VERTICAL;
        super._propChanged(key, value);
        if ((key === 'vertical' || key === 'orientation') && this._gnoshInner instanceof Gtk.Box)
            this._gnoshInner.orientation = this._gnoshVertical() ? Gtk.Orientation.VERTICAL : Gtk.Orientation.HORIZONTAL;
    }

    get_vertical() {
        return this._gnoshVertical();
    }

    set_vertical(v) {
        this.vertical = v;
    }

    get_orientation() {
        return this._gnoshVertical() ? CE.Orientation.VERTICAL : CE.Orientation.HORIZONTAL;
    }

    set_orientation(o) {
        this.orientation = o;
    }

    set_pack_start(v) {
        this.pack_start = v;
    }

    // St.BoxLayout.add() was removed in GNOME 46 but older code still calls it.
    add(child, props = {}) {
        this.add_child(child);
        for (const [k, v] of Object.entries(props ?? {})) {
            if (k === 'expand')
                child[this._gnoshVertical() ? 'y_expand' : 'x_expand'] = v;
            else if (k === 'x_fill' || k === 'y_fill')
                continue;
            else if (k in child)
                child[k] = v;
        }
    }
});
installAccessors(BoxLayout, BOX_PROPERTIES);

export const Viewport = GObject.registerClass({
    GTypeName: 'GnoshStViewport',
}, class Viewport extends BoxLayout {});

// --- Bin ---------------------------------------------------------------------

const BIN_PROPERTIES = {
    'child': P.object(Actor),
    'x-fill': P.bool(true),
    'y-fill': P.bool(true),
};

export const Bin = GObject.registerClass({
    GTypeName: 'GnoshStBin',
    Properties: makeProperties(BIN_PROPERTIES),
}, class Bin extends Widget {
    get _gnoshDefaultKind() {
        return 'bin';
    }

    _propChanged(key, value) {
        super._propChanged(key, value);
        if (key === 'child' && this._gnoshOuter)
            this._gnoshSetChild(value);
    }

    _gnoshSyncAll() {
        const child = this._gnoshP.child;
        delete this._gnoshP.child;
        super._gnoshSyncAll();
        if (child)
            this._gnoshSetChild(child);
        this._gnoshP.child = child ?? null;
    }

    _gnoshSetChild(child) {
        for (const c of this.get_children()) {
            if (c !== child)
                this.remove_child(c);
        }
        if (child && child.get_parent() !== this)
            this.add_child(child);
    }

    remove_child(child) {
        super.remove_child(child);
        if (this._gnoshP.child === child) {
            this._gnoshP.child = null;
            this.notify('child');
        }
    }

    add_child(child) {
        super.add_child(child);
        if (this._gnoshP.child !== child) {
            this._gnoshP.child = child;
            this.notify('child');
        }
    }

    set_child(child) {
        this.child = child;
    }

    get_child() {
        return this._gnoshP.child ?? null;
    }
});
installAccessors(Bin, BIN_PROPERTIES);

// --- Label -------------------------------------------------------------------

export const Label = GObject.registerClass({
    GTypeName: 'GnoshStLabel',
    Properties: makeProperties({'text': P.string(null), 'clutter-text': P.object(Actor, GObject.ParamFlags.READABLE)}),
}, class Label extends Widget {
    _gnoshCreateInner() {
        const label = new Gtk.Label({xalign: 0, yalign: 0.5, ellipsize: Pango.EllipsizeMode.END, single_line_mode: false});
        this._gnoshClutterText = new Text({_gnoshWidget: label});
        this._gnoshClutterText._gnoshOwner = this;
        return label;
    }

    get _gnoshIsContainerActor() {
        return false;
    }

    _propChanged(key, value) {
        super._propChanged(key, value);
        if (key === 'text' && this._gnoshInner) {
            this._gnoshClutterText.set_text(value ?? '');
        }
    }

    get text() {
        return this._gnoshInner ? this._gnoshInner.get_text() : this._gnoshP.text ?? '';
    }

    set text(value) {
        this._gnoshP.text = value;
        this._propChanged('text', value);
        if (this._gnoshConstructed)
            this.notify('text');
    }

    get clutter_text() {
        return this._gnoshClutterText;
    }

    get clutterText() {
        return this._gnoshClutterText;
    }

    get_text() {
        return this.text;
    }

    set_text(text) {
        this.text = text;
    }

    get_clutter_text() {
        return this._gnoshClutterText;
    }

    _gnoshApplyStProps(st) {
        super._gnoshApplyStProps(st);
        if (st['text-align']) {
            const map = {left: 0, center: 0.5, right: 1};
            if (st['text-align'] in map)
                this._gnoshInner.xalign = map[st['text-align']];
        }
    }
});

// --- Icon --------------------------------------------------------------------

const ICON_PROPERTIES = {
    'icon-name': P.string(null),
    'gicon': P.object(GObject.Object),
    'fallback-icon-name': P.string(null),
    'fallback-gicon': P.object(Gio.Icon),
    'icon-size': P.int(-1),
    'is-symbolic': P.bool(false, GObject.ParamFlags.READABLE),
};

export const Icon = GObject.registerClass({
    GTypeName: 'GnoshStIcon',
    Properties: makeProperties(ICON_PROPERTIES),
}, class Icon extends Widget {
    _gnoshCreateInner() {
        return new Gtk.Image();
    }

    get _gnoshIsContainerActor() {
        return false;
    }

    _propChanged(key, value) {
        super._propChanged(key, value);
        if (this._gnoshInner && ['icon_name', 'gicon', 'fallback_icon_name', 'fallback_gicon', 'icon_size', 'content'].includes(key))
            this._gnoshUpdateIcon();
    }

    _gnoshApplyStProps(st) {
        super._gnoshApplyStProps(st);
        this._gnoshUpdateIcon();
    }

    _gnoshPixelSize() {
        if ((this._gnoshP.icon_size ?? -1) > 0)
            return this._gnoshP.icon_size;
        const st = this._gnoshStProps();
        const fromCss = Style.parseLength(st['icon-size']);
        if (fromCss)
            return fromCss;
        for (const cls of (this._gnoshP.style_class ?? '').split(/\s+/)) {
            if (CLASS_ICON_SIZES[cls])
                return CLASS_ICON_SIZES[cls];
        }
        return DEFAULT_ICON_SIZE;
    }

    _gnoshResolveGIcon() {
        const theme = Gtk.IconTheme.get_default();
        const candidates = [];
        if (this._gnoshP.gicon)
            candidates.push(this._gnoshP.gicon);
        if (this._gnoshP.icon_name && aliasIcon(this._gnoshP.icon_name))
            candidates.push(Gio.ThemedIcon.new_with_default_fallbacks(aliasIcon(this._gnoshP.icon_name)));
        if (this._gnoshP.fallback_gicon)
            candidates.push(this._gnoshP.fallback_gicon);
        if (this._gnoshP.fallback_icon_name)
            candidates.push(Gio.ThemedIcon.new(this._gnoshP.fallback_icon_name));
        for (const icon of candidates) {
            if (icon instanceof ImageContent)
                return icon;
            if (!(icon instanceof Gio.ThemedIcon))
                return icon;
            if (theme.lookup_by_gicon(icon, this._gnoshPixelSize(), 0))
                return icon;
        }
        return candidates[0] ?? null;
    }

    _gnoshUpdateIcon() {
        const image = this._gnoshInner;
        const size = this._gnoshPixelSize();
        const icon = this._gnoshResolveGIcon();
        image.pixel_size = size;
        if (!icon) {
            image.clear();
            return;
        }
        if (icon instanceof ImageContent) {
            const pixbuf = icon._gnoshPixbuf(size);
            if (pixbuf)
                image.set_from_pixbuf(pixbuf);
            else
                image.clear();
            return;
        }
        image.set_from_gicon(icon, Gtk.IconSize.BUTTON);
        image.pixel_size = size;
        const names = icon instanceof Gio.ThemedIcon ? icon.get_names() : [];
        this._gnoshP.is_symbolic = names.some(n => n.endsWith('-symbolic'));
    }

    get gicon() {
        return this._gnoshP.gicon ?? null;
    }

    set gicon(value) {
        this._gnoshP.gicon = value;
        this._propChanged('gicon', value);
        if (this._gnoshConstructed)
            this.notify('gicon');
    }

    get_icon_name() {
        return this.icon_name;
    }

    set_icon_name(n) {
        this.icon_name = n;
    }

    get_gicon() {
        return this.gicon;
    }

    set_gicon(g) {
        this.gicon = g;
    }

    get_icon_size() {
        return this.icon_size;
    }

    set_icon_size(s) {
        this.icon_size = s;
    }

    get_fallback_icon_name() {
        return this.fallback_icon_name;
    }

    set_fallback_icon_name(n) {
        this.fallback_icon_name = n;
    }

    get_fallback_gicon() {
        return this.fallback_gicon;
    }

    set_fallback_gicon(g) {
        this.fallback_gicon = g;
    }

    update() {
        this._gnoshUpdateIcon();
    }
});
// gicon accepts any GIcon-ish object (also St.ImageContent), so it keeps the
// hand-written accessor instead of a generated one.
installAccessors(Icon, Object.fromEntries(Object.entries(ICON_PROPERTIES).filter(([k]) => k !== 'gicon')));

// --- Button ------------------------------------------------------------------

const BUTTON_PROPERTIES = {
    'label': P.string(null),
    'icon-name': P.string(null),
    'button-mask': P.int(SE.ButtonMask.ONE),
    'toggle-mode': P.bool(false),
    'checked': P.bool(false),
    'pressed': P.bool(false),
};

export const Button = GObject.registerClass({
    GTypeName: 'GnoshStButton',
    Properties: makeProperties(BUTTON_PROPERTIES),
    Signals: {'clicked': {param_types: [GObject.TYPE_INT]}},
}, class Button extends Bin {
    _init(params = {}) {
        super._init({reactive: true, can_focus: true, ...params});
    }

    _gnoshCreateInner() {
        const button = new Gtk.Button({relief: Gtk.ReliefStyle.NONE, focus_on_click: false});
        button.connect('clicked', () => this._gnoshClicked(1));
        button.connect('button-press-event', (w, ev) => this._gnoshGtkEvent('button-press-event', ev));
        button.connect('button-release-event', (w, ev) => this._gnoshGtkEvent('button-release-event', ev));
        button.connect('enter-notify-event', (w, ev) => this._gnoshCrossing(true, ev));
        button.connect('leave-notify-event', (w, ev) => this._gnoshCrossing(false, ev));
        this._gnoshFocusWidget = button;
        return button;
    }

    get _gnoshIsContainerActor() {
        return false;
    }

    get _gnoshChildContainer() {
        return this._gnoshInner;
    }

    _gnoshClicked(button) {
        if (this._gnoshDestroyed || !this._gnoshP.reactive)
            return;
        if (this._gnoshP.toggle_mode)
            this.checked = !this._gnoshP.checked;
        this.emit('clicked', button);
    }

    _propChanged(key, value) {
        super._propChanged(key, value);
        if (!this._gnoshInner)
            return;
        switch (key) {
        case 'label':
            if (value !== null && value !== undefined)
                this.child = new Label({text: value, y_align: CE.ActorAlign.CENTER});
            break;
        case 'icon_name':
            if (value)
                this.child = new Icon({icon_name: value});
            break;
        case 'checked':
            this._gnoshSetPseudo('checked', value);
            break;
        case 'reactive':
            this._gnoshInner.sensitive = true;
            break;
        }
    }

    get_label() {
        return this.label;
    }

    set_label(l) {
        this.label = l;
    }

    get_icon_name() {
        return this.icon_name;
    }

    set_icon_name(n) {
        this.icon_name = n;
    }

    get_toggle_mode() {
        return this.toggle_mode;
    }

    set_toggle_mode(v) {
        this.toggle_mode = v;
    }

    get_checked() {
        return this.checked;
    }

    set_checked(v) {
        this.checked = v;
    }

    get_button_mask() {
        return this.button_mask;
    }

    set_button_mask(m) {
        this.button_mask = m;
    }

    fake_release() {}
});
installAccessors(Button, BUTTON_PROPERTIES);

// --- Entry -------------------------------------------------------------------

const ENTRY_PROPERTIES = {
    'hint-text': P.string(null),
    'hint-actor': P.object(Actor),
    'primary-icon': P.object(Actor),
    'secondary-icon': P.object(Actor),
    'input-purpose': P.int(0),
    'input-hints': P.int(0),
};

export const Entry = GObject.registerClass({
    GTypeName: 'GnoshStEntry',
    Properties: makeProperties({...ENTRY_PROPERTIES, 'text': P.string(null),
        'clutter-text': P.object(Actor, GObject.ParamFlags.READABLE)}),
    Signals: {'primary-icon-clicked': {}, 'secondary-icon-clicked': {}},
}, class Entry extends Widget {
    _init(params = {}) {
        super._init({reactive: true, can_focus: true, ...params});
    }

    _gnoshCreateInner() {
        const entry = new Gtk.Entry({hexpand: true});
        this._gnoshClutterText = new Text({_gnoshWidget: entry, editable: true, reactive: true});
        this._gnoshClutterText._gnoshOwner = this;
        entry.connect('icon-press', (w, pos) => this.emit(pos === Gtk.EntryIconPosition.PRIMARY
            ? 'primary-icon-clicked' : 'secondary-icon-clicked'));
        this._gnoshFocusWidget = entry;
        return entry;
    }

    get _gnoshIsContainerActor() {
        return false;
    }

    _propChanged(key, value) {
        super._propChanged(key, value);
        if (!this._gnoshInner)
            return;
        switch (key) {
        case 'text':
            this._gnoshInner.set_text(value ?? '');
            break;
        case 'hint_text':
            this._gnoshInner.placeholder_text = value ?? '';
            break;
        case 'hint_actor':
            if (value?.text)
                this._gnoshInner.placeholder_text = value.text;
            break;
        case 'primary_icon':
        case 'secondary_icon': {
            const pos = key === 'primary_icon' ? Gtk.EntryIconPosition.PRIMARY : Gtk.EntryIconPosition.SECONDARY;
            const gicon = value?.gicon ?? (value?.icon_name ? Gio.ThemedIcon.new(value.icon_name) : null);
            this._gnoshInner.set_icon_from_gicon(pos, gicon);
            break;
        }
        case 'input_purpose':
            this._gnoshInner.input_purpose = Math.min(value, 9);
            break;
        }
    }

    get text() {
        return this._gnoshInner ? this._gnoshInner.get_text() : this._gnoshP.text ?? '';
    }

    set text(v) {
        this._gnoshP.text = v;
        this._propChanged('text', v);
        if (this._gnoshConstructed)
            this.notify('text');
    }

    get clutter_text() {
        return this._gnoshClutterText;
    }

    get clutterText() {
        return this._gnoshClutterText;
    }

    get_text() {
        return this.text;
    }

    set_text(t) {
        this.text = t;
    }

    get_clutter_text() {
        return this._gnoshClutterText;
    }

    get_hint_text() {
        return this.hint_text;
    }

    set_hint_text(t) {
        this.hint_text = t;
    }

    set_hint_actor(a) {
        this.hint_actor = a;
    }

    get_hint_actor() {
        return this.hint_actor;
    }

    set_primary_icon(i) {
        this.primary_icon = i;
    }

    get_primary_icon() {
        return this.primary_icon;
    }

    set_secondary_icon(i) {
        this.secondary_icon = i;
    }

    get_secondary_icon() {
        return this.secondary_icon;
    }

    set_input_purpose(p) {
        this.input_purpose = p;
    }

    set_input_hints(h) {
        this.input_hints = h;
    }

    grab_key_focus() {
        this._gnoshInner?.grab_focus();
    }
});
installAccessors(Entry, ENTRY_PROPERTIES);

export const PasswordEntry = GObject.registerClass({
    GTypeName: 'GnoshStPasswordEntry',
    Properties: makeProperties({'password-visible': P.bool(false), 'show-peek-icon': P.bool(true)}),
}, class PasswordEntry extends Entry {
    _gnoshCreateInner() {
        const entry = super._gnoshCreateInner();
        entry.visibility = false;
        entry.input_purpose = Gtk.InputPurpose.PASSWORD;
        return entry;
    }

    _propChanged(key, value) {
        super._propChanged(key, value);
        if (key === 'password_visible' && this._gnoshInner)
            this._gnoshInner.visibility = value;
    }
});

// --- Adjustment and ScrollView -----------------------------------------------

const ADJ_PROPERTIES = {
    'value': P.double(0),
    'lower': P.double(0),
    'upper': P.double(0),
    'step-increment': P.double(0),
    'page-increment': P.double(0),
    'page-size': P.double(0),
    'actor': P.object(Actor),
};

export const Adjustment = GObject.registerClass({
    GTypeName: 'GnoshStAdjustment',
    Properties: makeProperties(ADJ_PROPERTIES),
    Signals: {'changed': {}},
}, class Adjustment extends GObject.Object {
    _init(params = {}) {
        this._gnoshP = {};
        const gtkAdj = params._gnoshGtk;
        delete params._gnoshGtk;
        super._init(params);
        this._gnoshConstructed = true;
        if (gtkAdj)
            this._gnoshBind(gtkAdj);
    }

    _gnoshBind(adj) {
        this._gnoshGtk = adj;
        const names = ['value', 'lower', 'upper', 'step_increment', 'page_increment', 'page_size'];
        adj.connect('value-changed', () => this.notify('value'));
        adj.connect('changed', () => this.emit('changed'));
        for (const n of names) {
            if (this._gnoshP[n] !== undefined)
                adj[n] = this._gnoshP[n];
        }
    }

    _propChanged(key, value) {
        if (this._gnoshGtk && key !== 'actor' && this._gnoshGtk[key] !== value)
            this._gnoshGtk[key] = value;
    }

    get_value() {
        return this.value;
    }

    set_value(v) {
        this.value = Math.max(this.lower, Math.min(v, this.upper - this.page_size));
    }

    get_values() {
        return [this.value, this.lower, this.upper, this.step_increment, this.page_increment, this.page_size];
    }

    set_values(value, lower, upper, step, page, pageSize) {
        Object.assign(this, {lower, upper, step_increment: step, page_increment: page, page_size: pageSize});
        this.set_value(value);
        this.emit('changed');
    }

    clamp_page(lower, upper) {
        if (lower < this.value)
            this.set_value(lower);
        else if (upper > this.value + this.page_size)
            this.set_value(upper - this.page_size);
    }

    adjust_for_scroll_event(delta) {
        this.set_value(this.value + delta * Math.max(this.step_increment, this.page_size ** (2 / 3)));
    }

    ease(value, params = {}) {
        this.set_value(value);
        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            params.onComplete?.();
            return GLib.SOURCE_REMOVE;
        });
    }

    remove_transition() {}

    get_transition() {
        return null;
    }
});
for (const [name, def] of Object.entries(ADJ_PROPERTIES)) {
    const key = name.replace(/-/g, '_');
    Object.defineProperty(Adjustment.prototype, key, {
        configurable: true,
        get() {
            if (this._gnoshGtk && key !== 'actor')
                return this._gnoshGtk[key];
            return this._gnoshP?.[key] ?? def.def;
        },
        set(v) {
            this._gnoshP ??= {};
            if (this[key] === v)
                return;
            this._gnoshP[key] = v;
            this._propChanged?.(key, v);
            if (this._gnoshConstructed && !(this._gnoshGtk && key === 'value'))
                this.notify(name);
        },
    });
}

export const ScrollBar = GObject.registerClass({
    GTypeName: 'GnoshStScrollBar',
    Properties: makeProperties({'adjustment': P.object(Adjustment), 'vertical': P.bool(false)}),
}, class ScrollBar extends Widget {});
installAccessors(ScrollBar, {'adjustment': P.object(Adjustment), 'vertical': P.bool(false)});

const SCROLL_PROPERTIES = {
    'child': P.object(Actor),
    'hscrollbar-policy': P.int(SE.PolicyType.AUTOMATIC),
    'vscrollbar-policy': P.int(SE.PolicyType.AUTOMATIC),
    'overlay-scrollbars': P.bool(false),
    'enable-mouse-scrolling': P.bool(true),
    'hscrollbar-visible': P.bool(false),
    'vscrollbar-visible': P.bool(false),
    'content-padding': P.js(null),
};

export const ScrollView = GObject.registerClass({
    GTypeName: 'GnoshStScrollView',
    Properties: makeProperties(SCROLL_PROPERTIES),
}, class ScrollView extends Widget {
    _gnoshCreateInner() {
        const sw = new Gtk.ScrolledWindow({
            hscrollbar_policy: Gtk.PolicyType.NEVER,
            vscrollbar_policy: Gtk.PolicyType.AUTOMATIC,
            propagate_natural_height: true,
            propagate_natural_width: true,
        });
        this._gnoshViewport = new Gtk.Viewport({shadow_type: Gtk.ShadowType.NONE});
        this._gnoshViewport.show();
        sw.add(this._gnoshViewport);
        this._gnoshHadjustment = new Adjustment({_gnoshGtk: sw.get_hadjustment()});
        this._gnoshVadjustment = new Adjustment({_gnoshGtk: sw.get_vadjustment()});
        this._gnoshHscroll = new ScrollBar({adjustment: this._gnoshHadjustment, vertical: false});
        this._gnoshVscroll = new ScrollBar({adjustment: this._gnoshVadjustment, vertical: true});
        return sw;
    }

    get _gnoshIsContainerActor() {
        return false;
    }

    get _gnoshChildContainer() {
        return this._gnoshViewport;
    }

    _propChanged(key, value) {
        super._propChanged(key, value);
        if (!this._gnoshInner)
            return;
        switch (key) {
        case 'child':
            for (const c of this.get_children()) {
                if (c !== value)
                    this.remove_child(c);
            }
            if (value && value.get_parent() !== this)
                this.add_child(value);
            break;
        case 'hscrollbar_policy':
            this._gnoshInner.hscrollbar_policy = value;
            break;
        case 'vscrollbar_policy':
            this._gnoshInner.vscrollbar_policy = value;
            break;
        case 'overlay_scrollbars':
            this._gnoshInner.overlay_scrolling = value;
            break;
        }
    }

    _gnoshSyncAll() {
        const child = this._gnoshP.child;
        delete this._gnoshP.child;
        super._gnoshSyncAll();
        if (child)
            this.child = child;
    }

    get hadjustment() {
        return this._gnoshHadjustment;
    }

    get vadjustment() {
        return this._gnoshVadjustment;
    }

    get hscroll() {
        return this._gnoshHscroll;
    }

    get vscroll() {
        return this._gnoshVscroll;
    }

    get_hscroll_bar() {
        return this._gnoshHscroll;
    }

    get_vscroll_bar() {
        return this._gnoshVscroll;
    }

    set_policy(h, v) {
        this.hscrollbar_policy = h;
        this.vscrollbar_policy = v;
    }

    set_child(c) {
        this.child = c;
    }

    get_child() {
        return this._gnoshP.child ?? this.get_first_child();
    }

    add_child(child) {
        super.add_child(child);
        this._gnoshP.child = child;
    }

    remove_child(child) {
        super.remove_child(child);
        if (this._gnoshP.child === child)
            this._gnoshP.child = null;
    }

    update_fade_effect() {}

    set_mouse_scrolling(v) {
        this.enable_mouse_scrolling = v;
    }

    get_overlay_scrollbars() {
        return this.overlay_scrollbars;
    }

    set_overlay_scrollbars(v) {
        this.overlay_scrollbars = v;
    }
});
installAccessors(ScrollView, SCROLL_PROPERTIES);

// --- DrawingArea ---------------------------------------------------------------

export const DrawingArea = GObject.registerClass({
    GTypeName: 'GnoshStDrawingArea',
    Signals: {'repaint': {}},
}, class DrawingArea extends Widget {
    _gnoshCreateInner() {
        const area = new Gtk.DrawingArea();
        area.connect('draw', (w, cr) => {
            this._gnoshCr = cr;
            try {
                this.vfunc_repaint();
                this.emit('repaint');
            } catch (e) {
                logError(e, 'gnosh: St.DrawingArea repaint');
            } finally {
                this._gnoshCr = null;
            }
            return false;
        });
        return area;
    }

    get _gnoshIsContainerActor() {
        return false;
    }

    vfunc_repaint() {}

    get_context() {
        return this._gnoshCr;
    }

    get_surface_size() {
        return [this._gnoshInner.get_allocated_width(), this._gnoshInner.get_allocated_height()];
    }

    queue_repaint() {
        this._gnoshInner?.queue_draw();
    }
});

// --- ImageContent ------------------------------------------------------------

export const ImageContent = GObject.registerClass({
    GTypeName: 'GnoshStImageContent',
    Properties: makeProperties({'preferred-width': P.int(-1), 'preferred-height': P.int(-1)}),
}, class ImageContent extends GObject.Object {
    _init(params = {}) {
        this._gnoshP = {};
        super._init(params);
    }

    static new_with_preferred_size(w, h) {
        return new ImageContent({preferred_width: w, preferred_height: h});
    }

    set_data(data, format, width, height, rowstride) {
        return this.set_bytes(data instanceof GLib.Bytes ? data : new GLib.Bytes(data), format, width, height, rowstride);
    }

    set_bytes(bytes, format, width, height, rowstride) {
        // Cogl ARGB/RGBA formats; assume 4 channels with alpha.
        this._pixbuf = GdkPixbuf.Pixbuf.new_from_bytes(bytes, GdkPixbuf.Colorspace.RGB, true, 8, width, height, rowstride);
        this._format = format;
        return true;
    }

    _gnoshPixbuf(size) {
        if (!this._pixbuf)
            return null;
        if (size > 0 && (this._pixbuf.get_width() !== size || this._pixbuf.get_height() !== size))
            return this._pixbuf.scale_simple(size, size, GdkPixbuf.InterpType.BILINEAR);
        return this._pixbuf;
    }

    get_preferred_size() {
        return [true, this._pixbuf?.get_width() ?? 0, this._pixbuf?.get_height() ?? 0];
    }

    invalidate() {}

    invalidate_size() {}
});
installAccessors(ImageContent, {'preferred-width': P.int(-1), 'preferred-height': P.int(-1)});

// --- Clipboard -----------------------------------------------------------------

let _clipboard = null;

export const Clipboard = GObject.registerClass({
    GTypeName: 'GnoshStClipboard',
}, class Clipboard extends GObject.Object {
    static get_default() {
        _clipboard ??= new Clipboard();
        return _clipboard;
    }

    _gtk(type) {
        return Gtk.Clipboard.get(type === SE.ClipboardType.PRIMARY ? Gdk.SELECTION_PRIMARY : Gdk.SELECTION_CLIPBOARD);
    }

    get_text(type, callback) {
        this._gnoshGtk(type).request_text((cb, text) => {
            try {
                callback(this, text ?? null);
            } catch (e) {
                logError(e, 'gnosh: St.Clipboard.get_text callback');
            }
        });
    }

    set_text(type, text) {
        this._gnoshGtk(type).set_text(text ?? '', -1);
        globalThis.global?.display?.get_selection?.()._gnoshOwnerChanged?.(type);
    }

    get_mimetypes(type) {
        const [ok, atoms] = this._gnoshGtk(type).wait_for_targets();
        return ok ? atoms.map(a => a.name()) : [];
    }

    get_content(type, mimetype, callback) {
        this._gnoshGtk(type).request_contents(Gdk.Atom.intern(mimetype, false), (cb, data) => {
            callback(this, data ? new GLib.Bytes(data.get_data() ?? []) : null);
        });
    }

    set_content(type, mimetype, bytes) {
        if (mimetype.startsWith('text/')) {
            this.set_text(type, new TextDecoder().decode(bytes.toArray ? bytes.toArray() : bytes));
            return;
        }
        warnOnce(`clip-${mimetype}`, `St.Clipboard.set_content(${mimetype}) is not supported; ignoring`);
    }

    set_selection() {}
});

// --- Settings ------------------------------------------------------------------

let _stSettings = null;
const IFACE_KEYS = {
    'font-name': 'font-name', 'gtk-theme': 'gtk-theme', 'gtk-icon-theme': 'icon-theme',
    'color-scheme': 'color-scheme', 'enable-animations': 'enable-animations',
};

export const Settings = GObject.registerClass({
    GTypeName: 'GnoshStSettings',
    Properties: makeProperties({
        'primary-paste': P.bool(true), 'magnifier-active': P.bool(false), 'gtk-theme': P.string(''),
        'gtk-icon-theme': P.string(''), 'font-name': P.string(''), 'color-scheme': P.int(0),
        'high-contrast': P.bool(false), 'drag-threshold': P.int(8), 'enable-animations': P.bool(true),
        'slow-down-factor': P.double(1), 'disable-show-password': P.bool(false),
        'long-press-duration': P.int(500),
    }),
}, class Settings extends GObject.Object {
    static get() {
        _stSettings ??= new Settings();
        return _stSettings;
    }

    _init() {
        this._gnoshP = {};
        super._init();
        this._gnoshConstructed = true;
        try {
            this._iface = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
            for (const [prop, key] of Object.entries(IFACE_KEYS)) {
                const read = () => {
                    const v = this._iface.get_value(key).deepUnpack();
                    this._gnoshP[prop.replace(/-/g, '_')] = key === 'color-scheme' ? this._iface.get_enum(key) : v;
                    this.notify(prop);
                };
                if (this._iface.settings_schema.has_key(key)) {
                    this._iface.connect(`changed::${key}`, read);
                    read();
                }
            }
        } catch (e) {
            logError(e, 'gnosh: St.Settings');
        }
    }

    inhibit_animations() {}

    uninhibit_animations() {}
});
installAccessors(Settings, {
    'primary-paste': P.bool(true), 'magnifier-active': P.bool(false), 'gtk-theme': P.string(''),
    'gtk-icon-theme': P.string(''), 'font-name': P.string(''), 'color-scheme': P.int(0),
    'high-contrast': P.bool(false), 'drag-threshold': P.int(8), 'enable-animations': P.bool(true),
    'slow-down-factor': P.double(1), 'disable-show-password': P.bool(false), 'long-press-duration': P.int(500),
});

// --- Theme, ThemeContext, IconTheme, TextureCache ------------------------------

export const Theme = GObject.registerClass({
    GTypeName: 'GnoshStTheme',
    Signals: {'custom-stylesheets-changed': {}},
}, class Theme extends GObject.Object {
    _init(params = {}) {
        super._init();
        this._sheets = new Map();
        this.application_stylesheet = params.application_stylesheet ?? null;
        this.default_stylesheet = params.default_stylesheet ?? null;
        this.theme_stylesheet = params.theme_stylesheet ?? null;
    }

    load_stylesheet(file) {
        const path = file.get_path() ?? file.get_uri();
        const [, bytes] = file.load_contents(null);
        const {css, stRules} = Style.translateStylesheet(new TextDecoder().decode(bytes), '.gnosh');
        const owner = `sheet:${path}`;
        Style.loadScreenCss(owner, css);
        Style.addStRules(stRules, owner);
        this._sheets.set(path, file);
        this.emit('custom-stylesheets-changed');
        return true;
    }

    unload_stylesheet(file) {
        const path = file.get_path() ?? file.get_uri();
        Style.unloadScreenCss(`sheet:${path}`);
        Style.removeStRules(`sheet:${path}`);
        this._sheets.delete(path);
        this.emit('custom-stylesheets-changed');
    }

    get_custom_stylesheets() {
        return [...this._sheets.values()];
    }
});

let _themeContext = null;

export const ThemeContext = GObject.registerClass({
    GTypeName: 'GnoshStThemeContext',
    Properties: makeProperties({'scale-factor': P.int(1)}),
    Signals: {'changed': {}},
}, class ThemeContext extends GObject.Object {
    static get_for_stage() {
        if (!_themeContext) {
            _themeContext = new ThemeContext();
            _themeContext._theme = new Theme();
        }
        return _themeContext;
    }

    get scale_factor() {
        const display = Gdk.Display.get_default();
        const monitor = display?.get_primary_monitor() ?? display?.get_monitor(0);
        return monitor?.get_scale_factor() ?? 1;
    }

    get scaleFactor() {
        return this.scale_factor;
    }

    get_theme() {
        return this._theme;
    }

    set_theme(theme) {
        this._theme = theme;
        this.emit('changed');
    }

    get_scale_factor() {
        return this.scale_factor;
    }

    get_root_node() {
        return new ThemeNode(new Widget());
    }

    get_font() {
        return Pango.FontDescription.from_string(Settings.get().font_name || 'Sans 11');
    }

    set_font() {}

    get_resolution() {
        return 96;
    }

    /** GNOME 47+: [accent color, foreground color on accent]. */
    get_accent_color() {
        const ACCENTS = {
            blue: '#3584e4', teal: '#2190a4', green: '#3a944a', yellow: '#c88800', orange: '#ed5b00',
            red: '#e62d42', pink: '#d56199', purple: '#9141ac', slate: '#6f8396',
        };
        let name = 'blue';
        try {
            const settings = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
            if (settings.settings_schema.has_key('accent-color'))
                name = settings.get_string('accent-color');
        } catch {
            // old gsettings-desktop-schemas
        }
        const [, accent] = Color.from_string(ACCENTS[name] ?? ACCENTS.blue);
        const [, fg] = Color.from_string('#ffffff');
        return [accent, fg];
    }

    lookup_node(node) {
        return node;
    }
});

export const IconTheme = GObject.registerClass({
    GTypeName: 'GnoshStIconTheme',
    Signals: {'changed': {}},
}, class IconTheme extends GObject.Object {
    _init() {
        super._init();
        this._theme = Gtk.IconTheme.get_default();
        this._theme.connect('changed', () => this.emit('changed'));
    }

    static new() {
        return new IconTheme();
    }

    static get_default() {
        return new IconTheme();
    }

    append_search_path(path) {
        if (!this._theme.get_search_path().includes(path))
            this._theme.append_search_path(path);
    }

    prepend_search_path(path) {
        if (!this._theme.get_search_path().includes(path))
            this._theme.prepend_search_path(path);
    }

    add_resource_path(path) {
        this._theme.add_resource_path(path);
    }

    get_search_path() {
        return this._theme.get_search_path();
    }

    set_search_path(paths) {
        this._theme.set_search_path(paths);
    }

    has_icon(name) {
        return this._theme.has_icon(name);
    }

    lookup_icon(name, size, flags) {
        return this._theme.lookup_icon(name, size, flags ?? 0);
    }

    lookup_by_gicon(gicon, size, flags) {
        return this._theme.lookup_by_gicon(gicon, size, flags ?? 0);
    }

    load_icon(name, size, flags) {
        return this._theme.load_icon(name, size, flags ?? 0);
    }

    list_icons(context) {
        return this._theme.list_icons(context ?? null);
    }

    rescan_if_needed() {
        return this._theme.rescan_if_needed();
    }
});

let _textureCache = null;

export const TextureCache = GObject.registerClass({
    GTypeName: 'GnoshStTextureCache',
    Signals: {'icon-theme-changed': {}, 'texture-file-changed': {param_types: [Gio.File]}},
}, class TextureCache extends GObject.Object {
    static get_default() {
        _textureCache ??= new TextureCache();
        return _textureCache;
    }

    load_gicon(themeNode, gicon, size) {
        return new Icon({gicon, icon_size: size});
    }

    load_file_async(file, width, height) {
        const icon = new Icon({gicon: new Gio.FileIcon({file}), icon_size: Math.max(width, height, -1)});
        return icon;
    }

    load_file_to_cairo_surface() {
        return null;
    }

    load_sliced_image(file, gridWidth, gridHeight) {
        return new Icon({gicon: new Gio.FileIcon({file}), icon_size: Math.max(gridWidth, gridHeight)});
    }

    bind_cairo_surface_property() {
        return new Widget();
    }

    rescan_icon_theme() {
        return false;
    }
});

export const FocusManager = GObject.registerClass({
    GTypeName: 'GnoshStFocusManager',
}, class FocusManager extends GObject.Object {
    static get_for_stage() {
        return new FocusManager();
    }

    add_group() {}

    remove_group() {}

    get_group() {
        return null;
    }

    navigate_from_event() {
        return false;
    }
});

export const GenericAccessible = GObject.registerClass({
    GTypeName: 'GnoshStGenericAccessible',
    Signals: {
        'get-current-value': {return_type: GObject.TYPE_DOUBLE},
        'get-maximum-value': {return_type: GObject.TYPE_DOUBLE},
        'get-minimum-value': {return_type: GObject.TYPE_DOUBLE},
        'get-minimum-increment': {return_type: GObject.TYPE_DOUBLE},
        'set-current-value': {param_types: [GObject.TYPE_DOUBLE]},
    },
}, class GenericAccessible extends GObject.Object {
    static new_for_actor() {
        return new GenericAccessible();
    }
});

// GNOME 46+ has its own icon theme code; GTK's IconInfo has the same API.
export const IconInfo = Gtk.IconInfo;

export function describe_actor(actor) {
    return `[${actor?.constructor?.name ?? 'null'}${actor?.name ? ` "${actor.name}"` : ''}]`;
}

// Re-export Clutter event for convenience of other shims.
export {Event};
