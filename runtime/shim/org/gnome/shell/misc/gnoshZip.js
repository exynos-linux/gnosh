// SPDX-License-Identifier: GPL-3.0-or-later
//
// gnosh: minimal ZIP reader (stored and deflated entries), so extensions
// can be installed without an `unzip` binary.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

function inflateRaw(bytes) {
    const converter = new Gio.ZlibDecompressor({format: Gio.ZlibCompressorFormat.RAW});
    const input = Gio.MemoryInputStream.new_from_bytes(new GLib.Bytes(bytes));
    const stream = new Gio.ConverterInputStream({base_stream: input, converter});
    const out = Gio.MemoryOutputStream.new_resizable();
    out.splice(stream, Gio.OutputStreamSpliceFlags.CLOSE_SOURCE | Gio.OutputStreamSpliceFlags.CLOSE_TARGET, null);
    return out.steal_as_bytes().toArray();
}

/** List entries of a ZIP archive held in memory. */
export function readZip(data) {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    let eocd = -1;
    for (let i = data.length - 22; i >= Math.max(0, data.length - 65557); i--) {
        if (view.getUint32(i, true) === 0x06054b50) {
            eocd = i;
            break;
        }
    }
    if (eocd < 0)
        throw new Error('not a ZIP archive');
    const count = view.getUint16(eocd + 10, true);
    let p = view.getUint32(eocd + 16, true);
    const entries = [];
    for (let n = 0; n < count; n++) {
        if (view.getUint32(p, true) !== 0x02014b50)
            throw new Error('corrupt ZIP central directory');
        const method = view.getUint16(p + 10, true);
        const compSize = view.getUint32(p + 20, true);
        const size = view.getUint32(p + 24, true);
        const nameLen = view.getUint16(p + 28, true);
        const extraLen = view.getUint16(p + 30, true);
        const commentLen = view.getUint16(p + 32, true);
        const externalAttrs = view.getUint32(p + 38, true);
        const localOffset = view.getUint32(p + 42, true);
        const name = new TextDecoder().decode(data.subarray(p + 46, p + 46 + nameLen));
        p += 46 + nameLen + extraLen + commentLen;
        entries.push({name, method, compSize, size, localOffset, mode: externalAttrs >>> 16});
    }
    return entries.map(e => ({
        ...e,
        isDir: e.name.endsWith('/'),
        read() {
            const lp = e.localOffset;
            if (view.getUint32(lp, true) !== 0x04034b50)
                throw new Error(`corrupt ZIP entry ${e.name}`);
            const start = lp + 30 + view.getUint16(lp + 26, true) + view.getUint16(lp + 28, true);
            const raw = data.subarray(start, start + e.compSize);
            if (e.method === 0)
                return raw;
            if (e.method === 8)
                return inflateRaw(raw);
            throw new Error(`unsupported ZIP compression ${e.method} in ${e.name}`);
        },
    }));
}

/** Extract a ZIP archive (bytes) into a directory. Refuses unsafe paths. */
export function extractZip(data, destDir) {
    for (const entry of readZip(data)) {
        const parts = entry.name.split('/').filter(Boolean);
        if (entry.name.startsWith('/') || parts.some(part => part === '..'))
            throw new Error(`refusing unsafe path in archive: ${entry.name}`);
        const path = GLib.build_filenamev([destDir, ...parts]);
        if (entry.isDir) {
            GLib.mkdir_with_parents(path, 0o755);
            continue;
        }
        GLib.mkdir_with_parents(GLib.path_get_dirname(path), 0o755);
        GLib.file_set_contents(path, entry.read());
        const mode = entry.mode & 0o777;
        if (mode & 0o111)
            Gio.File.new_for_path(path).set_attribute_uint32('unix::mode', mode | 0o600, Gio.FileQueryInfoFlags.NONE, null);
    }
}
