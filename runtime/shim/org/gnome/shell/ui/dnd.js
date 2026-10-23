// SPDX-License-Identifier: GPL-3.0-or-later
// gnosh: drag and drop between shell actors is not available in Phosh;
// draggables are created but never start a drag.

import * as Signals from '../misc/signals.js';

export const DragMotionResult = {NO_DROP: 0, COPY_DROP: 1, MOVE_DROP: 2, CONTINUE: 3};
export const DragDropResult = {FAILURE: 0, SUCCESS: 1, CONTINUE: 2};
export const DragState = {INIT: 0, DRAGGING: 1, CANCELLED: 2};
export const dragMonitors = [];

class Draggable extends Signals.EventEmitter {
    constructor(actor, params = {}) {
        super();
        this.actor = actor;
        this._params = params;
        this._dragState = DragState.INIT;
    }

    startDrag() {}

    cancelDrag() {}

    fakeRelease() {}
}

export function makeDraggable(actor, params) {
    return new Draggable(actor, params);
}

export function addDragMonitor(monitor) {
    dragMonitors.push(monitor);
}

export function removeDragMonitor(monitor) {
    const i = dragMonitors.indexOf(monitor);
    if (i >= 0)
        dragMonitors.splice(i, 1);
}
