// SPDX-License-Identifier: GPL-3.0-or-later
//
// Clutter.Actor emulation backed by GTK 3 widgets.
//
// Every actor is a real, subclassable GObject (extensions use
// GObject.registerClass on St widgets all the time). Each actor owns a GTK
// widget pair: an outer Gtk.EventBox that receives input and carries the
// Clutter layout properties (expand, align, size, visibility, opacity), and
// an inner widget that draws (a container, label, image, entry, ...).
// Children are packed into the parent's inner container according to the
// parent's Clutter layout manager.

import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gdk from 'gi://Gdk?version=3.0';
import Gtk from 'gi://Gtk?version=3.0';

import {Clutter as E} from './enums.js';

const RW = GObject.ParamFlags.READWRITE | GObject.ParamFlags.EXPLICIT_NOTIFY;
const RO = GObject.ParamFlags.READABLE;

// vfuncs GObject itself implements; everything else named vfunc_* on our
// classes is a JS-level virtual method we call ourselves.
const GOBJECT_VFUNCS = new Set([
    'constructed', 'dispose', 'finalize', 'notify', 'dispatch_properties_changed',
    'set_property', 'get_property',
]);

/**
 * GObject.registerClass() wants every vfunc_* method to exist in C. Our
 * actors are written in JS, so hide the JS-level vfuncs while GJS registers
 * the type and put them back afterwards. Inherited by all subclasses,
 * including the ones extensions define.
 */
function classInitWithJsVfuncs(klass) {
    const saved = [];
    for (const target of [klass.prototype, klass]) {
        for (const name of Object.getOwnPropertyNames(target)) {
            if (!name.startsWith('vfunc_') || GOBJECT_VFUNCS.has(name.slice(6)))
                continue;
            saved.push([target, name, Object.getOwnPropertyDescriptor(target, name)]);
            delete target[name];
        }
    }
    try {
        return GObject.Object._classInit.call(GObject.Object, klass);
    } finally {
        for (const [target, name, descr] of saved)
            Object.defineProperty(target, name, descr);
    }
}

