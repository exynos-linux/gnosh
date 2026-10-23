// SPDX-License-Identifier: GPL-3.0-or-later
// gnosh: the prefs host's view of installed extensions (used by
// ExtensionPreferences.lookupByUUID()).
export const extensionManager = {
    lookup(uuid) {
        return globalThis.__gnoshPrefs?.extensions.get(uuid) ?? null;
    },
};
