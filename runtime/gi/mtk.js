// SPDX-License-Identifier: GPL-3.0-or-later
// Mtk (Mutter toolkit) value types; Meta.Rectangle is the same class.

export class Rectangle {
    constructor(params = {}) {
        this.x = params.x ?? 0;
        this.y = params.y ?? 0;
        this.width = params.width ?? 0;
        this.height = params.height ?? 0;
    }

    static new(x, y, width, height) {
        return new Rectangle({x, y, width, height});
    }

    static from_graphene_rect(rect) {
        return new Rectangle({x: rect.origin.x, y: rect.origin.y, width: rect.size.width, height: rect.size.height});
    }

    copy() {
        return new Rectangle(this);
    }

    equal(o) {
        return o && o.x === this.x && o.y === this.y && o.width === this.width && o.height === this.height;
    }

    area() {
        return this.width * this.height;
    }

    contains_rect(o) {
        return o.x >= this.x && o.y >= this.y && o.x + o.width <= this.x + this.width &&
            o.y + o.height <= this.y + this.height;
    }

    contains_point(x, y) {
        return x >= this.x && y >= this.y && x < this.x + this.width && y < this.y + this.height;
    }

    intersect(o) {
        const x = Math.max(this.x, o.x), y = Math.max(this.y, o.y);
        const w = Math.min(this.x + this.width, o.x + o.width) - x;
        const h = Math.min(this.y + this.height, o.y + o.height) - y;
        if (w <= 0 || h <= 0)
            return [false, new Rectangle()];
        return [true, new Rectangle({x, y, width: w, height: h})];
    }

    overlap(o) {
        return this.intersect(o)[0];
    }

    union(o) {
        const x = Math.min(this.x, o.x), y = Math.min(this.y, o.y);
        return new Rectangle({x, y, width: Math.max(this.x + this.width, o.x + o.width) - x,
            height: Math.max(this.y + this.height, o.y + o.height) - y});
    }

    horiz_overlap(o) {
        return this.x < o.x + o.width && o.x < this.x + this.width;
    }

    vert_overlap(o) {
        return this.y < o.y + o.height && o.y < this.y + this.height;
    }

    could_fit_rect(o) {
        return this.width >= o.width && this.height >= o.height;
    }

    is_empty() {
        return this.width <= 0 || this.height <= 0;
    }

    to_graphene_rect() {
        return {origin: {x: this.x, y: this.y}, size: {width: this.width, height: this.height}};
    }
}
