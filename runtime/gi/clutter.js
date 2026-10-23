// SPDX-License-Identifier: GPL-3.0-or-later
//
// The Clutter namespace as GNOME Shell extensions see it.

import Gdk from 'gi://Gdk?version=3.0';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk?version=3.0';

import {
    Actor, ActorBox, BinLayout, BoxLayout, Event, FixedLayout, FlowLayout, GridLayout,
    LayoutManager, Margin, P, installAccessors, makeProperties,
} from './actor.js';
import {Color} from './color.js';
import {Text} from './text.js';
import {Clutter as E} from './enums.js';

export {Actor, ActorBox, BinLayout, BoxLayout, Color, Event, FixedLayout, FlowLayout, GridLayout, LayoutManager, Margin, Text};

// --- Plain value types ---------------------------------------------------------

export class Point {
    constructor(params = {}) {
        this.x = params.x ?? 0;
        this.y = params.y ?? 0;
    }

    static alloc() {
        return new Point();
    }

    init(x, y) {
        this.x = x;
        this.y = y;
        return this;
    }

    distance(o) {
        const dx = this.x - o.x, dy = this.y - o.y;
        return [Math.hypot(dx, dy), dx, dy];
    }

    equals(o) {
        return o && o.x === this.x && o.y === this.y;
    }
}

export class Size {
    constructor(params = {}) {
        this.width = params.width ?? 0;
        this.height = params.height ?? 0;
    }

    init(w, h) {
        this.width = w;
        this.height = h;
        return this;
    }
}

export class Vertex {
    constructor(params = {}) {
        this.x = params.x ?? 0;
        this.y = params.y ?? 0;
        this.z = params.z ?? 0;
    }
}

export class Rect {
    constructor(params = {}) {
        this.origin = new Point(params.origin);
        this.size = new Size(params.size);
    }

    init(x, y, w, h) {
        this.origin.init(x, y);
        this.size.init(w, h);
        return this;
    }

    get_x() {
        return this.origin.x;
    }

    get_y() {
        return this.origin.y;
    }

    get_width() {
        return this.size.width;
    }

    get_height() {
        return this.size.height;
    }
}

// --- Stage ---------------------------------------------------------------------

export const Stage = GObject.registerClass({
    GTypeName: 'GnoshClutterStage',
    Properties: makeProperties({'key-focus': P.object(Actor)}),
    Signals: {'before-paint': {}, 'after-paint': {}, 'presented': {}, 'deactivate': {}, 'activate': {}},
}, class Stage extends Actor {
    _init(params) {
        super._init(params);
        this._gnoshIsStage = true;
    }

    get_width() {
        const m = primaryMonitorGeometry();
        return m.width;
    }

    get_height() {
        const m = primaryMonitorGeometry();
        return m.height;
    }

    get_key_focus() {
        return this._gnoshP.key_focus ?? null;
    }

    set_key_focus(actor) {
        if (actor && !(actor instanceof Actor)) {
            console.warn(`gnosh: Stage.set_key_focus() called with ${actor?.constructor?.name}; ignoring`);
            return;
        }
        this._gnoshP.key_focus = actor ?? null;
        actor?.grab_key_focus?.();
        this.notify('key-focus');
    }

    get_actor_at_pos() {
        return null;
    }

    get_device_actor() {
        return null;
    }

    get_grab_actor() {
        return null;
    }

    grab() {
        return new Grab();
    }

    is_redraw_queued_on_view() {
        return false;
    }

    get_frame_counter() {
        return 0;
    }

    ensure_viewport() {}

    schedule_update() {}

    get_capture_final_size() {
        return [false, 0, 0];
    }

    paint_to_buffer() {
        return false;
    }

    get_title() {
        return 'gnosh';
    }

    set_title() {}

    get_views() {
        return [];
    }
});
installAccessors(Stage, {'key-focus': P.object(Actor)});

export function primaryMonitorGeometry() {
    const display = Gdk.Display.get_default();
    const monitor = display?.get_primary_monitor() ?? display?.get_monitor(0);
    if (!monitor)
        return {x: 0, y: 0, width: 360, height: 720};
    const g = monitor.get_geometry();
    return {x: g.x, y: g.y, width: g.width, height: g.height};
}

