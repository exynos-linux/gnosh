// SPDX-License-Identifier: GPL-3.0-or-later
// gnosh unit tests that need GJS but no display: gjs -m tests/unit/run.js

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import System from 'system';

const ROOT = GLib.path_get_dirname(GLib.path_get_dirname(GLib.path_get_dirname(GLib.filename_from_uri(import.meta.url)[0])));
const url = path => `file://${ROOT}/${path}`;

let failures = 0;
let count = 0;

async function test(name, fn) {
    count++;
    try {
        await fn();
        print(`ok ${count} - ${name}`);
    } catch (e) {
        failures++;
        print(`not ok ${count} - ${name}\n  ${e}\n  ${(e.stack ?? '').split('\n').slice(0, 3).join('\n  ')}`);
    }
}

function assertEq(a, b, msg = '') {
    if (JSON.stringify(a) !== JSON.stringify(b))
        throw new Error(`${msg} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

function assert(cond, msg) {
    if (!cond)
        throw new Error(msg);
}

const enc = s => new TextEncoder().encode(s);

const {buildResource} = await import(url('runtime/shell/gresource.js'));

await test('gresource: lookups and directory listing', () => {
    const files = new Map([
        ['/org/gnome/shell/ui/main.js', enc('export const a = 1;')],
        ['/org/gnome/shell/misc/config.js', enc('export const v = 2;')],
    ]);
    for (let i = 0; i < 200; i++)
        files.set(`/org/gnome/shell/ui/many/f${i}.js`, enc(`// ${i}`));
    const res = Gio.Resource.new_from_data(buildResource(files));
    assertEq(new TextDecoder().decode(res.lookup_data('/org/gnome/shell/misc/config.js', 0).toArray()), 'export const v = 2;');
    assertEq(res.enumerate_children('/org/gnome/shell/', 0).sort(), ['misc/', 'ui/']);
    for (let i = 0; i < 200; i++)
        assertEq(new TextDecoder().decode(res.lookup_data(`/org/gnome/shell/ui/many/f${i}.js`, 0).toArray()), `// ${i}`);
    let threw = false;
    try {
        res.lookup_data('/nope', 0);
    } catch {
        threw = true;
    }
    assert(threw, 'missing path must throw');
});

await test('gresource: modules import from a registered bundle', async () => {
    const files = new Map([
        ['/io/gnosh/test/a.js', enc("import {b} from './b.js'; export const a = b + 1;")],
        ['/io/gnosh/test/b.js', enc('export const b = 41;')],
    ]);
    Gio.resources_register(Gio.Resource.new_from_data(buildResource(files)));
    const mod = await import('resource:///io/gnosh/test/a.js');
    assertEq(mod.a, 42);
});

// style.js needs GTK 3 only for CSS providers; the parsers are pure.
imports.gi.versions.Gtk = '3.0';
imports.gi.versions.Gdk = '3.0';
const Style = await import(url('runtime/gi/style.js'));

await test('style: St declarations split into GTK CSS and St-only props', () => {
    const {css, st} = Style.splitDeclarations(Style.parseDeclarations('color: red; icon-size: 24px; spacing: 6px; padding: 2px 4px'));
    assertEq(css, 'color: red; padding: 2px 4px;');
    assertEq(st, {'icon-size': '24px', 'spacing': '6px'});
});

await test('style: lengths', () => {
    assertEq(Style.parseLength('16px'), 16);
    assertEq(Style.parseLength('1.5em'), 24);
    assertEq(Style.parseLength('12pt'), 16);
    assertEq(Style.parseLength('bogus'), null);
});

await test('style: stylesheet translation scopes selectors and maps St names', () => {
    const {css, stRules} = Style.translateStylesheet(
        '/* c */ .foo:insensitive { color: #fff; icon-size: 20px; } StLabel.bar { font-weight: bold; } .baz.qux { spacing: 4px; }', '.gnosh');
    assert(css.includes('.gnosh .foo:disabled'), css);
    assert(css.includes('.gnosh label.bar'), css);
    assert(!css.includes('icon-size'), 'St-only property leaked into GTK CSS');
    // St-only properties apply to plain class selectors (not pseudo-classes).
    assertEq(stRules.length, 1);
    assertEq(stRules[0].classes, ['baz', 'qux']);
    assertEq(stRules[0].st, {spacing: '4px'});
});

const Zip = await import(url('runtime/shim/org/gnome/shell/misc/gnoshZip.js'));

await test('zip: reads stored and deflated entries, refuses traversal', () => {
    const tmp = GLib.Dir.make_tmp('gnosh-unit-XXXXXX');
    const src = `${tmp}/src`;
    GLib.mkdir_with_parents(`${src}/schemas`, 0o755);
    GLib.file_set_contents(`${src}/metadata.json`, '{"uuid": "x@y"}');
    GLib.file_set_contents(`${src}/schemas/a.gschema.xml`, '<schemalist/>'.repeat(50));
    const zipPath = `${tmp}/t.zip`;
    const [ok] = GLib.spawn_sync(src, ['python3', '-c',
        `import zipfile; z = zipfile.ZipFile('${zipPath}', 'w'); z.write('metadata.json', compress_type=zipfile.ZIP_STORED); z.write('schemas/a.gschema.xml', compress_type=zipfile.ZIP_DEFLATED); z.close()`],
    null, GLib.SpawnFlags.SEARCH_PATH, null);
    assert(ok, 'python3 could not build the test zip');
    const data = GLib.file_get_contents(zipPath)[1];
    const names = Zip.readZip(data).map(e => e.name).sort();
    assertEq(names, ['metadata.json', 'schemas/a.gschema.xml']);
    Zip.extractZip(data, `${tmp}/out`);
    assertEq(new TextDecoder().decode(GLib.file_get_contents(`${tmp}/out/schemas/a.gschema.xml`)[1]), '<schemalist/>'.repeat(50));

    GLib.spawn_sync(tmp, ['python3', '-c',
        "import zipfile; z = zipfile.ZipFile('evil.zip', 'w'); z.writestr('../evil', 'x'); z.close()"],
    null, GLib.SpawnFlags.SEARCH_PATH, null);
    let threw = false;
    try {
        Zip.extractZip(GLib.file_get_contents(`${tmp}/evil.zip`)[1], `${tmp}/out2`);
    } catch {
        threw = true;
    }
    assert(threw, 'path traversal must be refused');
});

await test('typelibs: generated table has the six namespaces', async () => {
    const {TYPELIBS, VERSION} = await import(url('runtime/gi/typelibs.js'));
    assertEq(Object.keys(TYPELIBS).sort(), ['Clutter', 'Cogl', 'Meta', 'Mtk', 'Shell', 'St']);
    assert(/^\d+$/.test(VERSION), 'version');
    for (const b64 of Object.values(TYPELIBS))
        assertEq(new TextDecoder().decode(GLib.base64_decode(b64).slice(0, 4)), 'GOBJ');
});

await test('compat data parses and lists reasons', () => {
    const data = JSON.parse(new TextDecoder().decode(GLib.file_get_contents(`${ROOT}/runtime/data/compat.json`)[1]));
    assert(data.minShellVersion === 45 && data.maxShellVersion >= 50, 'version range');
    for (const [uuid, reason] of Object.entries(data.incompatible))
        assert(uuid.includes('@') && reason.length > 10, uuid);
});

print(`1..${count}`);
System.exit(failures ? 1 : 0);
