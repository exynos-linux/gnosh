// SPDX-License-Identifier: GPL-3.0-or-later
// gnosh: Phosh has its own app grid; only constants and a basic AppIcon.

import GObject from 'gi://GObject';
import St from 'gi://St';

export const MENU_POPUP_TIMEOUT = 600;
export const POPDOWN_DIALOG_TIMEOUT = 500;

export const AppIcon = GObject.registerClass(
class AppIcon extends St.Button {
    _init(app, params = {}) {
        super._init({style_class: 'app-well-app', ...params});
        this.app = app;
        this.icon = {setIconSize: () => {}};
        this.set_child(app?.create_icon_texture?.(48) ?? new St.Icon({icon_name: 'application-x-executable'}));
        this.connect('clicked', () => this.app?.activate());
    }

    get id() {
        return this.app?.get_id();
    }

    activate() {
        this.app?.activate();
    }

    popupMenu() {}
});

export class AppDisplay {}
export class AppSearchProvider {}
export const BaseAppView = class {};