export class Grab {
    dismiss() {}

    get_seat_state() {
        return 0;
    }
}

// --- Clone (cannot mirror GTK widgets, shows nothing) ----------------------------

export const Clone = GObject.registerClass({
    GTypeName: 'GnoshClutterClone',
    Properties: makeProperties({'source': P.object(Actor)}),
}, class Clone extends Actor {
    set_source(s) {
        this.source = s;
    }

    get_source() {
        return this.source;
    }
});
installAccessors(Clone, {'source': P.object(Actor)});

// --- Content -------------------------------------------------------------------

export const Image = GObject.registerClass({
    GTypeName: 'GnoshClutterImage',
}, class Image extends GObject.Object {
    static new() {
        return new Image();
    }

    set_data() {
        return true;
    }

    set_bytes() {
        return true;
    }

    set_area() {
        return true;
    }

    get_preferred_size() {
        return [false, 0, 0];
    }

    invalidate() {}
});

// --- Actions (input helpers) -----------------------------------------------------

const ActorMeta = GObject.registerClass({
    GTypeName: 'GnoshClutterActorMeta',
    Properties: makeProperties({'name': P.string(null), 'enabled': P.bool(true)}),
}, class ActorMeta extends GObject.Object {
    _init(params = {}) {
        this._gnoshP = {};
        super._init(params);
        this._gnoshConstructed = true;
    }

    get_actor() {
        return this._actor ?? null;
    }

    set_actor(a) {
        this._actor = a;
    }

    get_enabled() {
        return this.enabled;
    }

    set_enabled(e) {
        this.enabled = e;
    }

    get_name() {
        return this.name;
    }

    set_name(n) {
        this.name = n;
    }
});
installAccessors(ActorMeta, {'name': P.string(null), 'enabled': P.bool(true)});
export {ActorMeta};

export const Action = GObject.registerClass({GTypeName: 'GnoshClutterAction'}, class Action extends ActorMeta {
    _gnoshAttach(actor) {
        this._actor = actor;
    }

    _gnoshDetach() {
        this._actor = null;
    }
});

/** Clutter.ClickAction: 'clicked' after press+release on the actor. */
export const ClickAction = GObject.registerClass({
    GTypeName: 'GnoshClutterClickAction',
    Properties: makeProperties({'pressed': P.bool(false), 'held': P.bool(false),
        'long-press-duration': P.int(-1), 'long-press-threshold': P.int(-1)}),
    Signals: {
        'clicked': {param_types: [GObject.TYPE_OBJECT]},
        'long-press': {param_types: [GObject.TYPE_OBJECT, GObject.TYPE_INT], return_type: GObject.TYPE_BOOLEAN},
    },
}, class ClickAction extends Action {
    _gnoshAttach(actor) {
        super._gnoshAttach(actor);
        actor.reactive = true;
        this._ids = [
            actor.connect('button-press-event', (a, ev) => {
                if (!this.enabled)
                    return false;
                this._button = ev.get_button();
                this._state = ev.get_state();
                this.pressed = this.held = true;
                return false;
            }),
            actor.connect('button-release-event', () => {
                if (!this.enabled || !this.held)
                    return false;
                this.pressed = this.held = false;
                this.emit('clicked', actor);
                return false;
            }),
            actor.connect('leave-event', () => {
                this.pressed = false;
                return false;
            }),
        ];
    }

    _gnoshDetach(actor) {
        for (const id of this._ids ?? [])
            actor.disconnect(id);
        this._ids = [];
        super._gnoshDetach(actor);
    }

    get_button() {
        return this._button ?? 1;
    }

    get_state() {
        return this._state ?? 0;
    }

    get_coords() {
        return [0, 0];
    }

    release() {
        this.pressed = this.held = false;
    }
});
installAccessors(ClickAction, {'pressed': P.bool(false), 'held': P.bool(false),
    'long-press-duration': P.int(-1), 'long-press-threshold': P.int(-1)});