/** snake_case / kebab-case / camelCase -> snake_case */
export function canonicalName(name) {
    return name.replace(/-/g, '_').replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

const _warned = new Set();
export function warnOnce(key, msg) {
    if (_warned.has(key))
        return;
    _warned.add(key);
    console.warn(`gnosh: ${msg}`);
}

/**
 * Declare GObject properties backed by `this._p` with change hooks.
 *
 * spec: {name: [ParamSpec factory args...], ...} handled by makeSpec.
 */
export function makeProperties(defs) {
    const props = {};
    for (const [name, def] of Object.entries(defs))
        props[name] = def.spec(name);
    return props;
}

export const P = {
    bool: (def = false, flags = RW) => ({spec: n => GObject.ParamSpec.boolean(n, null, null, flags, def), def}),
    int: (def = 0, min = -2147483647, max = 2147483647, flags = RW) =>
        ({spec: n => GObject.ParamSpec.int(n, null, null, flags, min, max, def), def}),
    uint: (def = 0, min = 0, max = 4294967295, flags = RW) =>
        ({spec: n => GObject.ParamSpec.uint(n, null, null, flags, min, max, def), def}),
    double: (def = 0, min = -Number.MAX_VALUE, max = Number.MAX_VALUE, flags = RW) =>
        ({spec: n => GObject.ParamSpec.double(n, null, null, flags, min, max, def), def}),
    float: (def = 0, min = -3.4e38, max = 3.4e38, flags = RW) =>
        ({spec: n => GObject.ParamSpec.float(n, null, null, flags, min, max, def), def}),
    string: (def = null, flags = RW) => ({spec: n => GObject.ParamSpec.string(n, null, null, flags, def), def}),
    object: (type = GObject.Object, flags = RW) =>
        ({spec: n => GObject.ParamSpec.object(n, null, null, flags, type), def: null}),
    js: (def = null, flags = RW) => ({spec: n => GObject.ParamSpec.jsobject(n, null, null, flags), def}),
};

/**
 * Install accessors for property definitions on a class prototype. Each
 * setter stores the value, notifies, and calls `_propChanged(name, value)`.
 */
export function installAccessors(klass, defs) {
    for (const [name, def] of Object.entries(defs)) {
        const key = canonicalName(name);
        const descr = {
            configurable: true,
            get() {
                const v = this._p?.[key];
                return v === undefined ? def.def : v;
            },
            set(value) {
                this._p ??= {};
                if (this._p[key] === value)
                    return;
                this._p[key] = value;
                this._propChanged?.(key, value);
                if (this._gnoshConstructed)
                    this.notify(name);
            },
        };
        Object.defineProperty(klass.prototype, key, descr);
        const camel = key.replace(/_([a-z])/g, (m, c) => c.toUpperCase());
        if (camel !== key)
            Object.defineProperty(klass.prototype, camel, descr);
    }
}

// --- Clutter value types ----------------------------------------------------

export class ActorBox {
    constructor(x1 = 0, y1 = 0, x2 = 0, y2 = 0) {
        if (typeof x1 === 'object' && x1 !== null)
            ({x1 = 0, y1 = 0, x2 = 0, y2 = 0} = x1);
        Object.assign(this, {x1, y1, x2, y2});
    }

    static new(x1, y1, x2, y2) {
        return new ActorBox(x1, y1, x2, y2);
    }

    get_width() {
        return this.x2 - this.x1;
    }

    get_height() {
        return this.y2 - this.y1;
    }

    get_x() {
        return this.x1;
    }

    get_y() {
        return this.y1;
    }

    get_size() {
        return [this.get_width(), this.get_height()];
    }

    get_origin() {
        return [this.x1, this.y1];
    }

    get_area() {
        return this.get_width() * this.get_height();
    }

    set_origin(x, y) {
        const [w, h] = this.get_size();
        Object.assign(this, {x1: x, y1: y, x2: x + w, y2: y + h});
    }

    set_size(w, h) {
        this.x2 = this.x1 + w;
        this.y2 = this.y1 + h;
    }

    init_rect(x, y, w, h) {
        Object.assign(this, {x1: x, y1: y, x2: x + w, y2: y + h});
        return this;
    }

    init(x1, y1, x2, y2) {
        Object.assign(this, {x1, y1, x2, y2});
        return this;
    }

    copy() {
        return new ActorBox(this.x1, this.y1, this.x2, this.y2);
    }

    contains(x, y) {
        return x >= this.x1 && x < this.x2 && y >= this.y1 && y < this.y2;
    }

    equal(o) {
        return o && o.x1 === this.x1 && o.y1 === this.y1 && o.x2 === this.x2 && o.y2 === this.y2;
    }

    clamp_to_pixel() {
        this.x1 = Math.floor(this.x1);
        this.y1 = Math.floor(this.y1);
        this.x2 = Math.ceil(this.x2);
        this.y2 = Math.ceil(this.y2);
    }

    union(o) {
        return new ActorBox(Math.min(this.x1, o.x1), Math.min(this.y1, o.y1),
            Math.max(this.x2, o.x2), Math.max(this.y2, o.y2));
    }
}

export class Margin {
    constructor(params = {}) {
        this.left = params.left ?? 0;
        this.right = params.right ?? 0;
        this.top = params.top ?? 0;
        this.bottom = params.bottom ?? 0;
    }

    static new() {
        return new Margin();
    }
}

// --- Events ------------------------------------------------------------------

const GDK_TO_CLUTTER_EVENT = {
    [Gdk.EventType.BUTTON_PRESS]: E.EventType.BUTTON_PRESS,
    [Gdk.EventType.BUTTON_RELEASE]: E.EventType.BUTTON_RELEASE,
    [Gdk.EventType.MOTION_NOTIFY]: E.EventType.MOTION,
    [Gdk.EventType.ENTER_NOTIFY]: E.EventType.ENTER,
    [Gdk.EventType.LEAVE_NOTIFY]: E.EventType.LEAVE,
    [Gdk.EventType.SCROLL]: E.EventType.SCROLL,
    [Gdk.EventType.KEY_PRESS]: E.EventType.KEY_PRESS,
    [Gdk.EventType.KEY_RELEASE]: E.EventType.KEY_RELEASE,
    [Gdk.EventType.TOUCH_BEGIN]: E.EventType.TOUCH_BEGIN,
    [Gdk.EventType.TOUCH_UPDATE]: E.EventType.TOUCH_UPDATE,
    [Gdk.EventType.TOUCH_END]: E.EventType.TOUCH_END,
    [Gdk.EventType.TOUCH_CANCEL]: E.EventType.TOUCH_CANCEL,
};

export const Event = GObject.registerClass({
    GTypeName: 'GnoshClutterEvent',
}, class Event extends GObject.Object {
    _init(fields = {}) {
        super._init();
        this._f = {
            type: E.EventType.NOTHING, time: GLib.get_monotonic_time() / 1000 | 0,
            button: 0, x: 0, y: 0, state: 0, keyval: 0, unicode: 0, keycode: 0,
            direction: E.ScrollDirection.SMOOTH, dx: 0, dy: 0, source: null,
            flags: 0, related: null, ...fields,
        };
    }

    static fromGdk(gdkEvent, source) {
        const f = {source};
        const [, type] = [null, gdkEvent.get_event_type()];
        f.type = GDK_TO_CLUTTER_EVENT[type] ?? E.EventType.NOTHING;
        f.time = gdkEvent.get_time();
        const [okState, state] = gdkEvent.get_state();
        if (okState)
            f.state = state;
        const [okRoot, rx, ry] = gdkEvent.get_root_coords();
        if (okRoot) {
            f.x = rx;
            f.y = ry;
        }
        const [okButton, button] = gdkEvent.get_button();
        if (okButton)
            f.button = button;
        const [okKey, keyval] = gdkEvent.get_keyval();
        if (okKey) {
            f.keyval = keyval;
            f.unicode = Gdk.keyval_to_unicode(keyval);
            const [okCode, code] = gdkEvent.get_keycode();
            if (okCode)
                f.keycode = code;
        }
        const [okDir, dir] = gdkEvent.get_scroll_direction();
        if (okDir) {
            f.direction = dir;
        } else if (type === Gdk.EventType.SCROLL) {
            const [, dx, dy] = gdkEvent.get_scroll_deltas();
            f.direction = E.ScrollDirection.SMOOTH;
            f.dx = dx;
            f.dy = dy;
        }
        if (gdkEvent.get_pointer_emulated?.())
            f.flags |= E.EventFlags.FLAG_POINTER_EMULATED;
        const local = source?._gnoshLocalCoords?.(f.x, f.y);
        if (local)
            [f.lx, f.ly] = local;
        return new Event(f);
    }

    type() {
        return this._f.type;
    }

    get_type() {
        return this._f.type;
    }

    get_time() {
        return this._f.time;
    }

    get_button() {
        return this._f.button;
    }

    get_click_count() {
        return 1;
    }

    get_coords() {
        return [this._f.x, this._f.y];
    }

    get_position() {
        return {x: this._f.x, y: this._f.y};
    }

    /** Coordinates relative to the actor that received the event (gnosh). */
    _gnoshLocal() {
        return [this._f.lx ?? 0, this._f.ly ?? 0];
    }

    get_state() {
        return this._f.state;
    }

    get_key_symbol() {
        return this._f.keyval;
    }

    get_key_unicode() {
        return this._f.unicode;
    }

    get_key_code() {
        return this._f.keycode;
    }

    get_scroll_direction() {
        return this._f.direction;
    }

    get_scroll_delta() {
        return [this._f.dx, this._f.dy];
    }

    get_scroll_source() {
        return E.ScrollSource.UNKNOWN;
    }

    get_source() {
        return this._f.source;
    }

    get_source_device() {
        return null;
    }

    get_device() {
        return null;
    }

    get_device_type() {
        return this._f.type >= E.EventType.TOUCH_BEGIN && this._f.type <= E.EventType.TOUCH_CANCEL
            ? E.InputDeviceType.TOUCHSCREEN_DEVICE : E.InputDeviceType.POINTER_DEVICE;
    }

    get_flags() {
        return this._f.flags;
    }

    get_event_sequence() {
        return null;
    }

    get_related() {
        return this._f.related;
    }

    has_control_modifier() {
        return (this._f.state & E.ModifierType.CONTROL_MASK) !== 0;
    }

    has_shift_modifier() {
        return (this._f.state & E.ModifierType.SHIFT_MASK) !== 0;
    }

    is_pointer_emulated() {
        return (this._f.flags & E.EventFlags.FLAG_POINTER_EMULATED) !== 0;
    }
});

const SIGNAL_VFUNCS = {
    'button-press-event': 'vfunc_button_press_event',
    'button-release-event': 'vfunc_button_release_event',
    'motion-event': 'vfunc_motion_event',
    'enter-event': 'vfunc_enter_event',
    'leave-event': 'vfunc_leave_event',
    'scroll-event': 'vfunc_scroll_event',
    'key-press-event': 'vfunc_key_press_event',
    'key-release-event': 'vfunc_key_release_event',
    'touch-event': 'vfunc_touch_event',
};

const EVENT_SIGNAL = {
    param_types: [GObject.TYPE_OBJECT],
    return_type: GObject.TYPE_BOOLEAN,
    flags: GObject.SignalFlags.RUN_LAST,
    accumulator: GObject.AccumulatorType.TRUE_HANDLED,
};

// --- Layout managers ---------------------------------------------------------

export const LayoutManager = GObject.registerClass({
    GTypeName: 'GnoshClutterLayoutManager',
    Signals: {'layout-changed': {}},
}, class LayoutManager extends GObject.InitiallyUnowned {
    static _classInit(klass) {
        return classInitWithJsVfuncs(klass);
    }

    get _gnoshKind() {
        return 'fixed';
    }

    layout_changed() {
        this.emit('layout-changed');
    }

    set_container(container) {
        this._container = container;
    }

    get_child_meta() {
        return null;
    }

    child_set_property() {}

    vfunc_get_preferred_width() {
        return [0, 0];
    }

    vfunc_get_preferred_height() {
        return [0, 0];
    }

    vfunc_allocate() {}
});

function defineLayout(gtypeName, kind, defs, extra = {}) {
    const klass = GObject.registerClass({
        GTypeName: gtypeName,
        Properties: makeProperties(defs),
    }, class extends LayoutManager {
        get _gnoshKind() {
            return kind;
        }

        _propChanged() {
            this.emit('layout-changed');
        }
    });
    installAccessors(klass, defs);
    Object.assign(klass.prototype, extra);
    return klass;
}

export const FixedLayout = defineLayout('GnoshClutterFixedLayout', 'fixed', {});
export const BinLayout = defineLayout('GnoshClutterBinLayout', 'bin', {
    'x-align': P.int(E.BinAlignment?.FILL ?? 0),
    'y-align': P.int(0),
});
export const BoxLayout = defineLayout('GnoshClutterBoxLayout', 'box', {
    'orientation': P.int(E.Orientation.HORIZONTAL),
    'spacing': P.uint(0),
    'homogeneous': P.bool(false),
    'pack-start': P.bool(false),
    'vertical': P.bool(false),
}, {
    set_orientation(o) {
        this.orientation = o;
    },
    get_orientation() {
        return this.vertical ? E.Orientation.VERTICAL : this.orientation;
    },
    set_spacing(s) {
        this.spacing = s;
    },
    get_spacing() {
        return this.spacing;
    },
    set_homogeneous(h) {
        this.homogeneous = h;
    },
    set_vertical(v) {
        this.orientation = v ? E.Orientation.VERTICAL : E.Orientation.HORIZONTAL;
    },
    get_vertical() {
        return this.get_orientation() === E.Orientation.VERTICAL;
    },
});
export const GridLayout = defineLayout('GnoshClutterGridLayout', 'grid', {
    'orientation': P.int(E.Orientation.HORIZONTAL),
    'row-spacing': P.uint(0),
    'column-spacing': P.uint(0),
    'row-homogeneous': P.bool(false),
    'column-homogeneous': P.bool(false),
}, {
    attach(child, left, top, width = 1, height = 1) {
        // Like Clutter, attaching also adds the child to the container.
        child._gridPos = {left, top, width, height};
        const container = this._container;
        if (!container)
            return;
        if (child.get_parent() === container)
            container._gnoshRepackChild(child);
        else
            container.add_child(child);
    },
    attach_next_to(child, sibling, side, width = 1, height = 1) {
        const s = sibling?._gridPos ?? {left: 0, top: 0, width: 1, height: 1};
        const pos = {left: s.left, top: s.top};
        if (side === E.GridPosition.RIGHT)
            pos.left = s.left + s.width;
        else if (side === E.GridPosition.LEFT)
            pos.left = s.left - width;
        else if (side === E.GridPosition.BOTTOM)
            pos.top = s.top + s.height;
        else
            pos.top = s.top - height;
        this.attach(child, pos.left, pos.top, width, height);
    },
    get_child_at(left, top) {
        const kids = this._container?.get_children() ?? [];
        return kids.find(c => c._gridPos?.left === left && c._gridPos?.top === top) ?? null;
    },
    set_row_spacing(s) {
        this.row_spacing = s;
    },
    set_column_spacing(s) {
        this.column_spacing = s;
    },
    set_row_homogeneous(h) {
        this.row_homogeneous = h;
    },
    set_column_homogeneous(h) {
        this.column_homogeneous = h;
    },
    set_orientation(o) {
        this.orientation = o;
    },
});
export const FlowLayout = defineLayout('GnoshClutterFlowLayout', 'flow', {
    'orientation': P.int(E.Orientation.HORIZONTAL),
    'column-spacing': P.float(0),
    'row-spacing': P.float(0),
    'homogeneous': P.bool(false),
    'snap-to-grid': P.bool(false),
});

// --- Actor -------------------------------------------------------------------

const ACTOR_PROPERTIES = {
    'name': P.string(null),
    // Clutter actors are hidden until they get a parent (show-on-set-parent).
    'visible': P.bool(false),
    'reactive': P.bool(false),
    'opacity': P.uint(255, 0, 255),
    'x': P.float(0),
    'y': P.float(0),
    'width': P.float(-1, -1),
    'height': P.float(-1, -1),
    'fixed-x': P.float(0),
    'fixed-y': P.float(0),
    'min-width': P.float(-1, -1),
    'min-height': P.float(-1, -1),
    'natural-width': P.float(-1, -1),
    'natural-height': P.float(-1, -1),
    'x-expand': P.bool(false),
    'y-expand': P.bool(false),
    'x-align': P.int(E.ActorAlign.FILL),
    'y-align': P.int(E.ActorAlign.FILL),
    'margin-top': P.float(0),
    'margin-bottom': P.float(0),
    'margin-left': P.float(0),
    'margin-right': P.float(0),
    'layout-manager': P.object(LayoutManager),
    'clip-to-allocation': P.bool(false),
    'request-mode': P.int(E.RequestMode.HEIGHT_FOR_WIDTH),
    'text-direction': P.int(E.TextDirection.LTR),
    'offscreen-redirect': P.int(0),
    'scale-x': P.double(1),
    'scale-y': P.double(1),
    'translation-x': P.float(0),
    'translation-y': P.float(0),
    'translation-z': P.float(0),
    'rotation-angle-x': P.double(0),
    'rotation-angle-y': P.double(0),
    'rotation-angle-z': P.double(0),
    'z-position': P.float(0),
    'pivot-point': P.js(null),
    'background-color': P.js(null),
    'content': P.js(null),
    'content-gravity': P.int(E.ContentGravity.RESIZE_FILL),
    'accessible-name': P.string(null),
    'accessible-role': P.int(0),
    'has-pointer': P.bool(false),
    'mapped': P.bool(false),
    'realized': P.bool(false),
    'fixed-position-set': P.bool(false),
    'x-align-set': P.bool(false),
    'magnification-filter': P.int(0),
    'minification-filter': P.int(0),
    'show-on-set-parent': P.bool(true),
    'color-state': P.js(null),
};

let _actorSerial = 0;

export const Actor = GObject.registerClass({
    GTypeName: 'GnoshClutterActor',
    Properties: makeProperties(ACTOR_PROPERTIES),
    Signals: {
        'destroy': {flags: GObject.SignalFlags.RUN_CLEANUP | GObject.SignalFlags.NO_RECURSE | GObject.SignalFlags.NO_HOOKS},
        'parent-set': {param_types: [GObject.TYPE_OBJECT]},
        'child-added': {param_types: [GObject.TYPE_OBJECT]},
        'child-removed': {param_types: [GObject.TYPE_OBJECT]},
        'event': EVENT_SIGNAL,
        'captured-event': EVENT_SIGNAL,
        'button-press-event': EVENT_SIGNAL,
        'button-release-event': EVENT_SIGNAL,
        'motion-event': EVENT_SIGNAL,
        'enter-event': EVENT_SIGNAL,
        'leave-event': EVENT_SIGNAL,
        'scroll-event': EVENT_SIGNAL,
        'key-press-event': EVENT_SIGNAL,
        'key-release-event': EVENT_SIGNAL,
        'touch-event': EVENT_SIGNAL,
        'key-focus-in': {},
        'key-focus-out': {},
        'show': {},
        'hide': {},
        'realize': {},
        'unrealize': {},
        'queue-relayout': {},
        'queue-redraw': {},
        'resource-scale-changed': {},
        'stage-views-changed': {},
        'transitions-completed': {},
        'transition-stopped': {param_types: [GObject.TYPE_STRING, GObject.TYPE_BOOLEAN]},
        'allocation-changed': {},
        'cloned': {},
        'decloned': {},
    },
}, class Actor extends GObject.InitiallyUnowned {
    static _classInit(klass) {
        return classInitWithJsVfuncs(klass);
    }

    _init(params = {}) {
        this._p = {};
        this._children = [];
        this._parent = null;
        this._destroyed = false;
        this._gnoshSerial = ++_actorSerial;
        this._effects = new Map();
        this._actions = [];
        this._constraints = [];
        this._transitions = new Map();

        const known = {};
        const later = [];
        for (const [rawKey, value] of Object.entries(params ?? {})) {
            const key = canonicalName(rawKey);
            if (this.constructor.find_property(key))
                known[key] = value;
            else
                later.push([key, value]);
        }
        // Widgets must exist before properties are applied, but subclasses
        // pick the widget type, which can depend on construct properties.
        this._gnoshPendingParams = known;
        super._init(known);
        this._gnoshConstructed = true;
        this._gnoshEnsureWidget();

        for (const [key, value] of later) {
            if (key in this) {
                try {
                    this[key] = value;
                } catch (e) {
                    warnOnce(`set-${this.constructor.name}-${key}`, `cannot set ${key} on ${this.constructor.name}: ${e.message}`);
                }
            } else {
                warnOnce(`prop-${this.constructor.name}-${key}`, `unknown property ${key} on ${this.constructor.name}`);
            }
        }
    }

    // --- widget plumbing ---

    /** Create the drawing widget. Subclasses override. */
    _gnoshCreateInner() {
        return this._gnoshCreateContainer();
    }

    /** Default layout kind when no layout manager is set. */
    get _gnoshDefaultKind() {
        return 'fixed';
    }

    get _gnoshKind() {
        return this._p.layout_manager?._gnoshKind ?? this._gnoshDefaultKind;
    }

    _gnoshCreateContainer() {
        const lm = this._p.layout_manager;
        switch (this._gnoshKind) {
        case 'box': {
            const vertical = lm?.get_orientation?.() === E.Orientation.VERTICAL;
            return new Gtk.Box({
                orientation: vertical ? Gtk.Orientation.VERTICAL : Gtk.Orientation.HORIZONTAL,
                spacing: lm?.spacing ?? 0,
                homogeneous: lm?.homogeneous ?? false,
            });
        }
        case 'bin':
            return new Gtk.Overlay();
        case 'grid':
            return new Gtk.Grid({
                row_spacing: lm?.row_spacing ?? 0,
                column_spacing: lm?.column_spacing ?? 0,
                row_homogeneous: lm?.row_homogeneous ?? false,
                column_homogeneous: lm?.column_homogeneous ?? false,
            });
        case 'flow':
            return new Gtk.FlowBox({
                selection_mode: Gtk.SelectionMode.NONE,
                orientation: lm?.orientation === E.Orientation.VERTICAL
                    ? Gtk.Orientation.VERTICAL : Gtk.Orientation.HORIZONTAL,
            });
        default:
            return new Gtk.Fixed();
        }
    }

    /** The GTK container children are packed into. */
    get _gnoshChildContainer() {
        return this._inner;
    }

    _gnoshEnsureWidget() {
        if (this._outer)
            return;
        this._outer = new Gtk.EventBox({visible_window: false, above_child: false, no_show_all: true});
        this._outer._gnoshActor = this;
        this._outer.get_style_context().add_class('gnosh-actor');
        this._outer.add_events(Gdk.EventMask.BUTTON_PRESS_MASK | Gdk.EventMask.BUTTON_RELEASE_MASK |
            Gdk.EventMask.ENTER_NOTIFY_MASK | Gdk.EventMask.LEAVE_NOTIFY_MASK |
            Gdk.EventMask.SCROLL_MASK | Gdk.EventMask.SMOOTH_SCROLL_MASK |
            Gdk.EventMask.KEY_PRESS_MASK | Gdk.EventMask.KEY_RELEASE_MASK |
            Gdk.EventMask.BUTTON_MOTION_MASK);
        // No TOUCH_MASK: touches then arrive as emulated pointer events,
        // which is what the gesture emulation listens to.
        this._inner = this._gnoshCreateInner();
        this._inner._gnoshActor = this;
        this._inner.get_style_context().add_class('gnosh');
        this._inner.show();
        this._outer.add(this._inner);

        this._outer.connect('button-press-event', (w, ev) => this._gnoshGtkEvent('button-press-event', ev));
        this._outer.connect('button-release-event', (w, ev) => this._gnoshGtkEvent('button-release-event', ev));
        this._outer.connect('scroll-event', (w, ev) => this._gnoshGtkEvent('scroll-event', ev));
        this._outer.connect('key-press-event', (w, ev) => this._gnoshGtkEvent('key-press-event', ev));
        this._outer.connect('key-release-event', (w, ev) => this._gnoshGtkEvent('key-release-event', ev));
        this._outer.connect('motion-notify-event', (w, ev) => this._gnoshGtkEvent('motion-event', ev));
        this._outer.connect('enter-notify-event', (w, ev) => this._gnoshCrossing(true, ev));
        this._outer.connect('leave-notify-event', (w, ev) => this._gnoshCrossing(false, ev));
        this._outer.connect('map', () => this._gnoshSetMapped(true));
        this._outer.connect('unmap', () => this._gnoshSetMapped(false));
        this._outer.connect('realize', () => this.emit('realize'));
        this._outer.connect('size-allocate', () => this.emit('allocation-changed'));
        this._outer.connect('destroy', () => {
            if (!this._destroyed)
                this._gnoshWidgetDestroyed();
        });

        this._gnoshSyncAll();
        this._gnoshPendingParams = null;
    }

    /** Re-apply every property to the widgets. */
    _gnoshSyncAll() {
        for (const key of Object.keys(this._p))
            this._propChanged(key, this._p[key]);
        this._gnoshSyncVisible();
    }

    _gnoshSyncVisible() {
        if (!this._outer)
            return;
        const visible = this._p.visible ?? false;
        if (visible)
            this._outer.show();
        else
            this._outer.hide();
    }

    _propChanged(key, value) {
        if (!this._outer)
            return;
        const o = this._outer;
        switch (key) {
        case 'visible':
            // Hiding an actor that has no parent yet keeps it hidden when
            // it gets one, as in Clutter.
            if (!value && !this._parent)
                this._p.show_on_set_parent = false;
            this._gnoshSyncVisible();
            if (this._gnoshConstructed)
                this.emit(value ? 'show' : 'hide');
            break;
        case 'opacity':
            o.set_opacity(Math.max(0, Math.min(255, value)) / 255);
            break;
        case 'x_expand':
            o.hexpand = value;
            break;
        case 'y_expand':
            o.vexpand = value;
            break;
        case 'x_align':
            o.halign = alignToGtk(value);
            break;
        case 'y_align':
            o.valign = alignToGtk(value);
            break;
        case 'width':
        case 'height':
        case 'min_width':
        case 'min_height':
        case 'natural_width':
        case 'natural_height':
            this._gnoshSyncSize();
            break;
        case 'margin_top':
            o.margin_top = Math.max(0, value | 0);
            break;
        case 'margin_bottom':
            o.margin_bottom = Math.max(0, value | 0);
            break;
        case 'margin_left':
            o.margin_start = Math.max(0, value | 0);
            break;
        case 'margin_right':
            o.margin_end = Math.max(0, value | 0);
            break;
        case 'name':
            if (value)
                this._inner.set_name(value);
            break;
        case 'x':
        case 'y':
            this._parent?._gnoshMoveFixedChild?.(this);
            break;
        case 'layout_manager':
            this._gnoshLayoutManagerChanged(value);
            break;
        case 'accessible_name':
            o.get_accessible()?.set_name?.(value ?? '');
            break;
        }
    }

    _gnoshSyncSize() {
        const w = this._p.width ?? -1;
        const h = this._p.height ?? -1;
        const mw = this._p.min_width ?? -1;
        const mh = this._p.min_height ?? -1;
        const nw = this._p.natural_width ?? -1;
        const nh = this._p.natural_height ?? -1;
        const rw = w >= 0 ? w : Math.max(mw, nw);
        const rh = h >= 0 ? h : Math.max(mh, nh);
        this._outer.set_size_request(rw >= 0 ? Math.round(rw) : -1, rh >= 0 ? Math.round(rh) : -1);
    }

    _gnoshLayoutManagerChanged(lm) {
        this._lmSignal && this._lmOld?.disconnect(this._lmSignal);
        this._lmOld = lm;
        this._lmSignal = lm?.connect('layout-changed', () => this._gnoshRebuildContainer());
        lm?.set_container?.(this);
        this._gnoshRebuildContainer();
    }

    /** Replace the inner container (layout manager changed). */
    _gnoshRebuildContainer() {
        if (!this._outer || !this._gnoshIsContainerActor)
            return;
        const old = this._inner;
        const kids = [...this._children];
        for (const child of kids) {
            const w = child._outer;
            if (w.get_parent())
                w.get_parent().remove(w);
        }
        this._binMain = null;
        this._outer.remove(old);
        this._inner = this._gnoshCreateContainer();
        this._inner._gnoshActor = this;
        const oldCtx = old.get_style_context();
        const ctx = this._inner.get_style_context();
        for (const cls of oldCtx.list_classes())
            ctx.add_class(cls);
        this._inner.show();
        this._outer.add(this._inner);
        old.destroy();
        kids.forEach((child, i) => this._gnoshPack(child, i));
        this._gnoshInnerReplaced?.(old);
    }

    /** Actors whose inner widget is a layout container. */
    get _gnoshIsContainerActor() {
        return true;
    }

    _gnoshPack(child, index) {
        const container = this._gnoshChildContainer;
        const w = child._outer;
        if (!container || !w)
            return;
        if (w.get_parent())
            w.get_parent().remove(w);
        if (container instanceof Gtk.Box) {
            container.pack_start(w, false, true, 0);
            container.reorder_child(w, index);
        } else if (container instanceof Gtk.Overlay) {
            if (!this._binMain || this._binMain === child || !this._binMain._outer?.get_parent()) {
                this._binMain = child;
                container.add(w);
            } else {
                container.add_overlay(w);
                container.set_overlay_pass_through(w, false);
            }
        } else if (container instanceof Gtk.Grid) {
            const pos = child._gridPos ?? this._gnoshNextGridPos(child);
            container.attach(w, pos.left, pos.top, pos.width ?? 1, pos.height ?? 1);
        } else if (container instanceof Gtk.Fixed) {
            container.put(w, Math.round(child._p.x ?? 0), Math.round(child._p.y ?? 0));
        } else if (container instanceof Gtk.FlowBox) {
            container.insert(w, index);
        } else if (container instanceof Gtk.Bin) {
            const existing = container.get_child();
            if (existing && existing !== w)
                container.remove(existing);
            container.add(w);
        } else if (container instanceof Gtk.Container) {
            container.add(w);
        }
        child._gnoshSyncVisible();
    }

    _gnoshNextGridPos(child) {
        const lm = this._p.layout_manager;
        const index = this._children.indexOf(child);
        const vertical = lm?.orientation === E.Orientation.VERTICAL;
        child._gridPos = vertical ? {left: 0, top: index} : {left: index, top: 0};
        return child._gridPos;
    }

    _gnoshRepackChild(child) {
        if (child._parent === this)
            this._gnoshPack(child, this._children.indexOf(child));
    }

    _gnoshMoveFixedChild(child) {
        const container = this._gnoshChildContainer;
        if (container instanceof Gtk.Fixed && child._outer.get_parent() === container)
            container.move(child._outer, Math.round(child._p.x ?? 0), Math.round(child._p.y ?? 0));
    }

    _gnoshSetMapped(mapped) {
        if (this._p.mapped === mapped)
            return;
        this._p.mapped = mapped;
        this.notify('mapped');
    }

    _gnoshCrossing(enter, gdkEvent) {
        if (this._destroyed)
            return false;
        // Ignore crossings into/out of our own children.
        const detail = gdkEvent.get_event_type() === Gdk.EventType.ENTER_NOTIFY ||
            gdkEvent.get_event_type() === Gdk.EventType.LEAVE_NOTIFY
            ? gdkEvent.crossing?.detail ?? null : null;
        if (detail === Gdk.NotifyType.INFERIOR)
            return false;
        if (this._p.has_pointer !== enter) {
            this._p.has_pointer = enter;
            this.notify('has-pointer');
        }
        this._gnoshHoverChanged?.(enter);
        return this._gnoshDispatch(enter ? 'enter-event' : 'leave-event', Event.fromGdk(gdkEvent, this));
    }

    _gnoshGtkEvent(signal, gdkEvent) {
        if (this._destroyed)
            return false;
        // Events bubble through GTK (inner widget, then our EventBox);
        // dispatch each event to an actor once.
        const [, rx, ry] = gdkEvent.get_root_coords();
        const key = `${gdkEvent.get_event_type()}:${gdkEvent.get_time()}:${rx}:${ry}`;
        if (this._lastGdkEvent === key)
            return false;
        this._lastGdkEvent = key;
        return this._gnoshDispatch(signal, Event.fromGdk(gdkEvent, this));
    }

    /**
     * Deliver an event the Clutter way: `event` handlers, vfunc_event, the
     * specific signal, then the specific vfunc. Returns true when handled.
     */
    _gnoshDispatch(signal, event) {
        if (!this._p.reactive || this._destroyed)
            return false;
        try {
            if (this.emit('event', event))
                return true;
            if (this.vfunc_event(event))
                return true;
            if (this.emit(signal, event))
                return true;
            const vfunc = SIGNAL_VFUNCS[signal];
            return Boolean(vfunc && this[vfunc]?.(event));
        } catch (e) {
            logError(e, `gnosh: ${signal} handler`);
            return false;
        }
    }

    _gnoshWidgetDestroyed() {
        // The GTK widget went away (e.g. Phosh rebuilt a panel); treat it
        // like a Clutter destroy.
        this.destroy();
    }

    // --- default JS vfuncs ---

    vfunc_event() {
        return E.EVENT_PROPAGATE ?? false;
    }

    vfunc_button_press_event() {
        return false;
    }

    vfunc_button_release_event() {
        return false;
    }

    vfunc_motion_event() {
        return false;
    }

    vfunc_enter_event() {
        return false;
    }

    vfunc_leave_event() {
        return false;
    }

    vfunc_scroll_event() {
        return false;
    }

    vfunc_key_press_event() {
        return false;
    }

    vfunc_key_release_event() {
        return false;
    }

    vfunc_touch_event() {
        return false;
    }

    vfunc_key_focus_in() {}

    vfunc_key_focus_out() {}

    vfunc_get_preferred_width(forHeight) {
        return this._gnoshPreferred(true, forHeight);
    }

    vfunc_get_preferred_height(forWidth) {
        return this._gnoshPreferred(false, forWidth);
    }

    vfunc_allocate() {}

    vfunc_paint() {}

    vfunc_pick() {}

    vfunc_map() {}

    vfunc_unmap() {}

    vfunc_realize() {}

    vfunc_unrealize() {}

    vfunc_show() {
        this.show();
    }

    vfunc_hide() {
        this.hide();
    }

    vfunc_destroy() {}

    vfunc_parent_set() {}

    vfunc_queue_relayout() {}

    vfunc_get_paint_volume() {
        return false;
    }

    vfunc_has_overlaps() {
        return true;
    }

    vfunc_calculate_resource_scale() {
        return 1;
    }

    vfunc_get_accessible() {
        return null;
    }

    _gnoshPreferred(horizontal, forSize) {
        if (!this._outer)
            return [0, 0];
        const [min, nat] = horizontal
            ? forSize >= 0 ? this._outer.get_preferred_width_for_height(forSize) : this._outer.get_preferred_width()
            : forSize >= 0 ? this._outer.get_preferred_height_for_width(forSize) : this._outer.get_preferred_height();
        return [min, nat];
    }

    // --- tree ---

    add_child(child) {
        this.insert_child_at_index(child, -1);
    }

    add_actor(child) {
        this.add_child(child);
    }

    insert_child_at_index(child, index) {
        if (!child || child === this)
            return;
        if (!(child instanceof Actor)) {
            warnOnce(`nonactor-${child?.constructor?.name}`, `cannot add ${child?.constructor?.name} to an actor`);
            return;
        }
        if (child._parent) {
            if (child._parent === this) {
                this.set_child_at_index(child, index);
                return;
            }
            warnOnce('reparent', 'adding an actor that already has a parent; removing it first');
            child._parent.remove_child(child);
        }
        const n = this._children.length;
        const at = index < 0 || index > n ? n : index;
        this._children.splice(at, 0, child);
        child._parent = this;
        if (child._p.show_on_set_parent !== false && !child._p.visible)
            child.visible = true;
        this._gnoshPack(child, at);
        child.emit('parent-set', null);
        child.vfunc_parent_set(null);
        this.emit('child-added', child);
        this._gnoshChildrenChanged?.();
    }

    insert_child_above(child, sibling) {
        const i = sibling ? this._children.indexOf(sibling) : this._children.length - 1;
        this.insert_child_at_index(child, i < 0 ? -1 : i + 1);
    }

    insert_child_below(child, sibling) {
        const i = sibling ? this._children.indexOf(sibling) : 0;
        this.insert_child_at_index(child, i < 0 ? 0 : i);
    }

    remove_child(child) {
        const i = this._children.indexOf(child);
        if (i < 0)
            return;
        this._children.splice(i, 1);
        child._parent = null;
        if (this._binMain === child)
            this._binMain = null;
        const w = child._outer;
        if (this._gnoshUnpack)
            this._gnoshUnpack(child);
        else if (w?.get_parent())
            w.get_parent().remove(w);
        if (!child._destroyed) {
            child.emit('parent-set', this);
            child.vfunc_parent_set(this);
        }
        this.emit('child-removed', child);
        this._gnoshChildrenChanged?.();
    }

    remove_actor(child) {
        this.remove_child(child);
    }

    remove_all_children() {
        for (const child of [...this._children])
            this.remove_child(child);
    }

    destroy_all_children() {
        for (const child of [...this._children])
            child.destroy();
    }

    replace_child(oldChild, newChild) {
        const i = this._children.indexOf(oldChild);
        if (i < 0)
            return;
        this.remove_child(oldChild);
        this.insert_child_at_index(newChild, i);
    }

    set_child_at_index(child, index) {
        const i = this._children.indexOf(child);
        if (i < 0)
            return;
        this._children.splice(i, 1);
        const n = this._children.length;
        const at = index < 0 || index > n ? n : index;
        this._children.splice(at, 0, child);
        const container = this._gnoshChildContainer;
        if (container instanceof Gtk.Box)
            container.reorder_child(child._outer, at);
        else
            this._gnoshPack(child, at);
        this._gnoshChildrenChanged?.();
    }

    set_child_above_sibling(child, sibling) {
        const j = sibling ? this._children.indexOf(sibling) : this._children.length - 1;
        const i = this._children.indexOf(child);
        this.set_child_at_index(child, sibling ? (i < j ? j : j + 1) : this._children.length - 1);
    }

    set_child_below_sibling(child, sibling) {
        const j = sibling ? this._children.indexOf(sibling) : 0;
        const i = this._children.indexOf(child);
        this.set_child_at_index(child, sibling ? (i < j ? j - 1 : j) : 0);
    }

    get_children() {
        return [...this._children];
    }

    get_n_children() {
        return this._children.length;
    }

    get_child_at_index(i) {
        return this._children[i] ?? null;
    }

    get_first_child() {
        return this._children[0] ?? null;
    }

    get_last_child() {
        return this._children[this._children.length - 1] ?? null;
    }

    get first_child() {
        return this.get_first_child();
    }

    get last_child() {
        return this.get_last_child();
    }

    get_next_sibling() {
        if (!this._parent)
            return null;
        const kids = this._parent._children;
        return kids[kids.indexOf(this) + 1] ?? null;
    }

    get_previous_sibling() {
        if (!this._parent)
            return null;
        const kids = this._parent._children;
        return kids[kids.indexOf(this) - 1] ?? null;
    }

    get_parent() {
        return this._parent;
    }

    contains(descendant) {
        for (let a = descendant; a; a = a._parent) {
            if (a === this)
                return true;
        }
        return false;
    }

    get_stage() {
        let a = this;
        while (a._parent)
            a = a._parent;
        return a._gnoshIsStage ? a : globalThis.global?.stage ?? null;
    }

    // --- visibility & state ---

    show() {
        this.visible = true;
    }

    hide() {
        this.visible = false;
    }

    show_all() {
        this.show();
        this._children.forEach(c => c.show_all?.());
    }

    is_visible() {
        return this.visible;
    }

    get_visible() {
        return this.visible;
    }

    set_visible(v) {
        this.visible = v;
    }

    is_mapped() {
        return this._p.mapped ?? false;
    }

    is_realized() {
        return this._outer?.get_realized() ?? false;
    }

    get realized() {
        return this.is_realized();
    }

    map() {}

    unmap() {}

    realize() {}

    unrealize() {}

    destroy() {
        if (this._destroyed)
            return;
        this._destroyed = true;
        try {
            this.emit('destroy');
        } catch (e) {
            logError(e, 'gnosh: destroy handler');
        }
        this.vfunc_destroy();
        for (const child of [...this._children])
            child.destroy();
        this._parent?.remove_child(this);
        for (const t of this._transitions.values())
            t.stop?.();
        this._transitions.clear();
        if (this._outer) {
            const w = this._outer;
            this._outer = null;
            w.destroy();
        }
        this.run_dispose();
    }

    queue_relayout() {
        this._outer?.queue_resize();
        this.emit('queue-relayout');
    }

    queue_redraw() {
        this._inner?.queue_draw();
    }

    queue_redraw_with_clip() {
        this.queue_redraw();
    }

    // --- geometry ---

    get_allocation_box() {
        if (!this._outer?.get_realized())
            return new ActorBox(0, 0, 0, 0);
        const a = this._outer.get_allocation();
        const [x, y] = this.get_transformed_position();
        return new ActorBox(x, y, x + a.width, y + a.height);
    }

    get allocation() {
        return this.get_allocation_box();
    }

    get_width() {
        return this._outer?.get_realized() ? this._outer.get_allocated_width() : Math.max(this._p.width ?? 0, 0);
    }

    get_height() {
        return this._outer?.get_realized() ? this._outer.get_allocated_height() : Math.max(this._p.height ?? 0, 0);
    }

    get_size() {
        return [this.get_width(), this.get_height()];
    }

    set_width(w) {
        this.width = w;
    }

    set_height(h) {
        this.height = h;
    }

    set_size(w, h) {
        this.width = w;
        this.height = h;
    }

    get_x() {
        return this._p.x ?? 0;
    }

    get_y() {
        return this._p.y ?? 0;
    }

    set_x(x) {
        this.x = x;
    }

    set_y(y) {
        this.y = y;
    }

    get_position() {
        return [this.get_x(), this.get_y()];
    }

    set_position(x, y) {
        this.x = x;
        this.y = y;
    }

    get_fixed_position() {
        return [true, this.get_x(), this.get_y()];
    }

    get_transformed_position() {
        const w = this._outer;
        if (!w?.get_realized())
            return [0, 0];
        const top = w.get_toplevel();
        const res = w.translate_coordinates(top, 0, 0);
        return res && res[0] !== false ? [res[1] ?? 0, res[2] ?? 0] : [0, 0];
    }

    get_transformed_size() {
        return this.get_size();
    }

    get_transformed_extents() {
        const [x, y] = this.get_transformed_position();
        const [w, h] = this.get_size();
        return {origin: {x, y}, size: {width: w, height: h}, get_x: () => x, get_y: () => y,
            get_width: () => w, get_height: () => h};
    }

    get_abs_allocation_vertices() {
        const b = this.get_allocation_box();
        return [{x: b.x1, y: b.y1}, {x: b.x2, y: b.y1}, {x: b.x1, y: b.y2}, {x: b.x2, y: b.y2}];
    }

    transform_stage_point(x, y) {
        const local = this._gnoshLocalCoords(x, y);
        return local ? [true, ...local] : [false, 0, 0];
    }

    /** Root (screen) coordinates -> coordinates inside this actor. */
    _gnoshLocalCoords(rootX, rootY) {
        const w = this._outer;
        const win = w?.get_window();
        if (!win)
            return null;
        const alloc = w.get_allocation();
        const [ox, oy] = win.get_root_coords(alloc.x, alloc.y);
        return [rootX - ox, rootY - oy];
    }

    apply_transform_to_point(p) {
        return p;
    }

    apply_relative_transform_to_point(ancestor, p) {
        return p;
    }

    get_preferred_width(forHeight = -1) {
        return this.vfunc_get_preferred_width(forHeight);
    }

    get_preferred_height(forWidth = -1) {
        return this.vfunc_get_preferred_height(forWidth);
    }

    get_preferred_size() {
        const [mw, nw] = this.get_preferred_width(-1);
        const [mh, nh] = this.get_preferred_height(-1);
        return [mw, mh, nw, nh];
    }

    allocate() {}

    allocate_preferred_size() {}

    allocate_align_fill() {}

    set_allocation() {}

    has_allocation() {
        return this.is_realized();
    }

    needs_expand(orientation) {
        return orientation === E.Orientation.VERTICAL ? this.y_expand : this.x_expand;
    }

    // --- simple property helpers ---

    get_name() {
        return this.name;
    }

    set_name(n) {
        this.name = n;
    }

    get_reactive() {
        return this.reactive;
    }

    set_reactive(r) {
        this.reactive = r;
    }

    get_opacity() {
        return this.opacity;
    }

    set_opacity(o) {
        this.opacity = o;
    }

    get_paint_opacity() {
        return this.opacity;
    }

    get_paint_visibility() {
        return this.visible;
    }

    set_x_expand(v) {
        this.x_expand = v;
    }

    get_x_expand() {
        return this.x_expand;
    }

    set_y_expand(v) {
        this.y_expand = v;
    }

    get_y_expand() {
        return this.y_expand;
    }

    set_x_align(v) {
        this.x_align = v;
    }

    get_x_align() {
        return this.x_align;
    }

    set_y_align(v) {
        this.y_align = v;
    }

    get_y_align() {
        return this.y_align;
    }

    set_layout_manager(lm) {
        this.layout_manager = lm;
    }

    get_layout_manager() {
        return this.layout_manager;
    }

    set_margin(m) {
        Object.assign(this, {margin_top: m.top, margin_bottom: m.bottom, margin_left: m.left, margin_right: m.right});
    }

    get_margin() {
        return new Margin({left: this.margin_left, right: this.margin_right, top: this.margin_top, bottom: this.margin_bottom});
    }

    set_margin_top(v) {
        this.margin_top = v;
    }

    set_margin_bottom(v) {
        this.margin_bottom = v;
    }

    set_margin_left(v) {
        this.margin_left = v;
    }

    set_margin_right(v) {
        this.margin_right = v;
    }

    set_clip_to_allocation(v) {
        this.clip_to_allocation = v;
    }

    get_clip_to_allocation() {
        return this.clip_to_allocation;
    }

    set_clip() {}

    remove_clip() {}

    has_clip() {
        return false;
    }

    get_clip() {
        return [0, 0, 0, 0];
    }

    set_request_mode(m) {
        this.request_mode = m;
    }

    get_request_mode() {
        return this.request_mode;
    }

    set_fixed_position_set(v) {
        this.fixed_position_set = v;
    }

    set_pivot_point(x, y) {
        this.pivot_point = {x, y};
    }

    get_pivot_point() {
        return [this.pivot_point?.x ?? 0, this.pivot_point?.y ?? 0];
    }

    set_scale(sx, sy) {
        this.scale_x = sx;
        this.scale_y = sy;
    }

    get_scale() {
        return [this.scale_x, this.scale_y];
    }

    set_translation(x, y, z) {
        this.translation_x = x;
        this.translation_y = y;
        this.translation_z = z;
    }

    get_translation() {
        return [this.translation_x, this.translation_y, this.translation_z];
    }

    set_rotation_angle(axis, angle) {
        if (axis === E.RotateAxis?.X_AXIS)
            this.rotation_angle_x = angle;
        else if (axis === E.RotateAxis?.Y_AXIS)
            this.rotation_angle_y = angle;
        else
            this.rotation_angle_z = angle;
    }

    get_rotation_angle() {
        return this.rotation_angle_z;
    }

    set_z_position(z) {
        this.z_position = z;
    }

    set_background_color(c) {
        this.background_color = c;
        if (this._inner) {
            this._bgState ??= {};
            const css = c ? `background-color: rgba(${c.red},${c.green},${c.blue},${(c.alpha ?? 255) / 255});` : '';
            this._gnoshExtraCss('background', css);
        }
    }

    get_background_color() {
        return this.background_color;
    }

    set_content(c) {
        this.content = c;
    }

    get_content() {
        return this.content;
    }

    set_content_gravity(g) {
        this.content_gravity = g;
    }

    set_content_scaling_filters() {}

    set_offscreen_redirect(v) {
        this.offscreen_redirect = v;
    }

    set_text_direction(d) {
        this.text_direction = d;
    }

    get_text_direction() {
        return this.text_direction;
    }

    get_resource_scale() {
        return this._outer?.get_scale_factor() ?? 1;
    }

    get_accessible() {
        return this._outer?.get_accessible() ?? null;
    }

    set_accessible_name(n) {
        this.accessible_name = n;
    }

    get_accessible_name() {
        return this.accessible_name;
    }

    set_accessible_role(r) {
        this.accessible_role = r;
    }

    get_accessible_role() {
        return this.accessible_role;
    }

    set_child_transform() {}

    // Construct-time `constraints: [...]` / `actions` / `effects`
    set constraints(list) {
        for (const c of [].concat(list ?? []))
            this.add_constraint(c);
    }

    get constraints() {
        return this.get_constraints();
    }

    set actions(list) {
        for (const a of [].concat(list ?? []))
            this.add_action(a);
    }

    get actions() {
        return this.get_actions();
    }

    set effects(list) {
        for (const e of [].concat(list ?? []))
            this.add_effect(e);
    }

    get effects() {
        return this.get_effects();
    }

    // Clutter 49+ accessibility state API.
    add_accessible_state() {}

    remove_accessible_state() {}

    get_accessible_state() {
        return 0;
    }

    set_accessible() {}

    set_easing_duration() {}

    get_easing_duration() {
        return 0;
    }

    set_easing_mode() {}

    get_easing_mode() {
        return E.AnimationMode.EASE_OUT_QUAD;
    }

    set_easing_delay() {}

    save_easing_state() {}

    restore_easing_state() {}

    remove_all_transitions() {
        for (const t of this._transitions.values())
            t.stop?.();
        this._transitions.clear();
    }

    remove_transition(name) {
        this._transitions.get(name)?.stop?.();
        this._transitions.delete(name);
    }

    get_transition(name) {
        return this._transitions.get(name) ?? null;
    }

    add_transition(name, t) {
        this._transitions.set(name, t);
    }

    // Effects, actions and constraints are kept so code that looks them up
    // keeps working; they do not change rendering.
    add_effect(effect) {
        this.add_effect_with_name(effect?.name ?? `effect${this._effects.size}`, effect);
    }

    add_effect_with_name(name, effect) {
        this._effects.set(name, effect);
        effect?.set_actor?.(this);
    }

    remove_effect(effect) {
        for (const [k, v] of this._effects) {
            if (v === effect)
                this._effects.delete(k);
        }
    }

    remove_effect_by_name(name) {
        this._effects.delete(name);
    }

    get_effect(name) {
        return this._effects.get(name) ?? null;
    }

    get_effects() {
        return [...this._effects.values()];
    }

    clear_effects() {
        this._effects.clear();
    }

    has_effects() {
        return this._effects.size > 0;
    }

    add_action(action) {
        this._actions.push(action);
        action?._gnoshAttach?.(this);
    }

    add_action_with_name(name, action) {
        action.name = name;
        this.add_action(action);
    }

    add_action_full(name, phase, action) {
        this.add_action_with_name(name, action);
    }

    remove_action(action) {
        this._actions = this._actions.filter(a => a !== action);
        action?._gnoshDetach?.(this);
    }

    remove_action_by_name(name) {
        for (const a of this._actions.filter(x => x.name === name))
            this.remove_action(a);
    }

    get_action(name) {
        return this._actions.find(a => a.name === name) ?? null;
    }

    get_actions() {
        return [...this._actions];
    }

    clear_actions() {
        for (const a of [...this._actions])
            this.remove_action(a);
    }

    add_constraint(c) {
        this._constraints.push(c);
    }

    add_constraint_with_name(name, c) {
        c.name = name;
        this.add_constraint(c);
    }

    remove_constraint(c) {
        this._constraints = this._constraints.filter(x => x !== c);
    }

    remove_constraint_by_name(name) {
        this._constraints = this._constraints.filter(x => x.name !== name);
    }

    get_constraint(name) {
        return this._constraints.find(c => c.name === name) ?? null;
    }

    get_constraints() {
        return [...this._constraints];
    }

    clear_constraints() {
        this._constraints = [];
    }

    grab_key_focus() {
        const w = this._gnoshFocusWidget ?? this._inner;
        if (w?.get_can_focus())
            w.grab_focus();
        else
            this._outer?.grab_focus();
    }

    has_key_focus() {
        return (this._gnoshFocusWidget ?? this._inner)?.has_focus ?? false;
    }

    grab() {
        return {dismiss: () => {}, get_seat_state: () => 0};
    }

    get_stage_views() {
        return [];
    }

    peek_stage_views() {
        return [];
    }

    is_effectively_on_stage_view() {
        return true;
    }

    get_pango_context() {
        return this._inner?.get_pango_context() ?? null;
    }

    create_pango_context() {
        return this._inner?.create_pango_context() ?? null;
    }

    create_pango_layout(text) {
        return this._inner?.create_pango_layout(text) ?? null;
    }

    is_in_clone_paint() {
        return false;
    }

    has_mapped_clones() {
        return false;
    }

    inhibit_culling() {}

    uninhibit_culling() {}

    continue_paint() {}

    get_paint_box() {
        return [false, null];
    }

    _gnoshExtraCss(slot, css) {
        this._extraCss ??= {};
        this._extraCss[slot] = css;
        this._gnoshApplyCss?.();
    }

    // Debug helpers.
    toString() {
        return `[actor ${this.constructor.name}${this.name ? ` "${this.name}"` : ''}]`;
    }
});
installAccessors(Actor, ACTOR_PROPERTIES);

// first-child/last-child are computed.
for (const key of ['first_child', 'last_child', 'firstChild', 'lastChild']) {
    const getter = key.startsWith('first') ? 'get_first_child' : 'get_last_child';
    Object.defineProperty(Actor.prototype, key, {configurable: true, get() {
        return this[getter]();
    }});
}

export function alignToGtk(align) {
    switch (align) {
    case E.ActorAlign.START:
        return Gtk.Align.START;
    case E.ActorAlign.CENTER:
        return Gtk.Align.CENTER;
    case E.ActorAlign.END:
        return Gtk.Align.END;
    default:
        return Gtk.Align.FILL;
    }
}

/** Find the actor that owns a GTK widget (walking up). */
export function actorForWidget(widget) {
    for (let w = widget; w; w = w.get_parent()) {
        if (w._gnoshActor)
            return w._gnoshActor;
    }
    return null;
}
