// SPDX-License-Identifier: GPL-3.0-or-later
//
// A minimal StatusNotifierItem (KDE/AppIndicator tray icon) with a DBusMenu,
// used to test the AppIndicator extension in Phosh: gjs -m sni-app.js

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const SNI_XML = `<node><interface name="org.kde.StatusNotifierItem">
  <property name="Category" type="s" access="read"/>
  <property name="Id" type="s" access="read"/>
  <property name="Title" type="s" access="read"/>
  <property name="Status" type="s" access="read"/>
  <property name="IconName" type="s" access="read"/>
  <property name="ToolTip" type="(sa(iiay)ss)" access="read"/>
  <property name="ItemIsMenu" type="b" access="read"/>
  <property name="Menu" type="o" access="read"/>
  <method name="Activate"><arg type="i" direction="in"/><arg type="i" direction="in"/></method>
  <method name="SecondaryActivate"><arg type="i" direction="in"/><arg type="i" direction="in"/></method>
  <method name="ContextMenu"><arg type="i" direction="in"/><arg type="i" direction="in"/></method>
  <method name="Scroll"><arg type="i" direction="in"/><arg type="s" direction="in"/></method>
  <signal name="NewIcon"/><signal name="NewTitle"/><signal name="NewStatus"><arg type="s"/></signal>
</interface></node>`;

const MENU_XML = `<node><interface name="com.canonical.dbusmenu">
  <property name="Version" type="u" access="read"/>
  <property name="TextDirection" type="s" access="read"/>
  <property name="Status" type="s" access="read"/>
  <method name="GetLayout"><arg type="i" direction="in"/><arg type="i" direction="in"/><arg type="as" direction="in"/>
    <arg type="u" direction="out"/><arg type="(ia{sv}av)" direction="out"/></method>
  <method name="GetGroupProperties"><arg type="ai" direction="in"/><arg type="as" direction="in"/><arg type="a(ia{sv})" direction="out"/></method>
  <method name="GetProperty"><arg type="i" direction="in"/><arg type="s" direction="in"/><arg type="v" direction="out"/></method>
  <method name="Event"><arg type="i" direction="in"/><arg type="s" direction="in"/><arg type="v" direction="in"/><arg type="u" direction="in"/></method>
  <method name="AboutToShow"><arg type="i" direction="in"/><arg type="b" direction="out"/></method>
  <signal name="LayoutUpdated"><arg type="u"/><arg type="i"/></signal>
  <signal name="ItemsPropertiesUpdated"><arg type="a(ia{sv})"/><arg type="a(ias)"/></signal>
</interface></node>`;

const items = {1: 'Hello from a tray app', 2: 'Second item'};
const props = id => {
    const p = {label: new GLib.Variant('s', items[id]), enabled: new GLib.Variant('b', true), visible: new GLib.Variant('b', true)};
    return p;
};

const sni = {
    Category: 'ApplicationStatus',
    Id: 'gnosh-sni-test',
    Title: 'gnosh tray test',
    Status: 'Active',
    IconName: 'face-smile-symbolic',
    ToolTip: ['', [], 'gnosh tray test', 'A StatusNotifierItem'],
    ItemIsMenu: false,
    Menu: '/MenuBar',
    Activate() {
        print('SNI: Activate');
    },
    SecondaryActivate() {},
    ContextMenu() {},
    Scroll() {},
};

const menu = {
    Version: 3,
    TextDirection: 'ltr',
    Status: 'normal',
    GetLayout(parentId) {
        const children = Object.keys(items).map(id =>
            new GLib.Variant('(ia{sv}av)', [Number(id), props(id), []]));
        return [1, [parentId, {'children-display': new GLib.Variant('s', 'submenu')}, children]];
    },
    GetGroupProperties(ids) {
        return ids.filter(id => items[id]).map(id => [id, props(id)]);
    },
    GetProperty(id, name) {
        return props(id)[name] ?? new GLib.Variant('s', '');
    },
    Event(id, type) {
        print(`SNI: menu event ${type} on item ${id}`);
    },
    AboutToShow() {
        return false;
    },
};

const conn = Gio.DBus.session;
Gio.DBusExportedObject.wrapJSObject(SNI_XML, sni).export(conn, '/StatusNotifierItem');
Gio.DBusExportedObject.wrapJSObject(MENU_XML, menu).export(conn, '/MenuBar');
const busName = `org.kde.StatusNotifierItem-${new Gio.Credentials().get_unix_pid()}-1`;
Gio.bus_own_name_on_connection(conn, busName, 0, () => {
    conn.call('org.kde.StatusNotifierWatcher', '/StatusNotifierWatcher', 'org.kde.StatusNotifierWatcher',
        'RegisterStatusNotifierItem', new GLib.Variant('(s)', [busName]), null, 0, -1, null, (c, res) => {
            try {
                c.call_finish(res);
                print(`SNI: registered ${busName}`);
            } catch (e) {
                print(`SNI: registration failed: ${e.message}`);
            }
        });
}, null);
new GLib.MainLoop(null, false).run();
