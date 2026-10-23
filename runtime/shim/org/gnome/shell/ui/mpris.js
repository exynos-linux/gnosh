// SPDX-License-Identifier: GPL-3.0-or-later
// gnosh: Phosh shows media players itself (its media player widget in the
// quick settings drawer). These classes exist so extensions that adjust
// GNOME Shell's media message (e.g. Media Controls) can load.

import GObject from 'gi://GObject';
import St from 'gi://St';

export const MprisPlayer = GObject.registerClass({
    Signals: {'changed': {}, 'closed': {}},
}, class MprisPlayer extends GObject.Object {
    _init(busName) {
        super._init();
        this._busName = busName;
    }

    get busName() {
        return this._busName;
    }
});

export const MprisSource = GObject.registerClass({
    Signals: {'player-added': {param_types: [MprisPlayer]}, 'player-removed': {param_types: [MprisPlayer]}},
}, class MprisSource extends GObject.Object {
    _init() {
        super._init();
        this._players = new Map();
    }

    get players() {
        return [...this._players.values()];
    }

    _addPlayer() {}

    _onProxyReady() {}
});

export const MediaSection = MprisSource;
export const MediaMessage = GObject.registerClass(class MediaMessage extends St.BoxLayout {});
