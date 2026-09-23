.pragma library

function emptyEditor() {
  return {
    model: "jev-latest", format: "text", state: "", context: "{}", memo: "",
    questions: [], draftId: null, draftTitle: ""
  }
}

function blankQuestion(type, index) {
  var kind = type || "choice"
  var criteria = kind === "score" ? ["Low", "Medium", "High"]
    : kind === "noul" ? { "true": "", "false": "" }
    : { option_a: "", option_b: "" }
  return {
    name: kind + "_" + index, type: kind, instructions: "", context: "",
    criteria: JSON.stringify(criteria, null, 2)
  }
}

function validObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function parseContext(raw) {
  var value = JSON.parse(raw || "{}")
  if (!validObject(value)) throw new Error("Shared context must be a JSON object.")
  return value
}

function contextRows(raw) {
  return objectToFacts(parseContext(raw))
}

function contextFromRows(rows) {
  return factsToObject(rows)
}

function situationRows(raw) {
  var value = JSON.parse(raw || "{}")
  if (value === null || typeof value !== "object") throw new Error("The situation must be an object or list.")
  return objectToFacts(value)
}

function situationFromRows(rows, isList) {
  return factsToValue(rows, !!isList)
}

function criteriaRows(question) {
  if (!question) return []
  var parsed = JSON.parse(question.criteria || (question.type === "score" ? "[]" : "{}"))
  if (question.type === "score") {
    if (!Array.isArray(parsed)) throw new Error("Score levels must be a JSON list.")
    return parsed.map(function(value) { return { name: "", description: String(value) } })
  }
  if (!validObject(parsed)) throw new Error("Options must be a JSON object.")
  return Object.keys(parsed).map(function(key) { return { name: key, description: String(parsed[key] || "") } })
}

function criteriaFromRows(type, rows) {
  if (type === "score") return rows.map(function(row) { return String(row.description || "") })
  var result = {}
  for (var i = 0; i < rows.length; i++) {
    var key = String(rows[i].name || "").trim()
    if (!key) throw new Error("Give each option a name.")
    if (Object.prototype.hasOwnProperty.call(result, key)) throw new Error("Option names must be unique.")
    result[key] = String(rows[i].description || "")
  }
  return result
}

function buildRequest(editor) {
  var content = editor.format === "json" ? JSON.parse(editor.state || "null") : String(editor.state || "").trim()
  if (editor.format === "json" && (content === null || typeof content !== "object"))
    throw new Error("The situation must be a JSON object or list.")
  if (editor.format !== "json" && !content)
    throw new Error("Enter the situation Jev should evaluate.")
  var context = parseContext(editor.context)
  var state = Object.keys(context).length ? { context: context, content: content } : content
  var questions = {}
  var source = editor.questions || []
  if (!source.length) throw new Error("Add at least one decision.")
  for (var i = 0; i < source.length; i++) {
    var item = source[i]
    var name = String(item.name || "").trim()
    if (!name) throw new Error("Every decision needs an answer name.")
    if (questions[name]) throw new Error("Answer names must be unique.")
    if (["choice", "score", "noul"].indexOf(item.type) < 0)
      throw new Error("Choose a supported decision type.")
    var value = { type: item.type }
    var task = String(item.instructions || "").trim()
    var localContext = String(item.context || "").trim()
    if (localContext) value.instructions = { task: task || "Evaluate this decision.", context: localContext }
    else if (task) value.instructions = task
    var criteria = JSON.parse(item.criteria || (item.type === "score" ? "[]" : "{}"))
    if (item.type === "choice") {
      if (!validObject(criteria) || !Object.keys(criteria).length)
        throw new Error("Choice “" + name + "” needs a JSON object of options.")
      value.criteria = criteria
    } else if (item.type === "score") {
      if (!Array.isArray(criteria) || !criteria.length)
        throw new Error("Score “" + name + "” needs a JSON list of levels.")
      value.criteria = criteria
    } else if (criteria !== null && Object.keys(criteria).length) {
      if (!validObject(criteria)) throw new Error("Yes/no criteria must be a JSON object.")
      value.criteria = criteria
    }
    questions[name] = value
  }
  return { model: String(editor.model || "jev-latest").trim() || "jev-latest", state: state, questions: questions }
}

function fromRequest(payload) {
  if (!validObject(payload)) throw new Error("The Jev request must be a JSON object.")
  var editor = emptyEditor()
  editor.model = String(payload.model || "jev-latest")
  var state = payload.state
  var content = state
  if (validObject(state) && Object.prototype.hasOwnProperty.call(state, "context")
      && Object.prototype.hasOwnProperty.call(state, "content")) {
    editor.context = JSON.stringify(state.context, null, 2)
    content = state.content
  }
  editor.format = typeof content === "string" ? "text" : "json"
  editor.state = typeof content === "string" ? content : JSON.stringify(content, null, 2)
  if (!validObject(payload.questions)) throw new Error("The request needs a questions object.")
  var names = Object.keys(payload.questions)
  for (var i = 0; i < names.length; i++) {
    var item = payload.questions[names[i]]
    if (!validObject(item)) throw new Error("Each question must be an object.")
    var instructions = item.instructions
    editor.questions.push({
      name: names[i], type: String(item.type || "choice"),
      instructions: typeof instructions === "string" ? instructions : String(instructions && instructions.task || ""),
      context: validObject(instructions) ? String(instructions.context || "") : "",
      criteria: JSON.stringify(item.criteria === undefined ? {} : item.criteria, null, 2)
    })
  }
  return editor
}

