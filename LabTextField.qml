import QtQuick
import QtQuick.Controls

TextField {
  color: "#101510"
  placeholderTextColor: "#7a8277"
  selectionColor: "#c7ff69"
  selectedTextColor: "#101510"
  font.pixelSize: 13
  leftPadding: 10
  rightPadding: 10
  background: Rectangle {
    color: "#ffffff"
    border.color: parent.activeFocus ? "#518014" : "#aab1a4"
    border.width: 1
    radius: 0
  }
}
