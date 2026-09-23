import QtQuick
import Quickshell
import qs.Ui

// This bar widget is deliberately a launcher: the complete lab remains in a
// browser, where its JSON editor, saved drafts, execution history, and wide
// result panel have the space they need.
BarWidget {
  id: root
  moduleName: "io.github.edddine4-source.jev-challenge-lab"

  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  WidgetButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    text: "Jev"
    tooltipText: "Open Jev Challenge Lab"

    onPressed: function(mouseButton) {
      if (mouseButton === Qt.LeftButton)
        Quickshell.execDetached(["bash", Qt.resolvedUrl("bin/launch-jev-challenge-lab").toLocalFile()])
    }
  }
}
