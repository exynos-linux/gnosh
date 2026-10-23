// SPDX-License-Identifier: GPL-3.0-or-later
// Cogl: only the value types extensions touch from JS.

import GObject from 'gi://GObject';

import {Color} from './color.js';

export {Color};

/** GNOME 47+ */
export function color_from_string(str) {
    return Color.from_string(str);
}

export const Pipeline = GObject.registerClass({GTypeName: 'GnoshCoglPipeline'}, class Pipeline extends GObject.Object {
    set_color() {}

    set_layer_texture() {}

    set_uniform_1f() {}

    get_uniform_location() {
        return 0;
    }

    add_snippet() {}

    copy() {
        return new Pipeline();
    }
});

export const Snippet = GObject.registerClass({GTypeName: 'GnoshCoglSnippet'}, class Snippet extends GObject.Object {
    static new() {
        return new Snippet();
    }
});

export const Texture = GObject.registerClass({GTypeName: 'GnoshCoglTexture'}, class Texture extends GObject.Object {});
export const Context = GObject.registerClass({GTypeName: 'GnoshCoglContext'}, class Context extends GObject.Object {});
