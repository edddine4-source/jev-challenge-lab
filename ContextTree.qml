import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

ColumnLayout {
  id: tree
  property var editorRoot: null
  property var path: []
  property string target: "context"
  readonly property string contextSignature: editorRoot ? (target === "context" ? editorRoot.editor.context : editorRoot.editor.state) : ""
  spacing: 7

  function flatRows() {
    if (!editorRoot) return []
    var all = []
    function visit(rows, parentPath, depth, parentIsList) {
      for (var i = 0; i < rows.length; i++) {
        var row = rows[i]
        all.push({ row: row, path: parentPath, index: i, depth: depth, parentIsList: parentIsList })
        if (row.type === "group" || row.type === "list")
          visit(row.children || [], parentPath.concat([i]), depth + 1, row.type === "list")
      }
    }
    visit(editorRoot.structuredRowsAt(target, []), [], 0,
      target === "state" && editorRoot.editor.format === "json"
        && editorRoot.editor.state.trim().charAt(0) === "[")
    return all
  }

  Repeater {
    model: tree.contextSignature !== undefined ? tree.flatRows().length : 0
    delegate: Rectangle {
      id: contextCard
      required property int index
      readonly property var entry: tree.contextSignature !== undefined ? tree.flatRows()[index] : null
      readonly property var row: entry ? entry.row : ({ key: "", type: "text", value: "" })
      readonly property var nextEntry: tree.flatRows()[index + 1] || null
      Layout.fillWidth: true
      Layout.leftMargin: entry ? entry.depth * 18 : 0
      implicitHeight: contents.implicitHeight + 18
      color: row.type === "group" || row.type === "list" ? "#e3f0d1" : "#e9ece5"
      border.color: row.type === "group" || row.type === "list" ? "#85a763" : "#c3cbbf"

      Repeater {
        model: contextCard.entry ? contextCard.entry.depth : 0
        delegate: Rectangle {
          required property int index
          x: -(contextCard.entry.depth - index) * 18 + 8
          y: -tree.spacing
          width: 2
          height: contextCard.height + tree.spacing * 2
          color: "#6b9941"
        }
      }
      Rectangle {
        visible: contextCard.entry && contextCard.entry.depth > 0
        x: -10
        y: 23
        width: 11
        height: 2
        color: "#6b9941"
      }
      Rectangle {
        visible: (row.type === "group" || row.type === "list") && contextCard.nextEntry
          && contextCard.nextEntry.depth > contextCard.entry.depth
        x: 8
        y: contextCard.height - 2
        width: 2
        height: tree.spacing + 2
        color: "#6b9941"
      }

      ColumnLayout {
        id: contents
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.top: parent.top
        anchors.margins: 9
        spacing: 6
        RowLayout {
          Layout.fillWidth: true
          Text {
            visible: row.type === "group" || row.type === "list" || (entry && entry.parentIsList)
            text: entry && entry.parentIsList ? "ITEM " + (entry.index + 1)
              : row.type === "list" ? "▸ LIST" : "▸ GROUP"
            color: "#36531d"
            font.pixelSize: 10
            font.bold: true
          }
          LabTextField {
            visible: entry && !entry.parentIsList
            Layout.fillWidth: true
            text: row.key
            placeholderText: row.type === "group" ? "Group name" : "Field name"
            onEditingFinished: tree.editorRoot.editContextRow(entry.path, entry.index, "key", text, tree.target)
          }
          LabComboBox {
            readonly property var types: ["text", "number", "boolean", "group", "list", "json"]
            model: ["Text", "Number", "Yes / no", "Group / object", "List", "Raw JSON"]
            currentIndex: Math.max(0, types.indexOf(row.type))
            onActivated: function(selected) { tree.editorRoot.changeContextType(entry.path, entry.index, types[selected], tree.target) }
          }
          LabButton { text: "Remove"; subtle: true; onClicked: tree.editorRoot.removeContextRow(entry.path, entry.index, tree.target) }
        }
        Text {
          visible: row.type === "group" || row.type === "list"
          Layout.fillWidth: true
          text: row.type === "list" ? "Items below belong to this list."
            : "Fields below belong to “" + row.key + "”."
          color: "#4a6040"
          font.pixelSize: 11
        }
        RowLayout {
          visible: row.type === "group" || row.type === "list"
          ContextAdd {
            onAddRequested: function(kind) { tree.editorRoot.addContextRow(entry.path.concat([entry.index]), kind, tree.target) }
          }
        }
        LabTextArea {
          visible: row.type === "text" || row.type === "json"
          Layout.fillWidth: true
          Layout.preferredHeight: row.type === "json" ? 90 : 58
          wrapMode: TextEdit.WrapAnywhere
          placeholderText: row.type === "json" ? "Object or list as JSON" : "Context value"
          text: row.value || ""
          onTextChanged: {
            if (row.type === "text") tree.editorRoot.editContextRow(entry.path, entry.index, "value", text, tree.target)
          }
          onActiveFocusChanged: {
            if (!activeFocus && row.type === "json" && text !== row.value)
              tree.editorRoot.editContextRow(entry.path, entry.index, "value", text, tree.target)
          }
        }
        LabTextField {
          visible: row.type === "number"
          Layout.fillWidth: true
          text: row.value || ""
          inputMethodHints: Qt.ImhFormattedNumbersOnly
          onEditingFinished: tree.editorRoot.editContextRow(entry.path, entry.index, "value", text, tree.target)
        }
        LabComboBox {
          visible: row.type === "boolean"
          model: ["true", "false"]
          currentIndex: row.value === "true" ? 0 : 1
          onActivated: function(selected) { tree.editorRoot.editContextRow(entry.path, entry.index, "value", model[selected], tree.target) }
        }
      }
    }
  }
}
