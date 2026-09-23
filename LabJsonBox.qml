import QtQuick
import QtQuick.Controls

ScrollView {
  id: box
  property alias text: editor.text
  property alias readOnly: editor.readOnly
  property alias placeholderText: editor.placeholderText
  clip: true
  ScrollBar.vertical.policy: ScrollBar.AlwaysOn
  ScrollBar.horizontal.policy: ScrollBar.AsNeeded
  background: Rectangle { color: "#ffffff"; border.color: "#aab1a4" }

  LabTextArea {
    id: editor
    font.family: "monospace"
    font.pixelSize: 12
    wrapMode: TextEdit.WrapAnywhere
    leftPadding: 12
    rightPadding: 22
    topPadding: 12
    bottomPadding: 12
  }
}
