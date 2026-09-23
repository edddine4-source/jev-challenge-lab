import QtQuick
import QtQuick.Controls

Button {
  id: control
  property bool accent: false
  property bool subtle: false
  implicitWidth: Math.max(78, contentItem.implicitWidth + 22)
  implicitHeight: 36
  contentItem: Text {
    text: control.text
    color: control.enabled ? (control.accent ? "#080a09" : control.subtle ? "#283027" : "#c7ff69") : "#92988f"
    font.pixelSize: 12
    font.bold: true
    horizontalAlignment: Text.AlignHCenter
    verticalAlignment: Text.AlignVCenter
    elide: Text.ElideRight
  }
  background: Rectangle {
    color: control.pressed ? "#a9d85e" : control.hovered ? (control.accent ? "#d7ff95" : control.subtle ? "#f7f9f2" : "#263027") : control.accent ? "#c7ff69" : control.subtle ? "#e5e9df" : "#101510"
    border.color: control.activeFocus ? "#6fa922" : control.subtle ? "#889085" : "#101510"
    radius: 0
    opacity: control.enabled ? 1 : 0.65
  }
}
