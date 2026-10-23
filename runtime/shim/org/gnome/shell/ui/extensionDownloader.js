// SPDX-License-Identifier: GPL-3.0-or-later
//
// gnosh: installing and updating extensions from extensions.gnome.org,
// modelled on GNOME Shell's extensionDownloader.js. Installs ask for
// confirmation in a Phosh system dialog, like GNOME Shell does.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';

import * as Config from '../misc/config.js';
import {ExtensionState, ExtensionType} from '../misc/extensionUtils.js';
import * as FileUtils from '../misc/fileUtils.js';
import {extractZip} from '../misc/gnoshZip.js';
import * as Main from './main.js';
import * as ModalDialog from './modalDialog.js';
import * as Dialog from './dialog.js';

const REPOSITORY_URL = 'https://extensions.gnome.org';
const MIN_SHELL = 45;
const MAX_SHELL = 51;

let _session = null;

function session() {
    _session ??= new Soup.Session({user_agent: `gnosh/${Config.GNOSH_VERSION} (GNOME Shell ${Config.PACKAGE_VERSION} API)`});
    return _session;
}

async function getBytes(url, method = 'GET', body = null) {
    const msg = Soup.Message.new(method, url);
    if (body) {
        msg.set_request_body_from_bytes('application/json', new GLib.Bytes(new TextEncoder().encode(body)));
    }
    const bytes = await new Promise((resolve, reject) => {
        session().send_and_read_async(msg, GLib.PRIORITY_DEFAULT, null, (s, res) => {
            try {
                resolve(s.send_and_read_finish(res));
            } catch (e) {
                reject(e);
            }
        });
    });
    if (msg.get_status() !== Soup.Status.OK)
        throw new Error(`${url}: HTTP ${msg.get_status()}`);
    return bytes.toArray();
}

async function getJson(url, method = 'GET', body = null) {
    return JSON.parse(new TextDecoder().decode(await getBytes(url, method, body)));
}

/** Pick the extension build for the GNOME Shell API gnosh implements. */
export function pickVersion(shellVersionMap) {
    const emulated = parseInt(Config.PACKAGE_VERSION, 10);
    const majors = Object.keys(shellVersionMap ?? {}).map(v => parseInt(v, 10))
        .filter(v => v >= MIN_SHELL && v <= MAX_SHELL);
    if (!majors.length)
        return null;
    const best = majors.includes(emulated) ? emulated
        : majors.filter(v => v < emulated).sort((a, b) => b - a)[0] ?? Math.min(...majors);
    const key = Object.keys(shellVersionMap).find(k => parseInt(k, 10) === best);
    return {shell: key, ...shellVersionMap[key]};
}

export async function fetchInfo(uuid) {
    return getJson(`${REPOSITORY_URL}/extension-info/?uuid=${encodeURIComponent(uuid)}`);
}

export async function downloadAndExtract(uuid, destDir) {
    const info = await fetchInfo(uuid);
    const build = pickVersion(info.shell_version_map);
    if (!build)
        throw new Error(`${uuid} has no build for GNOME Shell ${MIN_SHELL}–${MAX_SHELL}`);
    const zip = await getBytes(`${REPOSITORY_URL}/download-extension/${encodeURIComponent(uuid)}.shell-extension.zip?version_tag=${build.pk}`);
    const tmp = GLib.Dir.make_tmp('gnosh-ext-XXXXXX');
    try {
        extractZip(zip, tmp);
        const meta = JSON.parse(new TextDecoder().decode(GLib.file_get_contents(`${tmp}/metadata.json`)[1]));
        if (meta.uuid !== uuid)
            throw new Error(`archive is for ${meta.uuid}, not ${uuid}`);
        const dest = Gio.File.new_for_path(destDir);
        if (dest.query_exists(null))
            FileUtils.recursivelyDeleteDir(dest, true);
        GLib.mkdir_with_parents(GLib.path_get_dirname(destDir), 0o755);
        FileUtils.recursivelyMoveDir(Gio.File.new_for_path(tmp), dest);
    } finally {
        try {
            FileUtils.recursivelyDeleteDir(Gio.File.new_for_path(tmp), true);
        } catch {
            // moved already
        }
    }
    return {info, build};
}

