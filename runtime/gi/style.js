// SPDX-License-Identifier: GPL-3.0-or-later
//
// St styling on top of GTK 3 CSS.
//
// GNOME Shell extensions style their widgets with St CSS (style_class, inline
// `style`, stylesheet.css). Most St properties exist in GTK CSS too; the few
// that do not (icon-size, spacing, width, height, text-align, -st-*) are
// pulled out and applied to the GTK widgets directly.

import Gdk from 'gi://Gdk?version=3.0';
import Gtk from 'gi://Gtk?version=3.0';

// Declarations GTK 3 understands and that mean the same in St.
const GTK_PROPERTIES = new Set([
    'color', 'background', 'background-color', 'background-image', 'background-size',
    'background-position', 'background-repeat', 'background-clip', 'background-origin',
    'border', 'border-width', 'border-color', 'border-style', 'border-radius',
    'border-top', 'border-right', 'border-bottom', 'border-left',
    'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
    'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
    'border-top-left-radius', 'border-top-right-radius',
    'border-bottom-left-radius', 'border-bottom-right-radius',
    'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
    'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
    'font', 'font-family', 'font-size', 'font-style', 'font-weight', 'font-variant',
    'font-feature-settings', 'letter-spacing', 'text-decoration', 'text-shadow',
    'box-shadow', 'opacity', 'min-width', 'min-height', 'outline', 'outline-color',
    'outline-width', 'outline-style', 'outline-offset', 'transition',
    'transition-duration', 'transition-property', 'transition-timing-function',
    '-gtk-icon-shadow', '-gtk-icon-effect', '-gtk-icon-transform',
]);

// St element names that appear in selectors, mapped to GTK 3 CSS node names.
const ELEMENT_NAMES = {
    StLabel: 'label', StIcon: 'image', StButton: 'button', StEntry: 'entry',
    StBoxLayout: 'box', StScrollView: 'scrolledwindow', StDrawingArea: 'drawingarea',
    StBin: '*', StWidget: '*', ClutterActor: '*', StViewport: '*', ClutterText: 'label',
    StScrollBar: 'scrollbar',
};

const PSEUDO_CLASSES = {
    hover: 'hover', active: 'active', checked: 'checked', focus: 'focus',
    insensitive: 'disabled', selected: 'selected', 'first-child': 'first-child',
    'last-child': 'last-child', highlighted: 'selected',
};

/** Parse "a: b; c: d" into [[prop, value], ...]. */
export function parseDeclarations(text) {
    const out = [];
    if (!text)
        return out;
    for (const decl of text.split(';')) {
        const idx = decl.indexOf(':');
        if (idx < 0)
            continue;
        const prop = decl.slice(0, idx).trim().toLowerCase();
        const value = decl.slice(idx + 1).trim();
        if (prop && value)
            out.push([prop, value]);
    }
    return out;
}

/** Convert a CSS length to pixels (px, pt, em relative to 16px). */
export function parseLength(value, fontSize = 16) {
    if (value === undefined || value === null)
        return null;
    const m = String(value).trim().match(/^(-?[\d.]+)\s*(px|pt|em|rem|%)?$/);
    if (!m)
        return null;
    const n = parseFloat(m[1]);
    switch (m[2]) {
    case 'pt':
        return Math.round(n * 4 / 3);
    case 'em':
    case 'rem':
        return Math.round(n * fontSize);
    case '%':
        return null;
    default:
        return Math.round(n);
    }
}

/**
 * Split St declarations into GTK CSS text and St-only properties.
 *
 * @returns {{css: string, st: Object<string,string>}}
 */
export function splitDeclarations(decls) {
    const css = [];
    const st = {};
    for (const [prop, value] of decls) {
        if (GTK_PROPERTIES.has(prop))
            css.push(`${prop}: ${value};`);
        else
            st[prop] = value;
    }
    return {css: css.join(' '), st};
}

function translateSelector(selector, scope) {
    let s = selector.trim();
    if (!s)
        return null;
    // :insensitive and friends
    s = s.replace(/:([a-z-]+)/g, (m, name) => PSEUDO_CLASSES[name] ? `:${PSEUDO_CLASSES[name]}` : m);
    // St element names
    s = s.replace(/(^|[\s>+~])([A-Z][A-Za-z]+)/g, (m, sep, name) =>
        ELEMENT_NAMES[name] ? `${sep}${ELEMENT_NAMES[name]}` : m);
    // Bare `stage` rules apply to all of our widgets.
    s = s.replace(/(^|[\s>+~])stage\b/g, '$1.gnosh');
    // `#id` selectors are St widget names, which we set as GTK widget names too.
    return scope ? `${scope} ${s}, ${scope}${s.startsWith('.') ? s : ` ${s}`}` : s;
}

