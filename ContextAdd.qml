import QtQuick
import QtQuick.Controls

LabButton {
  id: addButton
  text: "+ Context"
  subtle: true
  signal addRequested(string kind)
  onClicked: typeMenu.popup()

  Menu {
    id: typeMenu
    y: addButton.height
    MenuItem { text: "Group / object"; onTriggered: addButton.addRequested("group") }
    MenuItem { text: "Text"; onTriggered: addButton.addRequested("text") }
    MenuItem { text: "Number"; onTriggered: addButton.addRequested("number") }
    MenuItem { text: "Yes / no"; onTriggered: addButton.addRequested("boolean") }
    MenuItem { text: "List"; onTriggered: addButton.addRequested("list") }
    MenuItem { text: "Raw JSON (advanced)"; onTriggered: addButton.addRequested("json") }
  }
}
