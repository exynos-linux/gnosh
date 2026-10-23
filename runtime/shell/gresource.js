// SPDX-License-Identifier: GPL-3.0-or-later
//
// Builds a GResource bundle in memory, so the gnosh shims can be served at
// resource:///org/gnome/shell/... without a build step.
//
// This is a port of GLib's gvdb-builder.c and of the table layout
// glib-compile-resources produces (directory items ending in '/' with child
// lists, file items holding a (uuay) variant of size, flags and data).

import GLib from 'gi://GLib';

const SIGNATURE0 = 1918981703;
const SIGNATURE1 = 1953390953;
const HEADER_SIZE = 24;
const HASH_ITEM_SIZE = 24;

function djbHash(key) {
    let hash = 5381;
    for (const byte of new TextEncoder().encode(key)) {
        const signed = byte > 127 ? byte - 256 : byte;
        hash = (Math.imul(hash, 33) + signed) >>> 0;
    }
    return hash;
}

class Item {
    constructor(key) {
        this.key = key;
        this.hash = djbHash(key);
        this.parent = null;
        this.children = [];
        this.value = null;
        this.index = 0;
    }

    setParent(parent) {
        this.parent = parent;
        parent.children.push(this);
        // strcmp ordering, as gvdb_item_set_parent keeps siblings sorted
        parent.children.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    }
}

class FileBuilder {
    constructor() {
        this.chunks = [];
        this.offset = HEADER_SIZE;
    }

    allocate(alignment, size) {
        if (size === 0)
            return {start: 0, end: 0, data: null};
        this.offset += (alignment - (this.offset % alignment)) % alignment;
        const data = new Uint8Array(size);
        const start = this.offset;
        this.chunks.push({offset: start, data});
        this.offset += size;
        return {start, end: this.offset, data};
    }

    addString(str) {
        const bytes = new TextEncoder().encode(str);
        const start = this.offset;
        this.chunks.push({offset: start, data: bytes});
        this.offset += bytes.length;
        return {start, size: bytes.length};
    }

    addValue(variant) {
        const wrapped = new GLib.Variant('v', variant).get_normal_form();
        const bytes = wrapped.get_data_as_bytes().toArray();
        const ptr = this.allocate(8, bytes.length);
        ptr.data.set(bytes);
        return ptr;
    }

    serialise(root) {
        const out = new Uint8Array(this.offset);
        const view = new DataView(out.buffer);
        view.setUint32(0, SIGNATURE0, true);
        view.setUint32(4, SIGNATURE1, true);
        view.setUint32(8, 0, true);
        view.setUint32(12, 0, true);
        view.setUint32(16, root.start, true);
        view.setUint32(20, root.end, true);
        for (const chunk of this.chunks)
            out.set(chunk.data, chunk.offset);
        return out;
    }
}

function addHash(fb, items) {
    const nBuckets = items.length;
    const buckets = Array.from({length: nBuckets}, () => []);
    for (const item of items)
        buckets[item.hash % nBuckets].push(item);

    let index = 0;
    for (const bucket of buckets) {
        for (const item of bucket)
            item.index = index++;
    }

    // bloom header (shift 5, 0 words), bucket count, buckets, hash items
    const size = 8 + nBuckets * 4 + index * HASH_ITEM_SIZE;
    const table = fb.allocate(4, size);
    const view = new DataView(table.data.buffer);
    view.setUint32(0, (5 << 27) >>> 0, true);
    view.setUint32(4, nBuckets, true);

    let itemOffset = 8 + nBuckets * 4;
    index = 0;
    buckets.forEach((bucket, b) => {
        view.setUint32(8 + b * 4, index, true);
        for (const item of bucket) {
            const at = itemOffset + index * HASH_ITEM_SIZE;
            view.setUint32(at, item.hash, true);
            view.setUint32(at + 4, item.parent ? item.parent.index : 0xffffffff, true);
            const basename = item.parent ? item.key.slice(item.parent.key.length) : item.key;
            const str = fb.addString(basename);
            view.setUint32(at + 8, str.start, true);
            view.setUint16(at + 12, str.size, true);
            let ptr;
            if (item.value) {
                view.setUint8(at + 14, 'v'.charCodeAt(0));
                ptr = fb.addValue(item.value);
            } else {
                view.setUint8(at + 14, 'L'.charCodeAt(0));
                ptr = fb.allocate(4, 4 * item.children.length);
                const offsets = new DataView(ptr.data?.buffer ?? new ArrayBuffer(0));
                item.children.forEach((child, i) => offsets.setUint32(i * 4, child.index, true));
            }
            view.setUint8(at + 15, 0);
            view.setUint32(at + 16, ptr.start, true);
            view.setUint32(at + 20, ptr.end, true);
            index++;
        }
    });
    return table;
}

/**
 * @param {Map<string, Uint8Array>} files resource path -> contents
 * @returns {GLib.Bytes} a serialized GResource bundle
 */
export function buildResource(files) {
    const table = new Map();

    const getParent = key => {
        if (key.length === 1)
            return null;
        let length = key.length;
        while (key[--length - 1] !== '/')
            ;
        const dirKey = key.slice(0, length);
        let parent = table.get(dirKey);
        if (!parent) {
            parent = new Item(dirKey);
            table.set(dirKey, parent);
            const grandparent = getParent(dirKey);
            if (grandparent)
                parent.setParent(grandparent);
        }
        return parent;
    };

    for (const [path, contents] of files) {
        const item = new Item(path);
        table.set(path, item);
        item.setParent(getParent(path));
        const data = new Uint8Array(contents.length + 1);
        data.set(contents);
        item.value = new GLib.Variant('(uuay)', [contents.length, 0, data]);
    }

    const fb = new FileBuilder();
    const root = addHash(fb, [...table.values()]);
    return new GLib.Bytes(fb.serialise(root));
}
