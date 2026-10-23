// SPDX-License-Identifier: GPL-3.0-or-later
//
// Clutter.Text on GTK 3. A free-standing Clutter.Text draws with a
// Gtk.Label; the clutter_text of St.Label and St.Entry wraps the label or
// entry widget those actors already own.

import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk?version=3.0';
import Pango from 'gi://Pango';

import {Actor, Event, P, installAccessors, makeProperties} from './actor.js';

const TEXT_PROPERTIES = {
    'use-markup': P.bool(false),
    'ellipsize': P.int(Pango.EllipsizeMode.END),
    'line-wrap': P.bool(false),
    'line-wrap-mode': P.int(Pango.WrapMode.WORD),
    'justify': P.bool(false),
    'line-alignment': P.int(Pango.Alignment.LEFT),
    'editable': P.bool(false),
    'selectable': P.bool(true),
    'activatable': P.bool(true),
    'single-line-mode': P.bool(false),
    'cursor-visible': P.bool(true),
    'color': P.js(null),
    'font-name': P.string(null),
    'font-description': P.js(null),
    'max-length': P.int(0),
    'password-char': P.uint(0),
    'attributes': P.js(null),
    'input-purpose': P.int(0),
    'input-hints': P.int(0),
    'selection-color': P.js(null),
    'selected-text-color': P.js(null),
    'cursor-color': P.js(null),
    'cursor-size': P.int(-1),
};