export const TapAction = GObject.registerClass({
    GTypeName: 'GnoshClutterTapAction',
    Signals: {'tap': {param_types: [GObject.TYPE_OBJECT]}},
}, class TapAction extends ClickAction {
    _gnoshAttach(actor) {
        super._gnoshAttach(actor);
        this.connect('clicked', () => this.emit('tap', actor));
    }
});

function noopActionClass(name, signals = {}) {
    return GObject.registerClass({GTypeName: `GnoshClutter${name}`, Signals: signals},
        class extends Action {});
}

export const GestureAction = noopActionClass('GestureAction', {
    'gesture-begin': {param_types: [GObject.TYPE_OBJECT], return_type: GObject.TYPE_BOOLEAN},
    'gesture-progress': {param_types: [GObject.TYPE_OBJECT], return_type: GObject.TYPE_BOOLEAN},
    'gesture-end': {param_types: [GObject.TYPE_OBJECT]},
    'gesture-cancel': {param_types: [GObject.TYPE_OBJECT]},
});
export const PanAction = noopActionClass('PanAction', {
    'pan': {param_types: [GObject.TYPE_OBJECT, GObject.TYPE_BOOLEAN], return_type: GObject.TYPE_BOOLEAN},
    'pan-stopped': {param_types: [GObject.TYPE_OBJECT]},
});
export const SwipeAction = noopActionClass('SwipeAction', {
    'swipe': {param_types: [GObject.TYPE_OBJECT, GObject.TYPE_INT], return_type: GObject.TYPE_BOOLEAN},
});
export const ZoomAction = noopActionClass('ZoomAction');
export const RotateAction = noopActionClass('RotateAction');
export const DragAction = noopActionClass('DragAction');
export const DropAction = noopActionClass('DropAction');
// --- Gestures (GNOME 49+ Clutter.Gesture API) ------------------------------------
//
// Driven by the actor's (emulated) pointer events. Touchscreen taps arrive
// as pointer events because gnosh widgets do not request touch events.

const GESTURE_PROPS = {'state': P.int(0)};

export const Gesture = GObject.registerClass({
    GTypeName: 'GnoshClutterGesture',
    Properties: makeProperties(GESTURE_PROPS),
    Signals: {
        'may-recognize': {return_type: GObject.TYPE_BOOLEAN, accumulator: GObject.AccumulatorType.FIRST_WINS},
        'recognize': {},
        'end': {},
        'cancel': {},
        'should-handle-sequence': {param_types: [GObject.TYPE_OBJECT], return_type: GObject.TYPE_BOOLEAN},
    },
}, class Gesture extends Action {
    _gnoshAttach(actor) {
        super._gnoshAttach(actor);
        this._ids = [
            actor.connect('button-press-event', (a, ev) => this.enabled ? this._gnoshPress(ev) : false),
            actor.connect('button-release-event', (a, ev) => this.enabled ? this._gnoshRelease(ev) : false),
            actor.connect('motion-event', (a, ev) => this.enabled ? this._gnoshMotion(ev) : false),
            actor.connect('leave-event', (a, ev) => this.enabled ? this._gnoshLeave(ev) : false),
        ];
    }

    _gnoshDetach(actor) {
        for (const id of this._ids ?? [])
            actor.disconnect(id);
        this._ids = [];
        super._gnoshDetach(actor);
    }

    _gnoshMayRecognize() {
        // No handler means "yes".
        const id = GObject.signal_lookup('may-recognize', this.constructor.$gtype);
        if (!GObject.signal_has_handler_pending(this, id, 0, true))
            return true;
        return this.emit('may-recognize');
    }

    _gnoshRecognize() {
        if (!this._gnoshMayRecognize())
            return false;
        this.state = E.GestureState?.RECOGNIZING ?? 2;
        this.emit('recognize');
        return true;
    }

    _gnoshEnd() {
        this.state = E.GestureState?.WAITING ?? 0;
        this.emit('end');
    }

    _gnoshPress() {
        return false;
    }

    _gnoshRelease() {
        return false;
    }

    _gnoshMotion() {
        return false;
    }

    _gnoshLeave() {
        return false;
    }

    set_allowed_device_types() {}

    can_not_cancel() {}

    get_n_points() {
        return this._points ?? 0;
    }

    get_points() {
        return [];
    }

    get_point_coords_abs() {
        return this.get_coords_abs?.() ?? {x: 0, y: 0};
    }

    get_point_event() {
        return this._lastEvent ?? null;
    }

    set_state(state) {
        this.state = state;
    }

    get_state() {
        return this.state;
    }

    cancel() {
        this.emit('cancel');
    }

    reset_state_machine() {}

    recognize_independently_from() {}
});
installAccessors(Gesture, GESTURE_PROPS);

