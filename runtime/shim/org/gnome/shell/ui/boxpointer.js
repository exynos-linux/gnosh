// SPDX-License-Identifier: GPL-3.0-or-later
//
// gnosh: GNOME Shell's BoxPointer draws a popup with an arrow next to its
// source. In Phosh, popup menus are shown inside the quick settings drawer
// (as status pages), so the box pointer is a plain container that only
// tracks visibility.

import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import St from 'gi://St';

export const PopupAnimation = {
    NONE: 0,
    SLIDE: 1 << 0,
    FADE: 1 << 1,
    FULL: ~0,
};

export const POPUP_ANIMATION_TIME = 150;

export const BoxPointer = GObject.registerClass({
    Signals: {'arrow-side-changed': {}},
}, class BoxPointer extends St.Widget {
    _init(arrowSide, binProperties) {
        super._init({layout_manager: new Clutter.BinLayout()});
        this._arrowSide = arrowSide;
        this._userArrowSide = arrowSide;
        this._arrowOrigin = 0;
        this._arrowActor = null;
        this.bin = new St.Bin(binProperties);
        this.add_child(this.bin);
    }

    get arrowSide() {
        return this._arrowSide;
    }

    open(animate, onComplete) {
        this.show();
        if (onComplete)
            GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                onComplete();
                return GLib.SOURCE_REMOVE;
            });
    }

    close(animate, onComplete) {
        this.hide();
        if (onComplete)
            GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                onComplete();
                return GLib.SOURCE_REMOVE;
            });
    }

    setPosition() {}

    setSourceAlignment() {}

    setArrowOrigin(origin) {
        this._arrowOrigin = origin;
    }

    setArrowActor(actor) {
        this._arrowActor = actor;
    }

    updateArrowSide(side) {
        this._arrowSide = side;
        this.emit('arrow-side-changed');
    }

    getPadding() {
        return 0;
    }

    getArrowHeight() {
        return 0;
    }
});
