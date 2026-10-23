// gnosh: copied from GNOME Shell 50 (GPL-2.0-or-later) and adapted for Phosh.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import * as Config from './config.js';

let _ifaceResource = null;

/**
 * @private
 */
function _ensureIfaceResource() {
    // gnosh: the interface XML files are part of gnosh's own resource
    // bundle, registered at startup.
    _ifaceResource = true;
}

/**
 * @param {string} iface the interface name
 * @returns {string | null} the XML string or null if it is not found
 */
export function loadInterfaceXML(iface) {
    _ensureIfaceResource();

    const uri = `resource:///org/gnome/shell/dbus-interfaces/${iface}.xml`;
    const f = Gio.File.new_for_uri(uri);

    try {
        const [ok_, bytes] = f.load_contents(null);
        return new TextDecoder().decode(bytes);
    } catch {
        log(`Failed to load D-Bus interface ${iface}`);
    }

    return null;
}

/**
 * @param {string} iface the interface name
 * @param {string} ifaceFile the interface filename
 * @returns {string | null} the XML string or null if it is not found
 */
export function loadSubInterfaceXML(iface, ifaceFile) {
    const xml = loadInterfaceXML(ifaceFile);
    if (!xml)
        return null;

    const ifaceStartTag = `<interface name="${iface}">`;
    const ifaceStopTag = '</interface>';
    const ifaceStartIndex = xml.indexOf(ifaceStartTag);
    const ifaceEndIndex = xml.indexOf(ifaceStopTag, ifaceStartIndex + 1) + ifaceStopTag.length;

    const xmlHeader = '<!DOCTYPE node PUBLIC\n' +
        '\'-//freedesktop//DTD D-BUS Object Introspection 1.0//EN\'\n' +
        '\'http://www.freedesktop.org/standards/dbus/1.0/introspect.dtd\'>\n' +
        '<node>\n';
    const xmlFooter = '</node>';

    return (
        xmlHeader +
        xml.substring(ifaceStartIndex, ifaceEndIndex) +
        xmlFooter);
}

/**
 * Emits a D-Bus signal to the given destination bus name.
 *
 * @param {Gio.DBusInterfaceSkeleton} dbusImpl - The D-Bus implementation
 * @param {string|null} destination - The destination bus name or null
 * @param {string} signalName - The signal name
 * @param {GLib.Variant|null} params - The signal parameters or null
 */
export function emitSignalToDestination(dbusImpl, destination, signalName, params) {
    const connection = dbusImpl.get_connection();
    const info = dbusImpl.get_info();
    connection.emit_signal(
        destination,
        dbusImpl.get_object_path(),
        info?.name ?? null,
        signalName,
        params);
}