const CLICK_PROPS = {
    'n-clicks-required': P.uint(1),
    'recognize-on-press': P.bool(false),
    'required-button': P.uint(0),
    'pressed': P.bool(false),
};

export const ClickGesture = GObject.registerClass({
    GTypeName: 'GnoshClutterClickGesture',
    Properties: makeProperties(CLICK_PROPS),
}, class ClickGesture extends Gesture {
    _buttonOk(ev) {
        return !this.required_button || ev.get_button() === this.required_button;
    }

    _gnoshPress(ev) {
        if (!this._buttonOk(ev))
            return false;
        this._lastEvent = ev;
        this._button = ev.get_button();
        this._stateMask = ev.get_state();
        this._coords = ev.get_coords();
        this._local = ev._gnoshLocal();
        this._points = 1;
        this.pressed = true;
        if (this.recognize_on_press) {
            this.pressed = false;
            this._points = 0;
            this._gnoshRecognize();
            this._gnoshEnd();
        }
        return true;
    }

    _gnoshRelease(ev) {
        if (!this.pressed)
            return false;
        this._lastEvent = ev;
        this.pressed = false;
        this._points = 0;
        this._gnoshRecognize();
        this._gnoshEnd();
        return true;
    }

    _gnoshLeave() {
        if (this.pressed) {
            this.pressed = false;
            this._points = 0;
            this.emit('cancel');
        }
        return false;
    }

    set_recognize_on_press(v) {
        this.recognize_on_press = v;
    }

    get_recognize_on_press() {
        return this.recognize_on_press;
    }

    set_required_button(b) {
        this.required_button = b;
    }

    get_required_button() {
        return this.required_button;
    }

    set_n_clicks_required(n) {
        this.n_clicks_required = n;
    }

    get_n_clicks_required() {
        return this.n_clicks_required;
    }

    get_button() {
        return this._button ?? 1;
    }

    get_state() {
        return this._stateMask ?? 0;
    }

    get_coords() {
        const [x, y] = this._local ?? [0, 0];
        return {x, y};
    }

    get_coords_abs() {
        const [x, y] = this._coords ?? [0, 0];
        return {x, y};
    }
});
installAccessors(ClickGesture, CLICK_PROPS);

export const LongPressGesture = GObject.registerClass({
    GTypeName: 'GnoshClutterLongPressGesture',
    Properties: makeProperties({'long-press-duration': P.int(500), 'cancel-threshold': P.int(36)}),
}, class LongPressGesture extends Gesture {
    _gnoshPress(ev) {
        this._lastEvent = ev;
        this._coords = ev.get_coords();
        this._local = ev._gnoshLocal();
        this._clearTimer();
        this._timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, this.long_press_duration > 0 ? this.long_press_duration : 500, () => {
            this._timer = 0;
            this._fired = true;
            this._gnoshRecognize();
            return GLib.SOURCE_REMOVE;
        });
        return false;
    }

    _clearTimer() {
        if (this._timer)
            GLib.source_remove(this._timer);
        this._timer = 0;
    }

    _gnoshRelease() {
        this._clearTimer();
        if (this._fired) {
            this._fired = false;
            this._gnoshEnd();
            return true;
        }
        return false;
    }

    _gnoshLeave() {
        this._clearTimer();
        return false;
    }

    get_coords() {
        const [x, y] = this._local ?? [0, 0];
        return {x, y};
    }

    get_coords_abs() {
        const [x, y] = this._coords ?? [0, 0];
        return {x, y};
    }

    set_long_press_duration(d) {
        this.long_press_duration = d;
    }

    get_button() {
        return this._lastEvent?.get_button() ?? 1;
    }
});
installAccessors(LongPressGesture, {'long-press-duration': P.int(500), 'cancel-threshold': P.int(36)});