function confirmInstall(info) {
    return new Promise(resolve => {
        const dialog = new ModalDialog.ModalDialog({styleClass: 'extension-dialog'});
        const content = new Dialog.MessageDialogContent({
            title: _('Install Extension'),
            description: _('Download and install “%s” from extensions.gnome.org?').format(info.name),
        });
        dialog.contentLayout.add_child(content);
        dialog.setButtons([
            {label: _('Cancel'), action: () => {
                dialog.close();
                resolve(false);
            }, key: imports.gi.Clutter.KEY_Escape, isCancel: true},
            {label: _('Install'), action: () => {
                dialog.close();
                resolve(true);
            }, default: true},
        ]);
        if (!dialog.open())
            resolve(false);
    });
}

/** org.gnome.Shell.Extensions.InstallRemoteExtension */
export async function installExtension(uuid, invocation = null) {
    const reply = (result, error = null) => {
        if (!invocation)
            return;
        if (error)
            invocation.return_dbus_error('org.gnome.Shell.ExtensionError', error);
        else
            invocation.return_value(new GLib.Variant('(s)', [result]));
    };
    try {
        if (!global.settings.get_boolean('allow-extension-installation')) {
            reply(null, 'Installation of extensions is not allowed');
            return 'denied';
        }
        const info = await fetchInfo(uuid);
        if (!pickVersion(info.shell_version_map)) {
            reply(null, `${uuid} has no build for GNOME Shell ${MIN_SHELL}–${MAX_SHELL}`);
            return 'error';
        }
        if (!await confirmInstall(info)) {
            reply('cancelled');
            return 'cancelled';
        }
        const dir = GLib.build_filenamev([global.userdatadir, 'extensions', uuid]);
        await downloadAndExtract(uuid, dir);
        const manager = Main.extensionManager;
        const old = manager.lookup(uuid);
        if (old)
            await manager.unloadExtension(old);
        const extension = manager.createExtensionObject(uuid, Gio.File.new_for_path(dir), ExtensionType.PER_USER);
        await manager.loadExtension(extension);
        if (!manager.enableExtension(uuid))
            throw new Error(`Cannot enable ${uuid}`);
        reply('successful');
        return 'successful';
    } catch (e) {
        logError(e, `gnosh: installing ${uuid}`);
        reply(null, e.message);
        return 'error';
    }
}

export async function uninstallExtension(uuid) {
    const manager = Main.extensionManager;
    const extension = manager.lookup(uuid);
    if (!extension || extension.type !== ExtensionType.PER_USER)
        return false;
    if (!await manager.unloadExtension(extension))
        return false;
    FileUtils.recursivelyDeleteDir(extension.dir, true);
    try {
        const updateDir = Gio.File.new_for_path(GLib.build_filenamev([global.userdatadir, 'extension-updates', uuid]));
        FileUtils.recursivelyDeleteDir(updateDir, true);
    } catch {
        // no pending update
    }
    return true;
}

/** Download updates into extension-updates/, applied at the next start. */
export async function checkForUpdates() {
    const manager = Main.extensionManager;
    if (!manager?.updatesSupported)
        return;
    const installed = {};
    for (const uuid of manager.getUuids()) {
        const ext = manager.lookup(uuid);
        if (ext.type !== ExtensionType.PER_USER || ext.state === ExtensionState.UNINSTALLED)
            continue;
        installed[uuid] = {version: ext.metadata.version ?? 0};
    }
    if (!Object.keys(installed).length)
        return;
    let updates;
    try {
        updates = await getJson(`${REPOSITORY_URL}/update-info/?shell_version=${Config.PACKAGE_VERSION}`,
            'POST', JSON.stringify(installed));
    } catch (e) {
        console.warn(`gnosh: update check failed: ${e.message}`);
        return;
    }
    for (const [uuid, action] of Object.entries(updates)) {
        if (action !== 'upgrade')
            continue;
        try {
            // eslint-disable-next-line no-await-in-loop
            await downloadAndExtract(uuid, GLib.build_filenamev([global.userdatadir, 'extension-updates', uuid]));
            manager.notifyExtensionUpdate(uuid);
        } catch (e) {
            console.warn(`gnosh: downloading update for ${uuid} failed: ${e.message}`);
        }
    }
}