export const Text = GObject.registerClass({
    GTypeName: 'GnoshClutterText',
    Properties: makeProperties({...TEXT_PROPERTIES, 'text': P.string(null),
        'position': P.int(-1), 'selection-bound': P.int(-1)}),
    Signals: {
        'text-changed': {},
        'activate': {},
        'cursor-changed': {},
        'insert-text': {param_types: [GObject.TYPE_STRING, GObject.TYPE_INT, GObject.TYPE_POINTER]},
        'delete-text': {param_types: [GObject.TYPE_INT, GObject.TYPE_INT]},
    },
}, class Text extends Actor {
    _init(params = {}) {
        this._gnoshWrapped = params?._gnoshWidget ?? null;
        if (params)
            delete params._gnoshWidget;
        super._init(params);
    }

    _gnoshEnsureWidget() {
        if (!this._gnoshWrapped) {
            super._gnoshEnsureWidget();
            this._gnoshConnectWidget(this._gnoshInner);
            return;
        }
        // A wrapped widget belongs to the St.Label/St.Entry that created us.
        this._gnoshInner = this._gnoshOuter = this._gnoshWrapped;
        this._gnoshConnectWidget(this._gnoshWrapped);
        this._gnoshSyncAll();
    }

    _gnoshCreateInner() {
        return new Gtk.Label({xalign: 0, ellipsize: Pango.EllipsizeMode.END});
    }

    get _gnoshIsContainerActor() {
        return false;
    }

    get _isEntry() {
        return this._gnoshInner instanceof Gtk.Entry;
    }

    _gnoshConnectWidget(w) {
        if (w instanceof Gtk.Entry) {
            w.connect('changed', () => {
                this.notify('text');
                this.emit('text-changed');
            });
            w.connect('activate', () => this.emit('activate'));
            w.connect('notify::cursor-position', () => this.emit('cursor-changed'));
            w.connect('key-press-event', (widget, ev) => this._gnoshGtkKey('key-press-event', ev));
            w.connect('key-release-event', (widget, ev) => this._gnoshGtkKey('key-release-event', ev));
            w.connect('focus-in-event', () => {
                this.emit('key-focus-in');
                return false;
            });
            w.connect('focus-out-event', () => {
                this.emit('key-focus-out');
                return false;
            });
        }
    }

    _gnoshGtkKey(signal, gdkEvent) {
        const event = Event.fromGdk(gdkEvent, this);
        // Key events on an entry reach clutter_text and then bubble to the
        // St.Entry, as in Clutter.
        if (this._gnoshDispatchKey(this, signal, event))
            return true;
        const owner = this._gnoshOwner;
        return owner ? this._gnoshDispatchKey(owner, signal, event) : false;
    }

    _gnoshDispatchKey(actor, signal, event) {
        try {
            if (actor.emit('event', event))
                return true;
            if (actor.vfunc_event(event))
                return true;
            if (actor.emit(signal, event))
                return true;
            return signal === 'key-press-event' ? Boolean(actor.vfunc_key_press_event(event))
                : Boolean(actor.vfunc_key_release_event(event));
        } catch (e) {
            logError(e, `gnosh: ${signal} handler`);
            return false;
        }
    }

    _propChanged(key, value) {
        super._propChanged(key, value);
        const w = this._gnoshInner;
        if (!w)
            return;
        if (w instanceof Gtk.Label) {
            switch (key) {
            case 'use_markup':
                this._gnoshSetLabelText(this._gnoshP.text ?? w.get_text());
                break;
            case 'ellipsize':
                w.ellipsize = value;
                break;
            case 'line_wrap':
                w.wrap = value;
                if (value)
                    w.ellipsize = Pango.EllipsizeMode.NONE;
                break;
            case 'line_wrap_mode':
                w.wrap_mode = value;
                break;
            case 'justify':
                w.justify = value ? Gtk.Justification.FILL : Gtk.Justification.LEFT;
                break;
            case 'line_alignment':
                w.justify = [Gtk.Justification.LEFT, Gtk.Justification.CENTER, Gtk.Justification.RIGHT][value] ?? Gtk.Justification.LEFT;
                break;
            case 'selectable':
                // Selectable labels grab focus and clicks; keep them inert.
                break;
            case 'single_line_mode':
                w.single_line_mode = value;
                break;
            case 'attributes':
                w.set_attributes(value);
                break;
            }
        } else if (w instanceof Gtk.Entry) {
            switch (key) {
            case 'editable':
                w.editable = value;
                break;
            case 'max_length':
                w.max_length = value;
                break;
            case 'password_char':
                w.visibility = value === 0;
                break;
            case 'activatable':
                w.activates_default = false;
                break;
            }
        }
        if (key === 'color' && value?.toCss)
            this._gnoshCss(`color: ${value.toCss()};`);
        if ((key === 'font_name' || key === 'font_description') && value)
            this._gnoshFont(value);
    }

    _gnoshCss(css) {
        this._gnoshCssProvider ??= new Gtk.CssProvider();
        try {
            this._gnoshCssProvider.load_from_data(`* { ${css} }`);
            this._gnoshInner.get_style_context().add_provider(this._gnoshCssProvider, Gtk.STYLE_PROVIDER_PRIORITY_USER + 1);
        } catch {
            // ignore unparsable colors
        }
    }

    _gnoshFont(font) {
        const desc = typeof font === 'string' ? Pango.FontDescription.from_string(font) : font;
        const family = desc.get_family();
        const size = desc.get_size() / Pango.SCALE;
        const parts = [];
        if (family)
            parts.push(`font-family: "${family}";`);
        if (size > 0)
            parts.push(`font-size: ${size}${desc.get_size_is_absolute() ? 'px' : 'pt'};`);
        if (desc.get_set_fields() & Pango.FontMask.WEIGHT)
            parts.push(`font-weight: ${desc.get_weight()};`);
        this._gnoshCss(parts.join(' '));
    }

    _gnoshSetLabelText(text) {
        const w = this._gnoshInner;
        if (this._gnoshP.use_markup)
            w.set_markup(text ?? '');
        else
            w.set_text(text ?? '');
    }

    get text() {
        if (!this._gnoshInner)
            return this._gnoshP.text ?? '';
        return this._gnoshIsEntry ? this._gnoshInner.get_text() : this._gnoshP.text ?? this._gnoshInner.get_text();
    }

    set text(value) {
        this.set_text(value);
    }

    set_text(text) {
        text = text === null || text === undefined ? '' : String(text);
        const changed = text !== this.text;
        this._gnoshP.text = text;
        if (this._gnoshInner) {
            if (this._gnoshIsEntry) {
                if (this._gnoshInner.get_text() !== text)
                    this._gnoshInner.set_text(text);
                return;
            }
            this._gnoshSetLabelText(text);
        }
        if (changed && this._gnoshConstructed) {
            this.notify('text');
            this.emit('text-changed');
            this._gnoshOwner?.notify?.('text');
        }
    }

    get_text() {
        return this.text;
    }

    set_markup(markup) {
        this._gnoshP.use_markup = true;
        this.set_text(markup);
    }

    get_layout() {
        if (this._gnoshInner instanceof Gtk.Label)
            return this._gnoshInner.get_layout();
        return this._gnoshInner?.get_layout?.() ?? null;
    }

    get_layout_offsets() {
        return [0, 0];
    }

    get position() {
        return this._gnoshIsEntry ? this._gnoshInner.get_position() : -1;
    }

    set position(p) {
        this.set_cursor_position(p);
    }

    get_cursor_position() {
        return this.position;
    }

    set_cursor_position(p) {
        if (this._gnoshIsEntry)
            this._gnoshInner.set_position(p);
    }

    get selection_bound() {
        if (!this._gnoshIsEntry)
            return -1;
        const [ok, , end] = this._gnoshInner.get_selection_bounds();
        return ok ? end : this.position;
    }

    set_selection(start, end) {
        if (this._gnoshIsEntry)
            this._gnoshInner.select_region(start, end);
    }

    set_selection_bound(bound) {
        if (this._gnoshIsEntry)
            this._gnoshInner.select_region(this.position, bound);
    }

    get_selection() {
        if (!this._gnoshIsEntry)
            return null;
        const [ok, start, end] = this._gnoshInner.get_selection_bounds();
        return ok ? this.text.slice(start, end) : null;
    }

    get_selection_bound() {
        return this.selection_bound;
    }

    insert_text(text, position) {
        if (this._gnoshIsEntry) {
            this._gnoshInner.insert_text(text, -1, position < 0 ? this.text.length : position);
            return;
        }
        const t = this.text;
        const at = position < 0 ? t.length : position;
        this.set_text(t.slice(0, at) + text + t.slice(at));
    }

    insert_unichar(c) {
        this.insert_text(String.fromCodePoint(c), this.position);
    }

    delete_text(start, end) {
        if (this._gnoshIsEntry) {
            this._gnoshInner.delete_text(start, end);
            return;
        }
        const t = this.text;
        this.set_text(t.slice(0, start) + t.slice(end < 0 ? t.length : end));
    }

    delete_chars(n) {
        const p = this.position;
        this.delete_text(Math.max(0, p - n), p);
    }

    delete_selection() {
        if (!this._gnoshIsEntry)
            return false;
        this._gnoshInner.delete_selection();
        return true;
    }

    get_chars(start, end) {
        return this.text.slice(start, end < 0 ? undefined : end);
    }

    set_use_markup(v) {
        this.use_markup = v;
    }

    get_use_markup() {
        return this.use_markup;
    }

    set_ellipsize(m) {
        this.ellipsize = m;
    }

    get_ellipsize() {
        return this.ellipsize;
    }

    set_line_wrap(v) {
        this.line_wrap = v;
    }

    get_line_wrap() {
        return this.line_wrap;
    }

    set_line_wrap_mode(m) {
        this.line_wrap_mode = m;
    }

    get_line_wrap_mode() {
        return this.line_wrap_mode;
    }

    set_justify(v) {
        this.justify = v;
    }

    set_line_alignment(a) {
        this.line_alignment = a;
    }

    set_editable(v) {
        this.editable = v;
    }

    get_editable() {
        return this.editable;
    }

    set_selectable(v) {
        this.selectable = v;
    }

    set_activatable(v) {
        this.activatable = v;
    }

    set_single_line_mode(v) {
        this.single_line_mode = v;
    }

    set_cursor_visible(v) {
        this.cursor_visible = v;
    }

    set_max_length(n) {
        this.max_length = n;
    }

    get_max_length() {
        return this.max_length;
    }

    set_password_char(c) {
        this.password_char = c;
    }

    set_color(c) {
        this.color = c;
    }

    get_color() {
        return this.color;
    }

    set_font_name(f) {
        this.font_name = f;
    }

    get_font_name() {
        return this.font_name;
    }

    set_font_description(d) {
        this.font_description = d;
    }

    get_font_description() {
        return this.font_description ?? Pango.FontDescription.from_string(this.font_name ?? 'Sans 11');
    }

    set_attributes(a) {
        this.attributes = a;
    }

    get_attributes() {
        return this.attributes;
    }

    set_input_purpose(p) {
        this.input_purpose = p;
    }

    set_input_hints(h) {
        this.input_hints = h;
    }

    get_buffer() {
        return null;
    }

    coords_to_position() {
        return 0;
    }

    position_to_coords() {
        return [false, 0, 0, 0];
    }

    has_preedit() {
        return false;
    }

    activate() {
        this.emit('activate');
        return true;
    }

    grab_key_focus() {
        this._gnoshInner?.grab_focus();
    }

    destroy() {
        if (this._gnoshWrapped) {
            // The owner destroys the widget.
            if (this._gnoshDestroyed)
                return;
            this._gnoshDestroyed = true;
            this.emit('destroy');
            return;
        }
        super.destroy();
    }
});
installAccessors(Text, TEXT_PROPERTIES);