const PAN_PROPS = {'begin-threshold': P.uint(16), 'pan-axis': P.int(2), 'min-n-points': P.uint(1), 'max-n-points': P.uint(0)};

export const PanGesture = GObject.registerClass({
    GTypeName: 'GnoshClutterPanGesture',
    Properties: makeProperties(PAN_PROPS),
    Signals: {'pan-update': {param_types: [GObject.TYPE_DOUBLE, GObject.TYPE_DOUBLE, GObject.TYPE_DOUBLE]}},
}, class PanGesture extends Gesture {
    _gnoshPress(ev) {
        this._lastEvent = ev;
        this._start = ev.get_coords();
        this._abs = this._start;
        this._local = ev._gnoshLocal();
        this._down = true;
        this._recognized = false;
        this._delta = [0, 0];
        this._points = 1;
        if (this.begin_threshold === 0) {
            this._recognized = this._gnoshRecognize();
            return this._recognized;
        }
        return false;
    }

    _gnoshMotion(ev) {
        if (!this._down)
            return false;
        const [x, y] = ev.get_coords();
        const dx = x - this._abs[0], dy = y - this._abs[1];
        this._abs = [x, y];
        this._local = ev._gnoshLocal();
        this._delta = [x - this._start[0], y - this._start[1]];
        if (!this._recognized && Math.hypot(...this._delta) >= this.begin_threshold)
            this._recognized = this._gnoshRecognize();
        if (this._recognized)
            this.emit('pan-update', dx, dy, Math.hypot(dx, dy));
        return this._recognized;
    }

    _gnoshRelease(ev) {
        if (!this._down)
            return false;
        this._down = false;
        this._points = 0;
        this._local = ev._gnoshLocal();
        if (this._recognized) {
            this._recognized = false;
            this._gnoshEnd();
            return true;
        }
        return false;
    }

    set_begin_threshold(t) {
        this.begin_threshold = t;
    }

    get_begin_threshold() {
        return this.begin_threshold;
    }

    set_pan_axis(a) {
        this.pan_axis = a;
    }

    set_min_n_points(n) {
        this.min_n_points = n;
    }

    set_max_n_points(n) {
        this.max_n_points = n;
    }

    get_centroid() {
        const [x, y] = this._local ?? [0, 0];
        return {x, y};
    }

    get_centroid_abs() {
        const [x, y] = this._abs ?? [0, 0];
        return {x, y};
    }

    get_accumulated_delta() {
        const [x, y] = this._delta ?? [0, 0];
        return {x, y};
    }

    get_accumulated_delta_abs() {
        return this.get_accumulated_delta();
    }

    get_velocity() {
        return [0, 0];
    }

    get_velocity_abs() {
        return [0, 0];
    }
});
installAccessors(PanGesture, PAN_PROPS);

// --- Constraints and effects (no rendering effect under GTK) ---------------------

export const Constraint = GObject.registerClass({GTypeName: 'GnoshClutterConstraint'}, class Constraint extends ActorMeta {});

function constraintClass(name, defs) {
    const klass = GObject.registerClass({GTypeName: `GnoshClutter${name}`, Properties: makeProperties(defs)},
        class extends Constraint {});
    installAccessors(klass, defs);
    return klass;
}

export const BindConstraint = constraintClass('BindConstraint', {'source': P.object(Actor), 'coordinate': P.int(0), 'offset': P.float(0)});
export const AlignConstraint = constraintClass('AlignConstraint', {'source': P.object(Actor), 'align-axis': P.int(0), 'factor': P.float(0), 'pivot-point': P.js(null)});
export const SnapConstraint = constraintClass('SnapConstraint', {'source': P.object(Actor), 'from-edge': P.int(0), 'to-edge': P.int(0), 'offset': P.float(0)});
export const PathConstraint = constraintClass('PathConstraint', {'offset': P.float(0)});

export const Effect = GObject.registerClass({GTypeName: 'GnoshClutterEffect'}, class Effect extends ActorMeta {
    queue_repaint() {}
});

