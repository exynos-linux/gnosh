// SPDX-License-Identifier: GPL-3.0-or-later
// gnosh: Phosh runs its own notification daemon. These classes exist so
// extensions that look at GNOME Shell's daemons (GSConnect) can load;
// patching them has no effect on Phosh's notifications.

import GObject from 'gi://GObject';

import * as MessageTray from './messageTray.js';

export class GtkNotificationDaemonAppSource extends MessageTray.Source {
    static {
        GObject.registerClass(this);
    }

    constructor(appId) {
        super({title: appId});
        this._appId = appId;
        this._notifications = {};
    }

    activateAction() {}

    open() {}
}

export class GtkNotificationDaemon {
    constructor() {
        this._sources = {};
    }

    _ensureAppSource(appId) {
        this._sources[appId] ??= new GtkNotificationDaemonAppSource(appId);
        return this._sources[appId];
    }
}

export class FdoNotificationDaemon {
    constructor() {
        this._sources = [];
    }
}

export class NotificationDaemon {
    constructor() {
        this._fdoNotificationDaemon = new FdoNotificationDaemon();
        this._gtkNotificationDaemon = new GtkNotificationDaemon();
    }
}