function factsToValue(facts, isList) {
  var result = isList ? [] : {}
  for (var i = 0; i < facts.length; i++) {
    var fact = facts[i]
    if (!fact) continue
    var key = isList ? i : String(fact.key || "").trim()
    if (!isList && !key) throw new Error("Give each field or group a name.")
    if (!isList && Object.prototype.hasOwnProperty.call(result, key)) throw new Error("Names must be unique within a group.")
    if (fact.type === "group") result[key] = factsToValue(fact.children || [], false)
    else if (fact.type === "list") result[key] = factsToValue(fact.children || [], true)
    else if (fact.type === "number") {
      var number = Number(fact.value)
      if (!isFinite(number) || !String(fact.value).trim()) throw new Error("Enter a valid number for “" + key + "”.")
      result[key] = number
    } else if (fact.type === "boolean") result[key] = String(fact.value) === "true"
    else if (fact.type === "json") result[key] = JSON.parse(fact.value)
    else result[key] = String(fact.value || "")
  }
  return result
}

function factsToObject(facts) { return factsToValue(facts, false) }

function objectToFacts(value) {
  var facts = []
  var names = Object.keys(value || {})
  for (var i = 0; i < names.length; i++) {
    var key = names[i], item = value[key]
    if (typeof item === "string") facts.push({ key: key, type: "text", value: item })
    else if (typeof item === "number") facts.push({ key: key, type: "number", value: String(item) })
    else if (typeof item === "boolean") facts.push({ key: key, type: "boolean", value: String(item) })
    else if (Array.isArray(item))
      facts.push({ key: key, type: "list", children: objectToFacts(item) })
    else if (validObject(item))
      facts.push({ key: key, type: "group", children: objectToFacts(item) })
    else facts.push({ key: key, type: "json", value: JSON.stringify(item, null, 2) })
  }
  return facts
}

function toDraft(editor) {
  var context = {}
  try { context = parseContext(editor.context) } catch (error) {}
  var questions = (editor.questions || []).map(function(item) {
    var criteria = item.type === "score" ? [] : item.type === "noul" ? ["", ""] : []
    try {
      var parsed = JSON.parse(item.criteria || "null")
      if (item.type === "choice" && validObject(parsed))
        criteria = Object.keys(parsed).map(function(key) { return [key, parsed[key]] })
      else if (item.type === "score" && Array.isArray(parsed)) criteria = parsed
      else if (item.type === "noul" && validObject(parsed)) criteria = [parsed.true || "", parsed.false || ""]
    } catch (error) {}
    return {
      name: item.name, type: item.type, instructions: item.instructions,
      context: item.context, criteria: criteria
    }
  })
  return {
    model: editor.model, format: editor.format, state: editor.state,
    contextFacts: objectToFacts(context), questions: questions, memo: String(editor.memo || ""),
    _widget: {
      model: editor.model, format: editor.format, state: editor.state,
      context: editor.context, questions: editor.questions, memo: String(editor.memo || "")
    }
  }
}

function fromDraft(draft) {
  if (draft._widget) {
    var own = draft._widget
    return {
      model: own.model || "jev-latest", format: own.format || "text",
      state: own.state || "", context: own.context || "{}",
      questions: own.questions || [], memo: String(own.memo || draft.memo || ""), draftId: null, draftTitle: ""
    }
  }
  var editor = emptyEditor()
  editor.model = draft.model || "jev-latest"
  editor.format = draft.format || "text"
  editor.state = draft.state || ""
  editor.memo = String(draft.memo || "")
  editor.context = JSON.stringify(factsToObject(draft.contextFacts || []), null, 2)
  editor.questions = (draft.questions || []).map(function(item) {
    var criteria = item.criteria
    if (item.type === "choice" && Array.isArray(criteria)) {
      var choices = {}
      for (var i = 0; i < criteria.length; i++) if (criteria[i][0]) choices[criteria[i][0]] = criteria[i][1]
      criteria = choices
    } else if (item.type === "noul" && Array.isArray(criteria)) {
      criteria = { "true": criteria[0] || "", "false": criteria[1] || "" }
    }
    return {
      name: item.name || "", type: item.type || "choice",
      instructions: item.instructions || "", context: item.context || "",
      criteria: JSON.stringify(criteria || {}, null, 2)
    }
  })
  return editor
}