function effectClass(name, defs) {
    const klass = GObject.registerClass({GTypeName: `GnoshClutter${name}`, Properties: makeProperties(defs)},
        class extends Effect {
            set_shader_source() {}

            set_uniform_value() {}

            get_uniform_location() {
                return 0;
            }

            set_factor(f) {
                this.factor = f;
            }

            set_brightness() {}

            set_contrast() {}

            set_tint() {}
        });
    installAccessors(klass, defs);
    return klass;
}

export const OffscreenEffect = effectClass('OffscreenEffect', {});
export const ShaderEffect = effectClass('ShaderEffect', {'shader-type': P.int(0)});
export const DeformEffect = effectClass('DeformEffect', {});
export const DesaturateEffect = effectClass('DesaturateEffect', {'factor': P.double(1)});
export const BrightnessContrastEffect = effectClass('BrightnessContrastEffect', {'brightness': P.js(null), 'contrast': P.js(null)});
export const ColorizeEffect = effectClass('ColorizeEffect', {'tint': P.js(null)});
export const BlurEffect = effectClass('BlurEffect', {});
export const PageTurnEffect = effectClass('PageTurnEffect', {});

// --- Timelines and transitions ----------------------------------------------------

export const Timeline = GObject.registerClass({
    GTypeName: 'GnoshClutterTimeline',
    Properties: makeProperties({'duration': P.uint(1000), 'repeat-count': P.int(0), 'delay': P.uint(0),
        'auto-reverse': P.bool(false), 'direction': P.int(0), 'progress-mode': P.int(E.AnimationMode.LINEAR),
        'actor': P.object(Actor), 'frame-clock': P.js(null)}),
    Signals: {
        'started': {}, 'completed': {}, 'paused': {}, 'stopped': {param_types: [GObject.TYPE_BOOLEAN]},
        'new-frame': {param_types: [GObject.TYPE_INT]}, 'marker-reached': {param_types: [GObject.TYPE_STRING, GObject.TYPE_INT]},
    },
}, class Timeline extends GObject.Object {
    _init(params = {}) {
        this._gnoshP = {};
        super._init(params);
        this._gnoshConstructed = true;
        this._elapsed = 0;
        this._timer = 0;
    }

    start() {
        if (this._timer)
            return;
        this.emit('started');
        const start = GLib.get_monotonic_time() / 1000;
        this._timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 16, () => {
            this._elapsed = Math.min(this.duration, GLib.get_monotonic_time() / 1000 - start);
            this.emit('new-frame', this._elapsed);
            if (this._elapsed >= this.duration) {
                this._timer = 0;
                this.emit('completed');
                this.emit('stopped', true);
                return GLib.SOURCE_REMOVE;
            }
            return GLib.SOURCE_CONTINUE;
        });
    }

    stop() {
        if (this._timer) {
            GLib.source_remove(this._timer);
            this._timer = 0;
            this.emit('stopped', false);
        }
        this._elapsed = 0;
    }

    pause() {
        if (this._timer) {
            GLib.source_remove(this._timer);
            this._timer = 0;
        }
        this.emit('paused');
    }

    rewind() {
        this._elapsed = 0;
    }

    skip(ms) {
        this._elapsed += ms;
    }

    advance(ms) {
        this._elapsed = ms;
    }

    is_playing() {
        return this._timer !== 0;
    }

    get_elapsed_time() {
        return this._elapsed;
    }

    get_progress() {
        return this.duration ? this._elapsed / this.duration : 1;
    }

    get_duration() {
        return this.duration;
    }

    set_duration(d) {
        this.duration = d;
    }

    set_progress_mode(m) {
        this.progress_mode = m;
    }

    set_repeat_count(c) {
        this.repeat_count = c;
    }

    get_delta() {
        return 16;
    }

    add_marker() {}

    add_marker_at_time() {}

    remove_marker() {}

    has_marker() {
        return false;
    }

    set_auto_reverse(v) {
        this.auto_reverse = v;
    }

    set_direction(d) {
        this.direction = d;
    }

    get_direction() {
        return this.direction;
    }

    set_delay(d) {
        this.delay = d;
    }

    get_actor() {
        return this.actor;
    }

    set_actor(a) {
        this.actor = a;
    }
});
installAccessors(Timeline, {'duration': P.uint(1000), 'repeat-count': P.int(0), 'delay': P.uint(0),
    'auto-reverse': P.bool(false), 'direction': P.int(0), 'progress-mode': P.int(E.AnimationMode.LINEAR),
    'actor': P.object(Actor), 'frame-clock': P.js(null)});