/** Remove comments from a stylesheet. */
function stripComments(text) {
    return text.replace(/\/\*[\s\S]*?\*\//g, '');
}

/**
 * Translate an St stylesheet to GTK 3 CSS.
 *
 * Returns the GTK CSS plus a list of rules with St-only properties
 * (icon-size, spacing, ...) so they can be applied to matching widgets.
 *
 * @param {string} text St CSS
 * @param {string} scope selector all rules are nested under (or '')
 */
export function translateStylesheet(text, scope = '') {
    const css = [];
    const stRules = [];
    const body = stripComments(text);
    const re = /([^{}]+)\{([^{}]*)\}/g;
    let m;
    while ((m = re.exec(body)) !== null) {
        const selectorText = m[1].trim();
        if (selectorText.startsWith('@'))
            continue;
        const selectors = selectorText.split(',').map(s => s.trim()).filter(Boolean);
        const {css: decls, st} = splitDeclarations(parseDeclarations(m[2]));
        const translated = selectors.map(s => translateSelector(s, scope)).filter(Boolean);
        if (decls && translated.length)
            css.push(`${translated.join(', ')} { ${decls} }`);
        if (Object.keys(st).length) {
            for (const sel of selectors) {
                // Only simple class selectors can be matched cheaply.
                const classes = sel.match(/^(?:[A-Za-z]+)?((?:\.[\w-]+)+)$/);
                if (classes) {
                    // .gnosh marks gnosh's GTK widgets; it is not an St class.
                    const list = classes[1].split('.').filter(c => c && c !== 'gnosh');
                    if (list.length)
                        stRules.push({classes: list, st});
                }
            }
        }
    }
    return {css: css.join('\n'), stRules};
}

let _stRules = [];

/** Rules with St-only properties from loaded stylesheets, newest last. */
export function addStRules(rules, owner) {
    for (const rule of rules)
        _stRules.push({...rule, owner});
}

export function removeStRules(owner) {
    _stRules = _stRules.filter(r => r.owner !== owner);
}

/** St-only properties that apply to an element with the given classes. */
export function lookupStProperties(classes) {
    const out = {};
    if (!classes.length)
        return out;
    for (const rule of _stRules) {
        if (rule.classes.every(c => classes.includes(c)))
            Object.assign(out, rule.st);
    }
    return out;
}

const _providers = new Map();

/** Load GTK CSS for the whole screen (owner keys allow unloading). */
export function loadScreenCss(owner, cssText, priority = Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION) {
    unloadScreenCss(owner);
    const provider = new Gtk.CssProvider();
    const errors = [];
    provider.connect('parsing-error', (p, section, error) => {
        errors.push(error.message);
    });
    try {
        provider.load_from_data(cssText);
    } catch (e) {
        errors.push(e.message);
    }
    const screen = Gdk.Screen.get_default();
    if (screen)
        Gtk.StyleContext.add_provider_for_screen(screen, provider, priority);
    _providers.set(owner, provider);
    return errors;
}

export function unloadScreenCss(owner) {
    const provider = _providers.get(owner);
    if (!provider)
        return;
    const screen = Gdk.Screen.get_default();
    if (screen)
        Gtk.StyleContext.remove_provider_for_screen(screen, provider);
    _providers.delete(owner);
}

/** Apply a per-widget CSS declaration block (St inline `style`). */
export function setWidgetCss(widget, cssText, state) {
    const ctx = widget.get_style_context();
    if (state.provider) {
        ctx.remove_provider(state.provider);
        state.provider = null;
    }
    if (!cssText)
        return;
    const provider = new Gtk.CssProvider();
    try {
        provider.load_from_data(`* { ${cssText} }`);
    } catch {
        // Unsupported declarations are skipped; keep what parsed.
    }
    ctx.add_provider(provider, Gtk.STYLE_PROVIDER_PRIORITY_USER);
    state.provider = provider;
}
