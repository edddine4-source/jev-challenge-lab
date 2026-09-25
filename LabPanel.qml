import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import Quickshell
import qs.Ui
import "LabModel.js" as LabModel
import "LabExamples.js" as LabExamples

Panel {
  id: root
  moduleName: "io.github.edddine4-source.jev-challenge-lab"
  manageIpc: false

  property var anchorItem: null
  property var hostWidget: null
  property var editor: LabModel.emptyEditor()
  property string currentTab: "compose"
  property string savedKind: "drafts"
  property var savedItems: []
  property string importText: ""
  property string previewText: ""
  property string resultText: ""
  property var resultItems: []
  property string resultModel: ""
  property int resultTokens: 0
  property string responseText: ""
  property string statusText: "Starting local Jev service…"
  property bool serviceReady: false
  property bool connected: false
  property bool busy: false
  property bool loadingSaved: false
  property string entryMode: "menus"
  property bool rawResponseOpen: false
  property bool contextJsonOpen: false
  property bool situationJsonOpen: false
  property string selectedExample: ""
  property var hiddenExamples: []
  property bool examplesLoaded: false
  property var apiKeys: []
  property string activeKeyId: ""

  readonly property string baseUrl: "http://127.0.0.1:8766"
  readonly property string launcherPath: decodeURIComponent(
    String(Qt.resolvedUrl("bin/launch-jev-challenge-lab")).replace(/^file:\/\//, "")
  )

  function request(method, path, payload, callback) {
    var xhr = new XMLHttpRequest()
    xhr.open(method, baseUrl + path)
    xhr.setRequestHeader("Content-Type", "application/json")
    xhr.setRequestHeader("X-Jev-Widget", "1")
    xhr.onreadystatechange = function() {
      if (xhr.readyState !== 4) return
      var data = null
      try { data = JSON.parse(xhr.responseText || "null") } catch (error) {}
      if (xhr.status >= 200 && xhr.status < 300) callback(null, data)
      else callback(data && data.detail ? String(data.detail) : "The local service is unavailable.", data)
    }
    xhr.onerror = function() { callback("The local service is unavailable.", null) }
    xhr.send(payload === null ? null : JSON.stringify(payload))
  }

  function checkHealth() {
    request("GET", "/api/health", null, function(error, data) {
      if (error) {
        serviceReady = false
        statusText = "Starting local Jev service…"
        return
      }
      serviceReady = true
      connected = data.jev_connected === true
      statusText = connected ? "Jev connected" : "Add your TypeSafe API key in the Key tab"
      loadApiKeys()
      if (!examplesLoaded) loadExamplePreferences()
      healthTimer.stop()
    })
  }

  function open() {
    root.controller.show()
    Quickshell.execDetached(["bash", launcherPath, "--service-only"])
    healthTimer.start()
    checkHealth()
  }

  function close() { root.controller.hide() }

  function switchPanel(direction) {
    if (bar && typeof bar.switchPanelFrom === "function")
      return bar.switchPanelFrom(hostWidget || root, direction)
    return false
  }

  function setField(name, value) {
    if (editor[name] === value) return
    var next = JSON.parse(JSON.stringify(editor))
    next[name] = value
    editor = next
  }

  function setSituationFormat(format) {
    if (editor.format === format) return
    var next = JSON.parse(JSON.stringify(editor))
    if (format === "json") {
      var description = String(next.state || "").trim()
      next.state = JSON.stringify(description ? { description: description } : {}, null, 2)
    } else {
      try {
        var value = JSON.parse(next.state || "{}")
        next.state = value && !Array.isArray(value) && Object.keys(value).length === 1
          && typeof value.description === "string" ? value.description : JSON.stringify(value, null, 2)
      } catch (error) { next.state = String(next.state || "") }
    }
    next.format = format
    editor = next
  }

  function setQuestion(index, field, value) {
    if (!editor.questions[index] || editor.questions[index][field] === value) return
    var next = JSON.parse(JSON.stringify(editor))
    next.questions[index][field] = value
    if (field === "type") next.questions[index].criteria = LabModel.blankQuestion(value, index + 1).criteria
    editor = next
  }

  function addQuestion(type) {
    var next = JSON.parse(JSON.stringify(editor))
    next.questions.push(LabModel.blankQuestion(type, next.questions.length + 1))
    editor = next
  }

  function removeQuestion(index) {
    var next = JSON.parse(JSON.stringify(editor))
    next.questions.splice(index, 1)
    editor = next
  }

  function structuredRowsAt(target, path) {
    try {
      var rows = target === "context" ? LabModel.contextRows(editor.context) : LabModel.situationRows(editor.state)
      for (var i = 0; i < path.length; i++) rows = rows[path[i]].children || []
      return rows
    }
    catch (error) { return [] }
  }

  function contextRowsAt(path) { return structuredRowsAt("context", path) }

  function mutateStructured(target, path, action) {
    try {
      var rows = target === "context" ? LabModel.contextRows(editor.context) : LabModel.situationRows(editor.state)
      var children = rows
      for (var i = 0; i < path.length; i++) children = children[path[i]].children
      action(children)
      var value = target === "context" ? LabModel.contextFromRows(rows)
        : LabModel.situationFromRows(rows, Array.isArray(JSON.parse(editor.state || "{}")))
      setField(target === "context" ? "context" : "state", JSON.stringify(value, null, 2))
    } catch (error) { statusText = error.message; if (target === "context") contextJsonOpen = true }
  }

  function mutateContext(path, action) { mutateStructured("context", path, action) }

  function editContextRow(path, index, field, value, target) {
    mutateStructured(target || "context", path, function(rows) { rows[index][field] = value })
  }

  function changeContextType(path, index, type, target) {
    mutateStructured(target || "context", path, function(rows) {
      rows[index].type = type
      rows[index].value = type === "number" ? "0" : type === "boolean" ? "false"
        : type === "json" ? "null" : ""
      rows[index].children = type === "group" || type === "list" ? [] : undefined
    })
  }

  function addContextRow(path, type, target) {
    target = target || "context"
    mutateStructured(target, path, function(rows) {
      var names = rows.map(function(row) { return row.key })
      var number = 1
      var prefix = type === "group" ? "group_" : type === "list" ? "list_" : "field_"
      while (names.indexOf(prefix + number) !== -1) number++
      rows.push(type === "group" || type === "list"
        ? { key: prefix + number, type: type, children: [] }
        : { key: prefix + number, type: type,
            value: type === "number" ? "0" : type === "boolean" ? "false" : type === "json" ? "null" : "" })
    })
  }

  function removeContextRow(path, index, target) {
    mutateStructured(target || "context", path, function(rows) { rows.splice(index, 1) })
  }

  function criteriaRows(index) {
    try { return LabModel.criteriaRows(editor.questions[index]) }
    catch (error) { return [] }
  }

  function editCriteriaRow(index, rowIndex, field, value) {
    try {
      var question = editor.questions[index]
      var rows = LabModel.criteriaRows(question)
      rows[rowIndex][field] = value
      setQuestion(index, "criteria", JSON.stringify(LabModel.criteriaFromRows(question.type, rows), null, 2))
    } catch (error) { statusText = error.message }
  }

  function addCriteriaRow(index) {
    try {
      var question = editor.questions[index]
      var rows = LabModel.criteriaRows(question)
      if (question.type === "score") rows.push({ name: "", description: "Level " + (rows.length + 1) })
      else {
        var names = rows.map(function(row) { return row.name })
        var number = 1
        while (names.indexOf("option_" + number) !== -1) number++
        rows.push({ name: "option_" + number, description: "" })
      }
      setQuestion(index, "criteria", JSON.stringify(LabModel.criteriaFromRows(question.type, rows), null, 2))
    } catch (error) { statusText = error.message }
  }

  function removeCriteriaRow(index, rowIndex) {
    try {
      var question = editor.questions[index]
      var rows = LabModel.criteriaRows(question)
      rows.splice(rowIndex, 1)
      setQuestion(index, "criteria", JSON.stringify(LabModel.criteriaFromRows(question.type, rows), null, 2))
    } catch (error) { statusText = error.message }
  }

  function setNoulDefinition(index, answer, value) {
    try {
      var criteria = JSON.parse(editor.questions[index].criteria || "{}")
      criteria[answer] = value
      setQuestion(index, "criteria", JSON.stringify(criteria, null, 2))
    } catch (error) { statusText = error.message }
  }

  function noulDefinition(index, answer) {
    try {
      var criteria = JSON.parse(editor.questions[index].criteria || "{}")
      return String(criteria[answer] || "")
    } catch (error) { return "" }
  }

  function clearEditor() {
    editor = LabModel.emptyEditor()
    importText = ""
    previewText = ""
    resultText = ""
    resultItems = []
    responseText = ""
    statusText = connected ? "New blank request" : "Add your TypeSafe API key in the Key tab"
    currentTab = "compose"
    entryMode = "menus"
    rawResponseOpen = false
    contextJsonOpen = false
    situationJsonOpen = false
    selectedExample = ""
    Qt.callLater(function() {
      if (editorScroll.contentItem && "contentY" in editorScroll.contentItem)
        editorScroll.contentItem.contentY = 0
    })
  }

  function loadExample(name) {
    editor = LabModel.fromRequest(LabExamples.get(name))
    setField("memo", LabExamples.description(name))
    entryMode = "menus"
    selectedExample = name
    previewText = ""
    resultText = ""
    resultItems = []
    responseText = ""
    statusText = name.charAt(0).toUpperCase() + name.slice(1) + " example loaded — edit it or ask Jev"
    currentTab = "compose"
    Qt.callLater(function() {
      if (editorScroll.contentItem && "contentY" in editorScroll.contentItem)
        editorScroll.contentItem.contentY = 0
    })
  }

  function importRequest() {
    try {
      var value = JSON.parse(importText)
      if (value && !value.questions && !value.state && !value.model) {
        setField("context", JSON.stringify(value, null, 2))
        statusText = "Shared context imported"
      } else if (value && !value.questions && value.state !== undefined) {
        var next = JSON.parse(JSON.stringify(editor))
        var state = value.state
        if (state && state.context !== undefined && state.content !== undefined) {
          next.context = JSON.stringify(state.context, null, 2)
          state = state.content
        }
        next.format = typeof state === "string" ? "text" : "json"
        next.state = typeof state === "string" ? state : JSON.stringify(state, null, 2)
        next.model = value.model || next.model
        editor = next
        statusText = "Situation imported"
      } else {
        editor = LabModel.fromRequest(value)
        resultText = ""
        resultItems = []
        responseText = ""
        statusText = "JSON request converted to the editor"
      }
      entryMode = "menus"
    } catch (error) { statusText = "Import failed: " + error.message }
  }

  function previewRequest() {
    try {
      previewText = JSON.stringify(LabModel.buildRequest(editor), null, 2)
      statusText = "Request JSON is ready"
    } catch (error) { statusText = error.message }
  }

  function runChallenge() {
    if (!serviceReady) { statusText = "Wait for the local service to start"; return }
    var payload
    try { payload = LabModel.buildRequest(editor) }
    catch (error) { statusText = error.message; return }
    previewText = JSON.stringify(payload, null, 2)
    payload.memo = String(editor.memo || "")
    busy = true
    resultText = "Jev is evaluating the request…"
    resultItems = []
    responseText = ""
    request("POST", "/api/jev/challenge", payload, function(error, data) {
      busy = false
      if (error) {
        resultText = "Jev could not answer: " + error
        statusText = error
        return
      }
      showResult(data)
      statusText = "Jev answered and saved the challenge"
    })
  }

  function showResult(data) {
    var lines = []
    var explanations = data.interpretation || []
    for (var i = 0; i < explanations.length; i++) {
      var item = explanations[i]
      lines.push(String(item.name || "Decision") + "\n" + String(item.text || ""))
      var details = item.details || []
      for (var j = 0; j < details.length; j++) {
        var pair = details[j]
        var probability = Number(pair[1])
        lines.push("  " + pair[0] + ": " + (isFinite(probability) ? Math.round(probability * 100) + "%" : pair[1]))
      }
      lines.push("")
    }
    resultText = lines.length ? lines.join("\n") : "Jev returned an answer. Read the raw response below."
    var answers = data.response && data.response.answers ? data.response.answers : {}
    resultItems = explanations.map(function(item) {
      var answer = answers[item.name] || {}
      var details = (item.details || []).map(function(pair) {
        var probability = Number(pair[1])
        var value = isFinite(probability) ? Math.max(0, Math.min(100, Math.round(probability * 100))) : 0
        var label = String(pair[0]).replace(/_/g, " ")
        if (item.type === "score" && answer.legend && answer.legend[String(pair[0])] !== undefined)
          label = String(pair[0]) + " · " + answer.legend[String(pair[0])]
        return { label: label, percent: value }
      })
      var answerType = ["choice", "score", "noul"].indexOf(item.type) >= 0 ? item.type : "decision"
      return { name: String(item.name || "Decision").replace(/_/g, " "),
        type: answerType, text: String(item.text || ""), details: details }
    })
    resultModel = String(data.response && data.response.model || "Jev")
    resultTokens = Number(data.response && data.response.usage && data.response.usage.input_tokens || 0)
    responseText = JSON.stringify(data.response || {}, null, 2)
    rawResponseOpen = false
    if (resultScroll.contentItem && "contentY" in resultScroll.contentItem)
      resultScroll.contentItem.contentY = 0
  }

  function saveDraft() {
    if (!serviceReady) { statusText = "Wait for the local service to start"; return }
    var complete = false
    try { LabModel.buildRequest(editor); complete = true } catch (error) {}
    var payload = {
      draft: LabModel.toDraft(editor), is_complete: complete,
      title: editor.draftTitle || null
    }
    var id = editor.draftId
    request(id ? "PATCH" : "POST", id ? "/api/drafts/" + id : "/api/drafts", payload,
      function(error, data) {
        if (error) { statusText = error; return }
        var next = JSON.parse(JSON.stringify(editor))
        next.draftId = data.id
        next.draftTitle = data.title
        editor = next
        statusText = complete ? "Complete request saved as a draft" : "Incomplete draft saved"
      })
  }

  function loadSaved() {
    if (!serviceReady) return
    loadingSaved = true
    request("GET", savedKind === "drafts" ? "/api/drafts" : "/api/history", null,
      function(error, data) {
        loadingSaved = false
        if (error) { statusText = error; savedItems = []; return }
        savedItems = data.items || []
      })
  }

  function openSaved(item) {
    var draft = savedKind === "drafts"
    request("GET", (draft ? "/api/drafts/" : "/api/history/") + item.id, null,
      function(error, data) {
        if (error) { statusText = error; return }
        try {
          if (draft) {
            var loaded = LabModel.fromDraft(data.draft)
            loaded.draftId = data.id
            loaded.draftTitle = data.title
            editor = loaded
            resultText = "Draft ready to continue"
            resultItems = []
            responseText = ""
          } else {
            editor = LabModel.fromRequest(data.request)
            setField("memo", String(data.memo || ""))
            showResult(data)
          }
          previewText = ""
          currentTab = "compose"
          entryMode = "menus"
          statusText = draft ? "Draft opened" : "Saved challenge opened for reuse"
        } catch (parseError) { statusText = parseError.message }
      })
  }

  function renameSaved(item, title) {
    var path = (savedKind === "drafts" ? "/api/drafts/" : "/api/history/") + item.id
    request("PATCH", path, { title: title }, function(error) {
      statusText = error || "Saved item renamed"
      if (!error) loadSaved()
    })
  }

  function deleteSaved(item) {
    var path = (savedKind === "drafts" ? "/api/drafts/" : "/api/history/") + item.id
    request("DELETE", path, null, function(error) {
      statusText = error || "Saved item deleted"
      if (!error) {
        if (savedKind === "drafts" && editor.draftId === item.id) setField("draftId", null)
        loadSaved()
      }
    })
  }

  function loadApiKeys() {
    request("GET", "/api/settings/api-keys", null, function(error, data) {
      if (error) { statusText = error; return }
      apiKeys = data.keys || []
      activeKeyId = data.active_id || ""
      connected = data.jev_connected === true
    })
  }

  function saveKey(name, value) {
    if (!name.trim()) { statusText = "Enter a name for this key"; return }
    if (!value.trim()) { statusText = "Enter a TypeSafe API key"; return }
    request("POST", "/api/settings/api-keys", { name: name.trim(), api_key: value.trim() }, function(error, data) {
      if (error) { statusText = error; return }
      connected = data.jev_connected === true
      apiKeys = data.keys || []
      activeKeyId = data.active_id || ""
      statusText = "API key saved and selected"
      keyNameField.text = ""
      keyField.text = ""
    })
  }

  function selectKey(keyId) {
    request("PUT", "/api/settings/api-keys/" + encodeURIComponent(keyId) + "/activate", null, function(error, data) {
      if (error) { statusText = error; return }
      apiKeys = data.keys || []
      activeKeyId = data.active_id || ""
      connected = data.jev_connected === true
      statusText = "Active API key changed"
    })
  }

  function renameKey(keyId, name) {
    if (!name.trim()) { statusText = "Enter a name for this key"; return }
    request("PATCH", "/api/settings/api-keys/" + encodeURIComponent(keyId), { name: name.trim() }, function(error, data) {
      if (error) { statusText = error; return }
      apiKeys = data.keys || []
      statusText = "API key renamed"
    })
  }

  function deleteKey(keyId) {
    request("DELETE", "/api/settings/api-keys/" + encodeURIComponent(keyId), null, function(error, data) {
      if (error) { statusText = error; return }
      apiKeys = data.keys || []
      activeKeyId = data.active_id || ""
      connected = data.jev_connected === true
      statusText = "Saved API key deleted"
    })
  }

  function loadExamplePreferences() {
    request("GET", "/api/settings/examples", null, function(error, data) {
      if (!error) {
        hiddenExamples = data.hidden || []
        examplesLoaded = true
      }
    })
  }

  function visibleExamples() {
    return [
      { key: "tone", title: "Message tone", level: "EASY" },
      { key: "astronomy", title: "Astronomy", level: "EASY" },
      { key: "purchase", title: "Homelab purchase", level: "MEDIUM" },
      { key: "news", title: "AI news", level: "MEDIUM" },
      { key: "support", title: "Support routing", level: "ADVANCED" },
      { key: "release", title: "Software release", level: "ADVANCED" },
      { key: "research", title: "Ocean research", level: "ADVANCED" },
      { key: "space", title: "Space mission", level: "ADVANCED" },
      { key: "incident", title: "Cyber incident", level: "ADVANCED" },
      { key: "devsecops", title: "DevSecOps gate", level: "ADVANCED" }
    ].filter(function(item) { return hiddenExamples.indexOf(item.key) === -1 })
  }

  function deleteExample(name) {
    request("DELETE", "/api/settings/examples/" + encodeURIComponent(name), null, function(error, data) {
      if (error) { statusText = error; return }
      hiddenExamples = data.hidden || []
      if (selectedExample === name) selectedExample = ""
      statusText = "Example removed from this widget"
    })
  }

  function restoreExamples() {
    request("DELETE", "/api/settings/examples", null, function(error, data) {
      if (error) { statusText = error; return }
      hiddenExamples = data.hidden || []
      statusText = "All examples restored"
    })
  }

  Timer {
    id: healthTimer
    interval: 500
    repeat: true
    onTriggered: root.checkHealth()
  }

  KeyboardPanel {
    id: panel
    anchorItem: root.anchorItem
    owner: root.hostWidget || root
    bar: root.bar
    open: root.opened
    centerOnBar: true
    focusTarget: keyCatcher
    padding: 0
    contentWidth: panel.fittedContentWidth(1220)
    contentHeight: panel.cappedContentHeight(840)

    PanelKeyCatcher {
      id: keyCatcher
      anchors.fill: parent
      blocked: true

      Rectangle {
        anchors.fill: parent
        color: "#e9ece5"
      }

      ColumnLayout {
        anchors.fill: parent
        spacing: 0

        Rectangle {
          Layout.fillWidth: true
          Layout.preferredHeight: 68
          color: "#080a09"
          RowLayout {
            anchors.fill: parent
            anchors.leftMargin: 20
            anchors.rightMargin: 18
            spacing: 12
            Text {
              text: "JEV / LAB"
              color: "#c7ff69"
              font.pixelSize: 23
              font.bold: true
            }
            Rectangle { Layout.preferredWidth: 1; Layout.preferredHeight: 28; color: "#485443" }
            Text {
              text: root.statusText
              textFormat: Text.PlainText
              color: "#d0d7c8"
              font.pixelSize: 12
              elide: Text.ElideRight
              Layout.fillWidth: true
            }
            LabButton { text: "New blank request"; accent: true; onClicked: root.clearEditor() }
            LabButton { text: "Close"; onClicked: root.close() }
          }
        }

        Rectangle {
          Layout.fillWidth: true
          Layout.preferredHeight: 43
          color: "#151a16"
          RowLayout {
            anchors.fill: parent
            anchors.leftMargin: 20
            anchors.rightMargin: 18
            spacing: 8
            LabButton { text: "Challenge"; accent: root.currentTab === "compose"; onClicked: root.currentTab = "compose" }
            LabButton { text: "Saved work"; accent: root.currentTab === "saved"; onClicked: { root.currentTab = "saved"; root.loadSaved() } }
            LabButton { text: "API keys"; accent: root.currentTab === "key"; onClicked: { root.currentTab = "key"; root.loadApiKeys() } }
            Item { Layout.fillWidth: true }
            Rectangle {
              Layout.preferredWidth: 8
              Layout.preferredHeight: 8
              radius: 4
              color: root.connected ? "#c7ff69" : "#f0b35d"
            }
            Text {
              text: root.connected ? "Jev connected" : "Add API key"
              color: "#e7eee0"
              font.pixelSize: 12
            }
          }
        }

        Rectangle {
          Layout.fillWidth: true
          Layout.preferredHeight: exampleContent.implicitHeight + 24
          visible: root.currentTab === "compose"
          color: "#c7ff69"
          ColumnLayout {
            id: exampleContent
            anchors.left: parent.left
            anchors.right: parent.right
            anchors.top: parent.top
            anchors.leftMargin: 20
            anchors.rightMargin: 20
            anchors.topMargin: 12
            spacing: 7
            RowLayout {
              Layout.fillWidth: true
              Text { text: "TRY AN EXAMPLE"; color: "#080a09"; font.pixelSize: 12; font.bold: true }
              Text { text: "From a quick test to deep nested context"; color: "#3d5425"; font.pixelSize: 11 }
              Item { Layout.fillWidth: true }
              LabButton {
                visible: root.hiddenExamples.length > 0
                text: "Restore all"
                subtle: true
                onClicked: root.restoreExamples()
              }
            }
            Flow {
              id: exampleFlow
              Layout.fillWidth: true
              Layout.preferredHeight: childrenRect.height
              spacing: 6
              Repeater {
                model: root.visibleExamples()
                delegate: Rectangle {
                  required property var modelData
                  width: Math.max(130, exampleTitle.implicitWidth + 36)
                  height: 41
                  color: root.selectedExample === modelData.key ? "#080a09" : exampleMouse.containsMouse ? "#e8ffb7" : "transparent"
                  border.color: "#080a09"
                  Column {
                    anchors.centerIn: parent
                    spacing: 2
                    Text {
                      text: modelData.level
                      color: root.selectedExample === modelData.key ? "#a9cb7b" : "#496333"
                      font.pixelSize: 9
                      font.bold: true
                    }
                    Text {
                      id: exampleTitle
                      text: modelData.title.toUpperCase()
                      color: root.selectedExample === modelData.key ? "#c7ff69" : "#080a09"
                      font.pixelSize: 11
                      font.bold: true
                    }
                  }
                  MouseArea {
                    id: exampleMouse
                    anchors.fill: parent
                    hoverEnabled: true
                    onClicked: root.loadExample(modelData.key)
                  }
                  Rectangle {
                    width: 18
                    height: 18
                    anchors.top: parent.top
                    anchors.right: parent.right
                    color: removeMouse.containsMouse ? "#080a09" : "transparent"
                    Text {
                      anchors.centerIn: parent
                      text: "×"
                      color: removeMouse.containsMouse ? "#c7ff69" : "#36531d"
                      font.pixelSize: 16
                    }
                    MouseArea {
                      id: removeMouse
                      anchors.fill: parent
                      hoverEnabled: true
                      onClicked: root.deleteExample(modelData.key)
                    }
                    ToolTip.visible: removeMouse.containsMouse
                    ToolTip.text: "Remove this example"
                  }
                }
              }
            }
          }
        }

        RowLayout {
          Layout.fillWidth: true
          Layout.fillHeight: true
          visible: root.currentTab === "compose"
          spacing: 0

          ScrollView {
            id: editorScroll
            Layout.fillWidth: true
            Layout.fillHeight: true
            Layout.preferredWidth: 690
            clip: true
            background: Rectangle { color: "#e9ece5" }

            ColumnLayout {
              width: Math.max(340, editorScroll.availableWidth - 28)
              x: 14
              y: 16
              spacing: 12

              Rectangle {
                Layout.fillWidth: true
                implicitHeight: introColumn.implicitHeight + 30
                color: "#080a09"
                ColumnLayout {
                  id: introColumn
                  anchors.left: parent.left
                  anchors.right: parent.right
                  anchors.top: parent.top
                  anchors.margins: 15
                  spacing: 7
                  Text { text: "CHALLENGE JEV AI"; color: "#c7ff69"; font.pixelSize: 20; font.bold: true }
                  Text {
                    Layout.fillWidth: true
                    wrapMode: Text.WordWrap
                    text: "Give Jev a situation, add decisions, review the request, then read its answer in plain language."
                    color: "#eef3e8"
                    font.pixelSize: 12
                  }
                  Text {
                    Layout.fillWidth: true
                    wrapMode: Text.WordWrap
                    text: "Choose how to start. Pasting a ready JSON request fills the same menus for review and editing."
                    color: "#bac8b5"
                    font.pixelSize: 11
                  }
                  RowLayout {
                    Layout.fillWidth: true
                    spacing: 8
                    LabButton { text: "Fill menus"; accent: root.entryMode === "menus"; onClicked: root.entryMode = "menus" }
                    LabButton { text: "Paste ready JSON"; accent: root.entryMode === "json"; onClicked: root.entryMode = "json" }
                    Item { Layout.fillWidth: true }
                  }
                }
              }

              Rectangle {
                Layout.fillWidth: true
                implicitHeight: memoColumn.implicitHeight + 28
                color: "#f6f8f3"
                border.color: "#b9c1b4"
                ColumnLayout {
                  id: memoColumn
                  anchors.left: parent.left
                  anchors.right: parent.right
                  anchors.top: parent.top
                  anchors.margins: 14
                  spacing: 7
                  Text { text: "CHALLENGE NOTE"; color: "#080a09"; font.pixelSize: 14; font.bold: true }
                  Text {
                    Layout.fillWidth: true
                    text: "For your understanding: what is this challenge testing? Saved with drafts and history; never sent to Jev."
                    color: "#4a6040"
                    font.pixelSize: 11
                    wrapMode: Text.WordWrap
                  }
                  LabTextArea {
                    Layout.fillWidth: true
                    Layout.preferredHeight: 100
                    wrapMode: TextEdit.Wrap
                    placeholderText: "Describe the purpose of this challenge or what you want to learn"
                    text: root.editor.memo
                    onTextChanged: root.setField("memo", text)
                  }
                }
              }

              Rectangle {
                visible: root.entryMode === "json"
                Layout.fillWidth: true
                implicitHeight: importColumn.implicitHeight + 24
                color: "#d9ff9e"
                border.color: "#080a09"
                ColumnLayout {
                  id: importColumn
                  anchors.left: parent.left
                  anchors.right: parent.right
                  anchors.top: parent.top
                  anchors.margins: 12
                  spacing: 8
                  RowLayout {
                    Layout.fillWidth: true
                    Text { text: "{ }"; color: "#c7ff69"; font.pixelSize: 15; font.bold: true }
                    Text { text: "START WITH JSON"; color: "#080a09"; font.pixelSize: 14; font.bold: true; Layout.fillWidth: true }
                    LabButton { text: "Use menus"; onClicked: root.entryMode = "menus" }
                  }
                  Text {
                    text: "Paste a complete Jev request or shared context object."
                    color: "#3d5425"
                    font.pixelSize: 11
                  }
                  LabJsonBox {
                    id: importJsonBox
                    Layout.fillWidth: true
                    Layout.preferredHeight: 360
                    placeholderText: "Paste your Jev JSON here"
                    text: root.importText
                    onTextChanged: root.importText = text
                  }
                  LabButton {
                    text: "Fill the form from JSON"
                    onClicked: root.importRequest()
                  }
                }
              }

              Rectangle {
                visible: root.entryMode === "menus"
                Layout.fillWidth: true
                implicitHeight: situationColumn.implicitHeight + 30
                color: "#f6f8f3"
                border.color: "#b9c1b4"
                ColumnLayout {
                  id: situationColumn
                  anchors.left: parent.left
                  anchors.right: parent.right
                  anchors.top: parent.top
                  anchors.margins: 15
                  spacing: 9
                  Text { text: "01   GIVE JEV THE SITUATION"; color: "#080a09"; font.pixelSize: 17; font.bold: true }
                  Text {
                    Layout.fillWidth: true
                    text: "Add context as text, numbers, yes/no, lists, or nested groups. Vertical lines show what belongs together; all facts apply to every decision."
                    color: "#3c483b"
                    font.pixelSize: 12
                    wrapMode: Text.WordWrap
                  }
                  Text {
                    Layout.fillWidth: true
                    text: "How: + Context → Group / object → name it environment → + Context → Text → name it criticality. Jev receives context.environment.criticality."
                    color: "#4a6040"
                    font.pixelSize: 11
                    wrapMode: Text.WordWrap
                  }
                  ContextTree { Layout.fillWidth: true; editorRoot: root; path: [] }
                  RowLayout {
                    Layout.fillWidth: true
                    ContextAdd { onAddRequested: function(kind) { root.addContextRow([], kind) } }
                    Item { Layout.fillWidth: true }
                    LabButton {
                      text: root.contextJsonOpen ? "Hide context JSON" : "Advanced JSON"
                      subtle: true
                      onClicked: root.contextJsonOpen = !root.contextJsonOpen
                    }
                  }
                  LabJsonBox {
                    visible: root.contextJsonOpen
                    Layout.fillWidth: true
                    Layout.preferredHeight: 300
                    placeholderText: "{\n  \"goal\": \"...\"\n}"
                    text: root.editor.context
                    onTextChanged: root.setField("context", text)
                  }
                  RowLayout {
                    Layout.fillWidth: true
                    spacing: 8
                    Text { text: "FORMAT"; color: "#3c483b"; font.pixelSize: 11; font.bold: true }
                    LabComboBox {
                      model: ["text", "json"]
                      currentIndex: root.editor.format === "json" ? 1 : 0
                      onActivated: function(index) { root.setSituationFormat(index === 1 ? "json" : "text") }
                    }
                    Text { text: "MODEL"; color: "#3c483b"; font.pixelSize: 11; font.bold: true }
                    LabTextField {
                      Layout.fillWidth: true
                      text: root.editor.model
                      onTextEdited: root.setField("model", text)
                    }
                  }
                  RowLayout {
                    Layout.fillWidth: true
                    Text { text: "SITUATION TO EVALUATE"; color: "#3c483b"; font.pixelSize: 11; font.bold: true }
                    Item { Layout.fillWidth: true }
                    LabButton {
                      visible: root.editor.format === "json"
                      text: root.situationJsonOpen ? "Hide JSON" : "Advanced JSON"
                      subtle: true
                      onClicked: root.situationJsonOpen = !root.situationJsonOpen
                    }
                  }
                  LabTextArea {
                    visible: root.editor.format === "text"
                    Layout.fillWidth: true
                    Layout.preferredHeight: 145
                    wrapMode: TextEdit.WrapAnywhere
                    placeholderText: "Describe the case Jev should evaluate"
                    text: root.editor.state
                    onTextChanged: root.setField("state", text)
                  }
                  ContextTree {
                    visible: root.editor.format === "json"
                    Layout.fillWidth: true
                    editorRoot: root
                    target: "state"
                  }
                  ContextAdd {
                    visible: root.editor.format === "json"
                    onAddRequested: function(kind) { root.addContextRow([], kind, "state") }
                  }
                  LabJsonBox {
                    visible: root.editor.format === "json" && root.situationJsonOpen
                    Layout.fillWidth: true
                    Layout.preferredHeight: 250
                    text: root.editor.state
                    onTextChanged: root.setField("state", text)
                  }
                }
              }

              Rectangle {
                visible: root.entryMode === "menus"
                Layout.fillWidth: true
                implicitHeight: decisionsColumn.implicitHeight + 30
                color: "#f6f8f3"
                border.color: "#b9c1b4"
                ColumnLayout {
                  id: decisionsColumn
                  anchors.left: parent.left
                  anchors.right: parent.right
                  anchors.top: parent.top
                  anchors.margins: 15
                  spacing: 10
                  Text { text: "02   ADD DECISIONS"; color: "#080a09"; font.pixelSize: 17; font.bold: true }
                  Text {
                    Layout.fillWidth: true
                    text: "Each decision asks Jev for a choice, ordered score, or yes/no answer."
                    color: "#5a6657"
                    font.pixelSize: 12
                    wrapMode: Text.WordWrap
                  }
                  Repeater {
                    model: root.editor.questions.length
                    delegate: Rectangle {
                      id: questionCard
                      required property int index
                      property bool criteriaJsonOpen: false
                      Layout.fillWidth: true
                      implicitHeight: questionColumn.implicitHeight + 22
                      color: "#e9ece5"
                      border.color: "#b9c1b4"
                      ColumnLayout {
                        id: questionColumn
                        anchors.left: parent.left
                        anchors.right: parent.right
                        anchors.top: parent.top
                        anchors.margins: 11
                        spacing: 7
                        RowLayout {
                          Layout.fillWidth: true
                          Text { text: "DECISION " + (index + 1); color: "#080a09"; font.pixelSize: 12; font.bold: true; Layout.fillWidth: true }
                          LabButton { text: "Remove"; subtle: true; onClicked: root.removeQuestion(index) }
                        }
                        RowLayout {
                          Layout.fillWidth: true
                          Text { text: "ANSWER NAME"; color: "#3c483b"; font.pixelSize: 11; font.bold: true }
                          LabTextField {
                            Layout.fillWidth: true
                            text: root.editor.questions[index] ? root.editor.questions[index].name : ""
                            onTextEdited: root.setQuestion(index, "name", text)
                          }
                          LabComboBox {
                            model: ["choice", "score", "noul"]
                            currentIndex: root.editor.questions[index]
                              ? Math.max(0, model.indexOf(root.editor.questions[index].type)) : 0
                            onActivated: function(selected) { root.setQuestion(index, "type", model[selected]) }
                          }
                        }
                        LabTextField {
                          Layout.fillWidth: true
                          placeholderText: "What should Jev decide?"
                          text: root.editor.questions[index] ? root.editor.questions[index].instructions : ""
                          onTextEdited: root.setQuestion(index, "instructions", text)
                        }
                        LabTextArea {
                          Layout.fillWidth: true
                          Layout.preferredHeight: 68
                          placeholderText: "Optional context for this decision"
                          wrapMode: TextEdit.Wrap
                          text: root.editor.questions[index] ? root.editor.questions[index].context : ""
                          onTextChanged: root.setQuestion(index, "context", text)
                        }
                        RowLayout {
                          Layout.fillWidth: true
                          Text {
                            text: !root.editor.questions[index] ? "CRITERIA"
                              : root.editor.questions[index].type === "score" ? "ORDERED LEVELS — LOWEST TO HIGHEST"
                              : root.editor.questions[index].type === "noul" ? "YES / NO DEFINITIONS"
                              : "OPTIONS — ADD EACH POSSIBLE ANSWER"
                            color: "#3c483b"
                            font.pixelSize: 11
                            font.bold: true
                            Layout.fillWidth: true
                          }
                          LabButton {
                            text: questionCard.criteriaJsonOpen ? "Hide JSON" : "Advanced JSON"
                            subtle: true
                            onClicked: questionCard.criteriaJsonOpen = !questionCard.criteriaJsonOpen
                          }
                        }
                        Repeater {
                          model: root.editor.questions[questionCard.index]
                            && root.editor.questions[questionCard.index].type !== "noul"
                            ? root.criteriaRows(questionCard.index).length : 0
                          delegate: RowLayout {
                            required property int index
                            readonly property var criterion: root.criteriaRows(questionCard.index)[index]
                              || ({ name: "", description: "" })
                            Layout.fillWidth: true
                            spacing: 5
                            Text {
                              visible: root.editor.questions[questionCard.index].type === "score"
                              text: String(index + 1)
                              color: "#426417"
                              font.pixelSize: 11
                              font.bold: true
                            }
                            LabTextField {
                              visible: root.editor.questions[questionCard.index].type === "choice"
                              Layout.preferredWidth: 145
                              placeholderText: "Option name"
                              text: criterion.name
                              onEditingFinished: root.editCriteriaRow(questionCard.index, index, "name", text)
                            }
                            LabTextField {
                              Layout.fillWidth: true
                              placeholderText: root.editor.questions[questionCard.index].type === "score"
                                ? "Describe this score level" : "When should Jev choose this?"
                              text: criterion.description
                              onTextEdited: root.editCriteriaRow(questionCard.index, index, "description", text)
                            }
                            LabButton {
                              text: "×"
                              subtle: true
                              onClicked: root.removeCriteriaRow(questionCard.index, index)
                            }
                          }
                        }
                        LabButton {
                          visible: root.editor.questions[index]
                            && root.editor.questions[index].type !== "noul"
                          text: root.editor.questions[index] && root.editor.questions[index].type === "score"
                            ? "+ Add level" : "+ Add option"
                          subtle: true
                          onClicked: root.addCriteriaRow(index)
                        }
                        ColumnLayout {
                          visible: root.editor.questions[index]
                            && root.editor.questions[index].type === "noul"
                          Layout.fillWidth: true
                          spacing: 6
                          Text { text: "What counts as YES?"; color: "#3c483b"; font.pixelSize: 11; font.bold: true }
                          LabTextField {
                            Layout.fillWidth: true
                            placeholderText: "Optional definition of yes"
                            text: root.noulDefinition(questionCard.index, "true")
                            onTextEdited: root.setNoulDefinition(questionCard.index, "true", text)
                          }
                          Text { text: "What counts as NO?"; color: "#3c483b"; font.pixelSize: 11; font.bold: true }
                          LabTextField {
                            Layout.fillWidth: true
                            placeholderText: "Optional definition of no"
                            text: root.noulDefinition(questionCard.index, "false")
                            onTextEdited: root.setNoulDefinition(questionCard.index, "false", text)
                          }
                        }
                        LabTextArea {
                          visible: questionCard.criteriaJsonOpen
                          Layout.fillWidth: true
                          Layout.preferredHeight: 125
                          wrapMode: TextEdit.WrapAnywhere
                          text: root.editor.questions[index] ? root.editor.questions[index].criteria : "{}"
                          onTextChanged: root.setQuestion(index, "criteria", text)
                        }
                      }
                    }
                  }
                  RowLayout {
                    spacing: 7
                    LabButton { text: "+ Choice"; subtle: true; onClicked: root.addQuestion("choice") }
                    LabButton { text: "+ Score"; subtle: true; onClicked: root.addQuestion("score") }
                    LabButton { text: "+ Yes / No"; subtle: true; onClicked: root.addQuestion("noul") }
                  }
                }
              }

              Rectangle {
                visible: root.entryMode === "menus"
                Layout.fillWidth: true
                implicitHeight: reviewColumn.implicitHeight + 30
                color: "#080a09"
                ColumnLayout {
                  id: reviewColumn
                  anchors.left: parent.left
                  anchors.right: parent.right
                  anchors.top: parent.top
                  anchors.margins: 15
                  spacing: 10
                  Text { text: "03   REVIEW AND ASK JEV"; color: "#c7ff69"; font.pixelSize: 17; font.bold: true }
                  Text {
                    Layout.fillWidth: true
                    text: "Check the generated request, save your work, or send it to Jev."
                    color: "#d1dacc"
                    font.pixelSize: 12
                    wrapMode: Text.WordWrap
                  }
                  RowLayout {
                    spacing: 7
                    LabButton { text: "Preview JSON"; onClicked: root.previewRequest() }
                    LabButton { text: root.editor.draftId ? "Update draft" : "Save draft"; onClicked: root.saveDraft() }
                    LabButton {
                      text: root.busy ? "Jev is deciding…" : "Ask Jev  →"
                      accent: true
                      enabled: root.serviceReady && !root.busy
                      onClicked: root.runChallenge()
                    }
                  }
                  LabJsonBox {
                    id: previewJsonBox
                    Layout.fillWidth: true
                    Layout.preferredHeight: 360
                    readOnly: true
                    text: root.previewText || "The generated request JSON appears here."
                  }
                }
              }
              Item { Layout.preferredHeight: 18 }
            }
          }

          Rectangle { Layout.preferredWidth: 1; Layout.fillHeight: true; color: "#bdc5b9" }

          ScrollView {
            id: resultScroll
            Layout.fillWidth: true
            Layout.fillHeight: true
            Layout.preferredWidth: 480
            clip: true
            background: Rectangle { color: "#f6f8f3" }
            ColumnLayout {
              width: Math.max(300, resultScroll.availableWidth - 28)
              x: 14
              y: 16
              spacing: 10
              Rectangle {
                Layout.fillWidth: true
                implicitHeight: resultHeader.implicitHeight + 28
                color: "#080a09"
                ColumnLayout {
                  id: resultHeader
                  anchors.left: parent.left
                  anchors.right: parent.right
                  anchors.top: parent.top
                  anchors.margins: 14
                  spacing: 5
                  Text { text: "JEV'S ANSWER"; color: "#c7ff69"; font.pixelSize: 21; font.bold: true }
                  Text {
                    Layout.fillWidth: true
                    text: root.resultItems.length
                      ? "Plain-language decisions and visual probabilities"
                      : "Your answer appears here after you ask Jev."
                    color: "#c7d1c2"
                    font.pixelSize: 12
                    wrapMode: Text.WordWrap
                  }
                }
              }
              Rectangle {
                visible: root.resultItems.length === 0
                Layout.fillWidth: true
                implicitHeight: Math.max(220, resultBody.implicitHeight + 32)
                color: "#ffffff"
                border.color: "#c4ccc0"
                ColumnLayout {
                  id: resultBody
                  anchors.left: parent.left
                  anchors.right: parent.right
                  anchors.top: parent.top
                  anchors.margins: 16
                  spacing: 12
                  Text {
                    text: root.resultText ? "JEV IS WORKING" : "READY FOR YOUR CHALLENGE"
                    color: "#426417"
                    font.pixelSize: 11
                    font.bold: true
                  }
                  Text {
                    Layout.fillWidth: true
                    text: root.resultText || "Choose an example or build a request on the left. Ask Jev to see its answer here."
                    textFormat: Text.PlainText
                    color: "#1f291d"
                    font.pixelSize: 13
                    lineHeight: 1.25
                    wrapMode: Text.WordWrap
                  }
                }
              }
              Text {
                visible: root.resultItems.length > 0
                Layout.fillWidth: true
                text: root.resultItems.length + (root.resultItems.length === 1 ? " DECISION" : " DECISIONS")
                  + " COMPLETED  ·  " + root.resultModel
                  + (root.resultTokens ? "  ·  " + root.resultTokens + " INPUT TOKENS" : "")
                textFormat: Text.PlainText
                color: "#3b4d32"
                font.pixelSize: 11
                font.bold: true
                wrapMode: Text.WordWrap
              }
              Repeater {
                model: root.resultItems
                delegate: Rectangle {
                  id: answerCard
                  required property var modelData
                  Layout.fillWidth: true
                  implicitHeight: answerColumn.implicitHeight + 30
                  color: "#ffffff"
                  border.color: "#bdc8b6"
                  ColumnLayout {
                    id: answerColumn
                    anchors.left: parent.left
                    anchors.right: parent.right
                    anchors.top: parent.top
                    anchors.margins: 15
                    spacing: 11
                    RowLayout {
                      Layout.fillWidth: true
                      Rectangle {
                        implicitWidth: typeLabel.implicitWidth + 14
                        implicitHeight: 24
                        color: "#c7ff69"
                        border.color: "#080a09"
                        Text {
                          id: typeLabel
                          anchors.centerIn: parent
                          text: answerCard.modelData.type === "noul" ? "YES / NO" : answerCard.modelData.type.toUpperCase()
                          textFormat: Text.PlainText
                          color: "#080a09"
                          font.pixelSize: 10
                          font.bold: true
                        }
                      }
                      Text {
                        Layout.fillWidth: true
                        text: answerCard.modelData.name.toUpperCase()
                        textFormat: Text.PlainText
                        color: "#111a10"
                        font.pixelSize: 12
                        font.bold: true
                        wrapMode: Text.WordWrap
                      }
                    }
                    Text {
                      Layout.fillWidth: true
                      text: answerCard.modelData.text
                      textFormat: Text.PlainText
                      color: "#303b2d"
                      font.pixelSize: 13
                      lineHeight: 1.2
                      wrapMode: Text.WordWrap
                    }
                    Repeater {
                      model: answerCard.modelData.details
                      delegate: ColumnLayout {
                        required property var modelData
                        Layout.fillWidth: true
                        spacing: 4
                        RowLayout {
                          Layout.fillWidth: true
                          Text {
                            Layout.fillWidth: true
                            text: modelData.label
                            textFormat: Text.PlainText
                            color: "#374333"
                            font.pixelSize: 11
                            wrapMode: Text.WordWrap
                          }
                          Text {
                            text: modelData.percent + "%"
                            color: "#111a10"
                            font.pixelSize: 11
                            font.bold: true
                          }
                        }
                        Rectangle {
                          Layout.fillWidth: true
                          Layout.preferredHeight: 10
                          color: "#e9ece5"
                          border.color: "#b7c1b1"
                          Rectangle {
                            width: Math.max(0, (parent.width - 2) * modelData.percent / 100)
                            height: parent.height - 2
                            x: 1
                            y: 1
                            color: "#9be149"
                          }
                        }
                      }
                    }
                  }
                }
              }
              Rectangle {
                Layout.fillWidth: true
                implicitHeight: rawColumn.implicitHeight + 24
                color: "#e9ece5"
                border.color: "#c4ccc0"
                ColumnLayout {
                  id: rawColumn
                  anchors.left: parent.left
                  anchors.right: parent.right
                  anchors.top: parent.top
                  anchors.margins: 12
                  spacing: 9
                  RowLayout {
                    Layout.fillWidth: true
                    Text { text: "RAW RESPONSE JSON"; color: "#263224"; font.pixelSize: 11; font.bold: true; Layout.fillWidth: true }
                    LabButton { text: root.rawResponseOpen ? "Hide JSON" : "Show JSON"; subtle: true; onClicked: root.rawResponseOpen = !root.rawResponseOpen }
                  }
                  LabJsonBox {
                    id: responseJsonBox
                    visible: root.rawResponseOpen
                    Layout.fillWidth: true
                    Layout.preferredHeight: 420
                    readOnly: true
                    text: root.responseText || "The full Jev response will appear here."
                  }
                }
              }
            }
          }
        }

        ColumnLayout {
          Layout.fillWidth: true
          Layout.fillHeight: true
          Layout.margins: 20
          visible: root.currentTab === "saved"
          spacing: 12
          Text { text: "SAVED WORK"; color: "#080a09"; font.pixelSize: 22; font.bold: true }
          Text { text: "Open, rename, or delete drafts and executed challenges saved on this machine."; color: "#4d594b"; font.pixelSize: 12 }
          RowLayout {
            LabButton { text: "Drafts"; accent: root.savedKind === "drafts"; onClicked: { root.savedKind = "drafts"; root.loadSaved() } }
            LabButton { text: "Executed challenges"; accent: root.savedKind === "history"; onClicked: { root.savedKind = "history"; root.loadSaved() } }
            LabButton { text: "Refresh"; subtle: true; onClicked: root.loadSaved() }
            Item { Layout.fillWidth: true }
            LabLabel { text: root.loadingSaved ? "Loading…" : root.savedItems.length + " saved" }
          }
          ScrollView {
            id: savedScroll
            Layout.fillWidth: true
            Layout.fillHeight: true
            clip: true
            ColumnLayout {
              width: Math.max(300, savedScroll.availableWidth - 12)
              spacing: 8
              LabLabel { visible: root.savedItems.length === 0; text: "No saved work in this view yet." }
              Repeater {
                model: root.savedItems
                delegate: Rectangle {
                  required property var modelData
                  Layout.fillWidth: true
                  implicitHeight: savedRow.implicitHeight + 20
                  color: "#f6f8f3"
                  border.color: "#b9c1b4"
                  RowLayout {
                    id: savedRow
                    anchors.left: parent.left
                    anchors.right: parent.right
                    anchors.verticalCenter: parent.verticalCenter
                    anchors.margins: 10
                    spacing: 8
                    ColumnLayout {
                      Layout.fillWidth: true
                      spacing: 3
                      LabTextField { id: renameField; text: modelData.title; Layout.fillWidth: true }
                      LabLabel {
                        visible: !!modelData.memo
                        Layout.fillWidth: true
                        text: modelData.memo || ""
                        elide: Text.ElideRight
                        color: "#596553"
                      }
                    }
                    LabButton { text: "Open"; accent: true; onClicked: root.openSaved(modelData) }
                    LabButton { text: "Rename"; onClicked: root.renameSaved(modelData, renameField.text) }
                    LabButton { text: "Delete"; subtle: true; onClicked: root.deleteSaved(modelData) }
                  }
                }
              }
            }
          }
        }

        ColumnLayout {
          Layout.fillWidth: true
          Layout.fillHeight: true
          Layout.margins: 20
          visible: root.currentTab === "key"
          spacing: 12
          LabLabel { text: "TYPESAFE JEV API KEYS"; font.pixelSize: 22; font.bold: true }
          LabLabel {
            Layout.fillWidth: true
            wrapMode: Text.WordWrap
            text: "Name and save several keys, then choose which one Jev uses. Saved key values are always hidden."
          }
          LabLabel { text: root.connected ? "ACTIVE KEY" : "NO API KEY ACTIVE"; font.bold: true }
          Repeater {
            model: root.apiKeys
            delegate: Rectangle {
              id: keyProfile
              required property var modelData
              property bool renaming: false
              Layout.fillWidth: true
              implicitHeight: keyRow.implicitHeight + 18
              color: modelData.active ? "#d9ff9e" : "#f6f8f3"
              border.color: modelData.active ? "#679d25" : "#b9c1b4"
              RowLayout {
                id: keyRow
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.verticalCenter: parent.verticalCenter
                anchors.leftMargin: 12
                anchors.rightMargin: 12
                spacing: 10
                ColumnLayout {
                  Layout.preferredWidth: keyProfile.renaming ? 420 : 300
                  Layout.maximumWidth: keyProfile.renaming ? 420 : 300
                  spacing: 2
                  LabLabel {
                    Layout.fillWidth: true
                    text: modelData.name + (modelData.active ? "  • ACTIVE" : "")
                    elide: Text.ElideRight
                    font.bold: true
                  }
                  LabLabel { text: modelData.masked_key; color: "#596553" }
                  LabTextField {
                    id: keyRenameField
                    visible: keyProfile.renaming
                    Layout.fillWidth: true
                    text: modelData.name
                    placeholderText: "Key name"
                    onAccepted: root.renameKey(modelData.id, text)
                  }
                }
                Item { Layout.fillWidth: true }
                RowLayout {
                  spacing: 8
                  LabButton {
                    text: keyProfile.renaming ? "Save name" : "Rename"
                    subtle: true
                    onClicked: {
                      if (keyProfile.renaming) root.renameKey(modelData.id, keyRenameField.text)
                      else keyProfile.renaming = true
                    }
                  }
                  LabButton {
                    visible: !modelData.active
                    text: "Use this key"
                    accent: true
                    onClicked: root.selectKey(modelData.id)
                  }
                  LabButton { text: "Delete"; subtle: true; onClicked: root.deleteKey(modelData.id) }
                }
              }
            }
          }
          LabLabel { text: "ADD ANOTHER KEY"; font.bold: true }
          LabTextField {
            id: keyNameField
            Layout.fillWidth: true
            placeholderText: "Name, e.g. Homelab or Test account"
          }
          LabTextField {
            id: keyField
            Layout.fillWidth: true
            echoMode: TextInput.Password
            placeholderText: "Paste your TypeSafe API key"
          }
          LabButton { text: "Save and use key"; accent: true; onClicked: root.saveKey(keyNameField.text, keyField.text) }
          Item { Layout.fillHeight: true }
        }
      }
    }
  }
}