export const Transition = GObject.registerClass({
    GTypeName: 'GnoshClutterTransition',
    Properties: makeProperties({'remove-on-complete': P.bool(false), 'interval': P.js(null), 'animatable': P.js(null)}),
}, class Transition extends Timeline {
    set_from() {}

    set_to() {}

    set_animatable(a) {
        this.animatable = a;
    }

    set_interval(i) {
        this.interval = i;
    }
});
installAccessors(Transition, {'remove-on-complete': P.bool(false), 'interval': P.js(null), 'animatable': P.js(null)});

export const PropertyTransition = GObject.registerClass({
    GTypeName: 'GnoshClutterPropertyTransition',
    Properties: makeProperties({'property-name': P.string(null)}),
}, class PropertyTransition extends Transition {});
installAccessors(PropertyTransition, {'property-name': P.string(null)});

export const KeyframeTransition = GObject.registerClass({GTypeName: 'GnoshClutterKeyframeTransition'},
    class KeyframeTransition extends PropertyTransition {
        set_key_frames() {}

        set_values() {}

        set_modes() {}
    });

export const TransitionGroup = GObject.registerClass({GTypeName: 'GnoshClutterTransitionGroup'},
    class TransitionGroup extends Transition {
        add_transition() {}

        remove_transition() {}

        remove_all() {}
    });

export class Interval {
    constructor(params = {}) {
        Object.assign(this, params);
    }

    static new_with_values(type, from, to) {
        return new Interval({value_type: type, initial: from, final: to});
    }

    set_initial(v) {
        this.initial = v;
    }

    set_final(v) {
        this.final = v;
    }

    get_initial_value() {
        return this.initial;
    }

    get_final_value() {
        return this.final;
    }
}

// --- Backend, seat, keymap, input devices -----------------------------------------

export const Keymap = GObject.registerClass({
    GTypeName: 'GnoshClutterKeymap',
    Signals: {'state-changed': {}, 'keys-changed': {}},
}, class Keymap extends GObject.Object {
    _init() {
        super._init();
        this._gdk = Gdk.Keymap.get_for_display(Gdk.Display.get_default());
        this._gdk?.connect('state-changed', () => this.emit('state-changed'));
        this._gdk?.connect('keys-changed', () => this.emit('keys-changed'));
    }

    get_caps_lock_state() {
        return this._gdk?.get_caps_lock_state() ?? false;
    }

    get_num_lock_state() {
        return this._gdk?.get_num_lock_state() ?? false;
    }

    get_direction() {
        return 0;
    }

    get_modifier_state() {
        return this._gdk?.get_modifier_state() ?? 0;
    }
});

export const VirtualInputDevice = GObject.registerClass({GTypeName: 'GnoshClutterVirtualInputDevice'},
    class VirtualInputDevice extends GObject.Object {
        // Synthesizing input is not possible from inside Phosh without a
        // virtual-keyboard client; these calls are accepted and ignored.
        notify_keyval() {}

        notify_key() {}

        notify_button() {}

        notify_relative_motion() {}

        notify_absolute_motion() {}

        notify_scroll_discrete() {}

        notify_scroll_continuous() {}

        notify_touch_down() {}

        notify_touch_motion() {}

        notify_touch_up() {}

        get_device_type() {
            return E.InputDeviceType.KEYBOARD_DEVICE;
        }
    });

let _keymap = null;

