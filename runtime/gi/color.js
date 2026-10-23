// SPDX-License-Identifier: GPL-3.0-or-later
//
// Clutter.Color (GNOME <= 46) and Cogl.Color (GNOME 47+).

import Gdk from 'gi://Gdk?version=3.0';

export class Color {
    constructor(params = {}) {
        this.red = params.red ?? 0;
        this.green = params.green ?? 0;
        this.blue = params.blue ?? 0;
        this.alpha = params.alpha ?? 255;
    }

    static new(red = 0, green = 0, blue = 0, alpha = 255) {
        return new Color({red, green, blue, alpha});
    }

    static from_string(str) {
        const rgba = new Gdk.RGBA();
        if (!rgba.parse(String(str)))
            return [false, new Color()];
        return [true, Color._fromRgba(rgba)];
    }

    static _fromRgba(rgba) {
        return new Color({
            red: Math.round(rgba.red * 255), green: Math.round(rgba.green * 255),
            blue: Math.round(rgba.blue * 255), alpha: Math.round(rgba.alpha * 255),
        });
    }

    static from_hls(h, l, s) {
        const c = new Color();
        c.init_from_hls(h, l, s);
        return c;
    }

    static from_pixel(pixel) {
        return new Color({red: pixel >>> 24 & 255, green: pixel >>> 16 & 255, blue: pixel >>> 8 & 255, alpha: pixel & 255});
    }

    static get_static() {
        return new Color();
    }

    init_from_4f(r, g, b, a) {
        Object.assign(this, {red: Math.round(r * 255), green: Math.round(g * 255), blue: Math.round(b * 255), alpha: Math.round(a * 255)});
        return this;
    }

    init_from_4ub(red, green, blue, alpha) {
        Object.assign(this, {red, green, blue, alpha});
        return this;
    }

    init_from_hls(h, l, s) {
        const hue = ((h % 360) + 360) % 360 / 360;
        const f = (p, q, t) => {
            t = (t + 1) % 1;
            if (t < 1 / 6)
                return p + (q - p) * 6 * t;
            if (t < 1 / 2)
                return q;
            if (t < 2 / 3)
                return p + (q - p) * (2 / 3 - t) * 6;
            return p;
        };
        let r = l, g = l, b = l;
        if (s !== 0) {
            const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
            const p = 2 * l - q;
            r = f(p, q, hue + 1 / 3);
            g = f(p, q, hue);
            b = f(p, q, hue - 1 / 3);
        }
        return this.init_from_4f(r, g, b, this.alpha / 255);
    }

    to_hls() {
        const r = this.red / 255, g = this.green / 255, b = this.blue / 255;
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        const l = (max + min) / 2;
        let h = 0, s = 0;
        if (max !== min) {
            const d = max - min;
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
            if (max === r)
                h = (g - b) / d + (g < b ? 6 : 0);
            else if (max === g)
                h = (b - r) / d + 2;
            else
                h = (r - g) / d + 4;
            h *= 60;
        }
        return [h, l, s];
    }

    to_string() {
        const hex = n => n.toString(16).padStart(2, '0');
        return `#${hex(this.red)}${hex(this.green)}${hex(this.blue)}${hex(this.alpha)}`;
    }

    to_pixel() {
        return ((this.red << 24) | (this.green << 16) | (this.blue << 8) | this.alpha) >>> 0;
    }

    copy() {
        return new Color(this);
    }

    equal(o) {
        return o && o.red === this.red && o.green === this.green && o.blue === this.blue && o.alpha === this.alpha;
    }

    shade(factor) {
        const [h, l, s] = this.to_hls();
        return Color.from_hls(h, Math.min(1, Math.max(0, l * factor)), s);
    }

    interpolate(final, progress) {
        const mix = (a, b) => Math.round(a + (b - a) * progress);
        return new Color({red: mix(this.red, final.red), green: mix(this.green, final.green),
            blue: mix(this.blue, final.blue), alpha: mix(this.alpha, final.alpha)});
    }

    premultiply() {}

    unpremultiply() {}

    get_red() {
        return this.red / 255;
    }

    get_green() {
        return this.green / 255;
    }

    get_blue() {
        return this.blue / 255;
    }

    get_alpha() {
        return this.alpha / 255;
    }

    toCss() {
        return `rgba(${this.red},${this.green},${this.blue},${this.alpha / 255})`;
    }
}
