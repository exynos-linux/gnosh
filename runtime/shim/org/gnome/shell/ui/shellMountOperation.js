// SPDX-License-Identifier: GPL-3.0-or-later
// gnosh: mount operations use GTK's dialogs inside Phosh.

import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk?version=3.0';

export class ShellMountOperation {
    constructor(source, params = {}) {
        void source;
        this.mountOp = new Gtk.MountOperation();
        this._existingDialog = params.existingDialog ?? null;
    }

    close() {
        this.mountOp = null;
    }
}

export const ShellMountQuestionDialog = null;
export const ShellMountPasswordDialog = null;
export const ShellProcessesDialog = null;
export const GnomeShellMountOpHandler = class {};
void Gio;
