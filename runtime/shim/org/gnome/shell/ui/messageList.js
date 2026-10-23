// SPDX-License-Identifier: GPL-3.0-or-later
// gnosh: Phosh shows notifications itself; GNOME Shell's message list
// widgets are provided as plain St widgets so subclasses can be defined.

import GObject from 'gi://GObject';
import St from 'gi://St';

export const Message = GObject.registerClass({
    Signals: {'close': {}, 'expanded': {}, 'unexpanded': {}},
}, class Message extends St.Button {
    _init(source) {
        super._init({style_class: 'message', can_focus: true, x_expand: true});
        this.source = source ?? null;
        this.expanded = false;
        this._box = new St.BoxLayout({vertical: true});
        this.set_child(this._box);
        this.titleLabel = new St.Label({style_class: 'message-title'});
        this.bodyLabel = new St.Label({style_class: 'message-body'});
        this._box.add_child(this.titleLabel);
        this._box.add_child(this.bodyLabel);
    }

    setTitle(text) {
        this.titleLabel.text = text ?? '';
    }

    setBody(text) {
        this.bodyLabel.text = text ?? '';
    }

    setUseBodyMarkup() {}

    setIcon() {}

    setSecondaryActor() {}

    expand() {
        this.expanded = true;
        this.emit('expanded');
    }

    unexpand() {
        this.expanded = false;
        this.emit('unexpanded');
    }

    canClose() {
        return true;
    }
});

export const NotificationMessage = GObject.registerClass(
class NotificationMessage extends Message {
    _init(notification) {
        super._init(notification?.source);
        this.notification = notification ?? null;
        if (notification) {
            this.setTitle(notification.title);
            this.setBody(notification.body);
        }
    }

    addAction() {}
});

export const MessageListSection = GObject.registerClass(
class MessageListSection extends St.BoxLayout {
    _init() {
        super._init({vertical: true});
        this._messages = [];
    }

    addMessage(message) {
        this._messages.push(message);
        this.add_child(message);
    }

    moveMessage() {}

    removeMessage(message) {
        this._messages = this._messages.filter(m => m !== message);
        message.destroy();
    }

    clear() {
        [...this._messages].forEach(m => this.removeMessage(m));
    }
});

export const Calendar = GObject.registerClass(class Calendar extends St.Widget {});
export const DateMenuButton = GObject.registerClass(class DateMenuButton extends St.Widget {});
