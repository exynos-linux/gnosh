// SPDX-License-Identifier: GPL-3.0-or-later
// gnosh: build-time configuration GNOME Shell extensions read. gnosh
// implements the GNOME Shell 50 extension API; the reported version can be
// changed with `gnosh config shell-version`.

const gnosh = globalThis.__gnosh ?? {};

export const PACKAGE_NAME = 'gnome-shell';
export const PACKAGE_VERSION = gnosh.shellVersion ?? '50.0';
export const HAVE_NETWORKMANAGER = true;
export const HAVE_PORTAL_HELPER = false;
export const HAVE_BLUETOOTH = true;
export const GETTEXT_PACKAGE = 'gnome-shell';
export const LOCALEDIR = gnosh.localeDir ?? '/usr/share/locale';
export const LIBEXECDIR = '/usr/libexec';
export const PKGDATADIR = '/usr/share/gnome-shell';
export const LIBMUTTER_API_VERSION = 18;
export const UTILITIES_FOLDER_APPS = [];
export const SYSTEM_FOLDER_APPS = [];
// gnosh additions
export const GNOSH = true;
export const GNOSH_VERSION = gnosh.version ?? 'dev';
