// SPDX-License-Identifier: GPL-3.0-or-later
//
// gnosh: GNOME Shell modal dialogs, shown as Phosh system modal dialogs
// (a full-screen overlay layer surface, the same Phosh uses for polkit and
// end-session prompts).

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk?version=3.0';
import St from 'gi://St';

import * as Dialog from './dialog.js';

export const State = {OPENED: 0, CLOSED: 1, OPENING: 2, CLOSING: 3, FADED_OUT: 4};

export const ModalDialog = GObject.registerClass({
    Properties: {
        'state': GObject.ParamSpec.int('state', null, null, GObject.ParamFlags.READABLE,
            Math.min(...Object.values(State)), Math.max(...Object.values(State)), State.CLOSED),
    },
    Signals: {'opened': {}, 'closed': {}},
}, class ModalDialog extends St.Widget {
    _init(params = {}) {
        const {shellReactive, styleClass, actionMode, shouldFadeIn, shouldFadeOut, destroyOnClose, ...rest} = params;
        super._init({visible: false, reactive: true, layout_manager: new Clutter.BinLayout(), ...rest});
        void shellReactive;
        void actionMode;
        void shouldFadeIn;
        void shouldFadeOut;
        this._state = State.CLOSED;
        this._destroyOnClose = destroyOnClose ?? true;
        this._buttons = [];
        this.dialogLayout = new Dialog.Dialog(this, styleClass ?? null);
        this.contentLayout = this.dialogLayout.contentLayout;
        this.buttonLayout = this.dialogLayout.buttonLayout;
        this._initialKeyFocus = null;
    }

    get state() {
        return this._state;
    }

    _setState(state) {
        if (this._state === state)
            return;
        this._state = state;
        this.notify('state');
    }

    clearButtons() {
        this.dialogLayout.clearButtons();
        this._buttons = [];
    }

    setButtons(buttons) {
        this.clearButtons();
        for (const info of buttons)
            this.addButton(info);
    }

    addButton(info) {
        this._buttons.push(info);
        return this.dialogLayout.addButton(info);
    }

    setInitialKeyFocus(actor) {
        this._initialKeyFocus = actor;
    }

    _gnoshBuild() {
        const type = GObject.type_from_name('PhoshSystemModalDialog');
        if (!type) {
            console.warn('gnosh: Phosh system modal dialogs are not available');
            return null;
        }
        const dialog = GObject.Object.new_with_properties(type, ['title'], ['']);
        const builder = new Gtk.Builder();
        // Content: the St content layout, unparented from the St dialog box.
        const content = this.contentLayout._gnoshOuter;
        content.get_parent()?.remove(content);
        content.show();
        dialog.add_child(builder, content, 'phosh-dialog-content');
        for (const info of this._buttons) {
            const button = new Gtk.Button({label: info.label ?? '', visible: true, can_default: Boolean(info.default)});
            if (info.default)
                button.get_style_context().add_class('suggested-action');
            if (info.destructive_action)
                button.get_style_context().add_class('destructive-action');
            button.connect('clicked', () => this._gnoshAction(info));
            dialog.add_child(builder, button, 'phosh-dialog-button');
        }
        dialog.connect('key-press-event', (w, ev) => {
            const [, keyval] = ev.get_keyval();
            const info = this._buttons.find(b => b.key === keyval) ??
                (keyval === Clutter.KEY_Escape ? this._buttons.find(b => b.isCancel) : null);
            if (info) {
                this._gnoshAction(info);
                return true;
            }
            if (keyval === Clutter.KEY_Escape) {
                this.close();
                return true;
            }
            return false;
        });
        return dialog;
    }

    _gnoshAction(info) {
        try {
            info.action?.();
        } catch (e) {
            logError(e, 'gnosh: dialog button action');
        }
    }

    open() {
        if (this._state === State.OPENED || this._state === State.OPENING)
            return true;
        this._phoshDialog = this._gnoshBuild();
        if (!this._phoshDialog)
            return false;
        this._phoshDialog.show();
        (globalThis.__gnosh.openDialogs ??= new Set()).add(this);
        this._setState(State.OPENED);
        this._initialKeyFocus?.grab_key_focus?.();
        this.emit('opened');
        return true;
    }

    close() {
        if (this._state === State.CLOSED || this._state === State.CLOSING)
            return;
        const dialog = this._phoshDialog;
        this._phoshDialog = null;
        if (dialog) {
            // Give the content back before the dialog widget goes away.
            const content = this.contentLayout._gnoshOuter;
            content.get_parent()?.remove(content);
            dialog.destroy();
        }
        globalThis.__gnosh.openDialogs?.delete(this);
        this._setState(State.CLOSED);
        this.emit('closed');
        if (this._destroyOnClose)
            GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                this.destroy();
                return GLib.SOURCE_REMOVE;
            });
    }

    popModal() {}

    pushModal() {
        return true;
    }

    _fadeOutDialog() {
        this.close();
    }
});
