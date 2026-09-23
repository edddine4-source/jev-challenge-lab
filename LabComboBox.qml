import QtQuick
import QtQuick.Controls

ComboBox {
  id: control
  implicitWidth: Math.max(90, contentItem.implicitWidth + 30)
  implicitHeight: 34
  contentItem: Text {
    text: control.displayText
    color: "#101510"
    verticalAlignment: Text.AlignVCenter
    leftPadding: 10
    font.pixelSize: 13
  }
  background: Rectangle {
    color: "#ffffff"
    border.color: "#aab1a4"
    radius: 0
  }
  indicator: Text {
    text: "▾"
    color: "#101510"
    x: control.width - width - 9
    y: (control.height - height) / 2
  }
  delegate: ItemDelegate {
    width: control.width
    text: modelData
  }
}