export const Seat = GObject.registerClass({
    GTypeName: 'GnoshClutterSeat',
    Signals: {'device-added': {param_types: [GObject.TYPE_OBJECT]}, 'device-removed': {param_types: [GObject.TYPE_OBJECT]},
        'kbd-a11y-flags-changed': {param_types: [GObject.TYPE_UINT, GObject.TYPE_UINT]},
        'kbd-a11y-mods-state-changed': {param_types: [GObject.TYPE_UINT, GObject.TYPE_UINT]},
        'tool-changed': {param_types: [GObject.TYPE_OBJECT, GObject.TYPE_OBJECT]}, 'is-unfocus-inhibited-changed': {}},
}, class Seat extends GObject.Object {
    get_keymap() {
        _keymap ??= new Keymap();
        return _keymap;
    }

    create_virtual_device() {
        return new VirtualInputDevice();
    }

    get_pointer() {
        return null;
    }

    get_keyboard() {
        return null;
    }

    list_devices() {
        return [];
    }

    peek_devices() {
        return [];
    }

    get_supported_virtual_device_types() {
        return 0;
    }

    bell_notify() {
        Gdk.Display.get_default()?.beep();
    }

    get_touch_mode() {
        return true;
    }

    query_state() {
        return [false, null, 0];
    }

    warp_pointer() {}

    inhibit_unfocus() {}

    uninhibit_unfocus() {}

    is_unfocus_inhibited() {
        return false;
    }

    get_kbd_a11y_settings() {
        return {};
    }

    set_kbd_a11y_settings() {}
});

let _seat = null;
let _backend = null;

export const Backend = GObject.registerClass({
    GTypeName: 'GnoshClutterBackend',
    Signals: {'font-changed': {}, 'resolution-changed': {}, 'settings-changed': {}},
}, class Backend extends GObject.Object {
    get_default_seat() {
        _seat ??= new Seat();
        return _seat;
    }

    get_input_method() {
        return null;
    }

    set_input_method() {}

    get_resolution() {
        return 96;
    }

    get_font_options() {
        return null;
    }

    get_cogl_context() {
        return null;
    }
});

export function get_default_backend() {
    _backend ??= new Backend();
    return _backend;
}

export function get_current_event() {
    return null;
}

export function get_current_event_time() {
    return Gtk.get_current_event_time();
}

export function keysym_to_unicode(keyval) {
    return Gdk.keyval_to_unicode(keyval);
}

export function unicode_to_keysym(c) {
    return Gdk.unicode_to_keyval(c);
}

export function get_accessibility_enabled() {
    return true;
}

export function get_default_text_direction() {
    return Gtk.Widget.get_default_direction() === Gtk.TextDirection.RTL ? E.TextDirection.RTL : E.TextDirection.LTR;
}

export function threads_add_timeout(priority, interval, func) {
    return GLib.timeout_add(priority, interval, func);
}

export function threads_add_idle(priority, func) {
    return GLib.idle_add(priority, func);
}

export function value_set_color() {}

let _settings = null;

export const Settings = GObject.registerClass({
    GTypeName: 'GnoshClutterSettings',
    Properties: makeProperties({'double-click-time': P.int(400), 'double-click-distance': P.int(5),
        'dnd-drag-threshold': P.int(8), 'font-dpi': P.int(96 * 1024), 'long-press-duration': P.int(500),
        'font-name': P.string('Sans 11'), 'unscaled-font-dpi': P.int(96 * 1024)}),
}, class Settings extends GObject.Object {
    static get_default() {
        _settings ??= new Settings();
        return _settings;
    }
});
installAccessors(Settings, {'double-click-time': P.int(400), 'double-click-distance': P.int(5),
    'dnd-drag-threshold': P.int(8), 'font-dpi': P.int(96 * 1024), 'long-press-duration': P.int(500),
    'font-name': P.string('Sans 11'), 'unscaled-font-dpi': P.int(96 * 1024)});

export const InputDevice = GObject.registerClass({GTypeName: 'GnoshClutterInputDevice'}, class InputDevice extends GObject.Object {
    get_device_type() {
        return E.InputDeviceType.POINTER_DEVICE;
    }

    get_device_name() {
        return 'gnosh';
    }
});

export const Animatable = {};

export const ScrollActor = GObject.registerClass({GTypeName: 'GnoshClutterScrollActor'}, class ScrollActor extends Actor {
    scroll_to_point() {}

    scroll_to_rect() {}
});

/** GNOME <= 46 */
export function color_from_string(str) {
    return Color.from_string(str);
}

export const BUTTON_PRIMARY = 1;
export const BUTTON_MIDDLE = 2;
export const BUTTON_SECONDARY = 3;
export const CURRENT_TIME = 0;
