# Jev Challenge Lab

> A private, self-hosted workspace for designing structured Jev questions, testing them with context, and keeping a useful record of the answers.

Jev Challenge Lab gives you a friendly visual editor for the [TypeSafe Jev](https://www.typesafe.ai/) API. Build a question from menus or paste JSON, add the situation Jev should consider, review the exact request, and read the returned decision in plain language.

Your API key stays on your server. Your drafts and challenge history stay in your local SQLite database.

## Omarchy plugin

On Omarchy Quattro, the lab is also a native bar plugin. Click **Jev** to open its panel directly in the shell. Choose **Fill menus** or **Paste ready JSON**; imported JSON and examples fill the menus for review. Use **+ Context** to add text, numbers, yes/no values, lists, or nested groups, with vertical guides showing their relationships. Structured situations also open as editable fields. For example, add an `environment` group and a `criticality` field to send `context.environment.criticality` to Jev. Raw JSON remains available under **Advanced JSON**. Large request and response JSON have their own scrollable viewers. Answers appear as plain-language cards with probability bars. A separate **Challenge note** explains the purpose of the challenge for your own reference; it stays with drafts and execution history but is never sent to Jev. All built-in examples include a note. The panel also includes examples (including defensive cybersecurity and DevSecOps reviews), a request preview, drafts, execution history, and API-key settings. You can remove built-in examples from the widget and restore them later. In **API keys**, name and save multiple keys, choose the active one, or delete one; saved values are always masked.

Install it directly from this repository on Omarchy Quattro:

```bash
omarchy plugin add https://github.com/edddine4-source/jev-challenge-lab.git --enable
```

The first click creates a private Python virtual environment in `~/.local/share/jev-challenge-lab/` and installs the exact, hash-verified packages in `requirements.lock`. This requires Python 3 and internet access once. A changed lock creates a fresh environment. The launcher uses `bash`, `curl`, and desktop notifications supplied by Omarchy; it starts a local service on `127.0.0.1:8766` for the widget to call. The app's API key, drafts, history, and service log are kept in `~/.local/state/jev-challenge-lab/`, outside the plugin folder. No administrator privileges are used.

To remove it, use:

```bash
omarchy plugin remove io.github.edddine4-source.jev-challenge-lab
rm -rf ~/.local/share/jev-challenge-lab ~/.local/state/jev-challenge-lab
```

The final `rm` command is optional; it removes your local API key, saved drafts, and challenge history.

## Why use it?

Jev is strongest when a decision is clearly described: the available options, the context that matters, and the kind of answer you need. This app makes that process easier to explore and repeat.

| You want to… | Jev Challenge Lab helps you… |
| --- | --- |
| Explore an idea | Add rich text, lists, numbers, objects, and nested context. |
| Compare possible outcomes | Ask a `choice`, `score`, or `noul` probability question. |
| Work directly with the API | Paste a full JSON request and turn it into editable form fields. |
| Understand a response | See the raw JSON and a readable explanation with probability bars. |
| Iterate over time | Save an unfinished draft or reopen, rename, reuse, and delete completed challenges. |

## Features

- **Visual request builder** — construct typed questions without writing JSON by hand.
- **JSON import and export** — paste a Jev request or context object, inspect the generated payload before sending, and reuse it elsewhere.
- **Shared and nested context** — describe the background situation once, then organize details into groups, lists, and objects.
- **Three decision formats** — `choice` for selecting among options, `score` for evaluating a scale, and `noul` for a yes/no probability.
- **Readable results** — translate the typed response into plain language while preserving the original response JSON.
- **Saved work** — keep complete requests, incomplete drafts, and successful executions in a local SQLite database.
- **Challenge notes** — keep a private explanation of what each challenge is meant to test. Notes stay with drafts and history, but are never sent to Jev.
- **Local credential storage** — name and save multiple API keys, then choose which one Jev uses. Keys stay on the machine running the app; only masked placeholders are sent to the browser.
- **Responsive layout** — results appear below the editor on narrow screens and in their own scrollable panel beside it on larger screens.

## Quick start

### Run with Python

**Requirements:** Python 3.10 or later, and a TypeSafe Jev API key. Docker is optional.

For the quickest local start on Linux or macOS:

```bash
./run-local.sh
```

The script creates a local Python environment, installs the required packages, creates a private `.env` file if needed, and starts the service.

To install each part yourself:

```bash
git clone https://github.com/edddine4-source/jev-challenge-lab.git
cd jev-challenge-lab

python -m venv .venv
.venv/bin/python -m pip install --require-hashes --only-binary=:all: -r requirements.lock
cp .env.example .env

.venv/bin/uvicorn backend.app:app --host 127.0.0.1 --port 8765
```

Open [http://127.0.0.1:8765/](http://127.0.0.1:8765/) in your browser.

Add your key to `.env`:

```dotenv
TYPESAFE_API_KEY=your_typesafe_jev_api_key
```

You can also select **API keys** in the app’s top bar. Name each key and choose the active one. The app saves keys privately in `data/settings.json`, with permissions restricted to its owner. A selected key takes priority over the `.env` value.

On Windows, activate the virtual environment with `.venv\Scripts\activate`, install with `python -m pip install --require-hashes --only-binary=:all: -r requirements.lock`, then start with `python -m uvicorn backend.app:app --host 127.0.0.1 --port 8765`.

### Optional: run with Docker

```bash
git clone https://github.com/edddine4-source/jev-challenge-lab.git
cd jev-challenge-lab

cp .env.example .env
# Add TYPESAFE_API_KEY to .env, then start the service
docker compose up --build
```

Open [http://127.0.0.1:8787/](http://127.0.0.1:8787/). Docker mounts `./data` into the container, so your saved key, drafts, and history remain after a restart.

## How to use the lab

1. **Start with JSON** — choose whether to fill the visual editor or paste an existing Jev JSON request. Pasting JSON fills the menus for you.
2. **Give Jev the situation** — add shared context that applies to the whole request. Use groups to keep larger situations clear.
3. **Add a decision** — choose `choice`, `score`, or `noul`, then describe the question and its options or scale.
4. **Review and challenge Jev** — inspect the generated JSON, then submit it when it reflects the question you mean to ask.
5. **Read and keep the result** — use the plain-language answer for a quick interpretation, or open raw JSON for the complete API response. Save drafts before sending or return to prior executions from **Saved work**.

## Example request

This is the kind of request the visual editor creates. Context describes the situation; `questions` contains the decision Jev should evaluate.

```json
{
  "context": {
    "goal": "Choose a safe observation plan for a home telescope session.",
    "conditions": {
      "cloud_cover_percent": 35,
      "wind_kph": 18,
      "moon_phase": "first quarter"
    }
  },
  "questions": {
    "observation_plan": {
      "type": "choice",
      "question": "Which plan is most likely to produce useful images tonight?",
      "options": [
        "Photograph the Moon with a short exposure",
        "Attempt long-exposure deep-sky imaging",
        "Postpone the session"
      ]
    }
  }
}
```

## Data and privacy

The app is designed for a self-hosted environment.

- Your browser sends requests to this local app; the local app sends the Jev payload to TypeSafe using your server-side API key.
- The API key is never returned by the API and is not stored in browser storage.
- Execution history and drafts are stored in `data/history.db` on the host machine.
- Private local files are excluded from Git by default: `.env`, `data/`, virtual environments, and runtime logs.

If you expose this service beyond your home network, place it behind authentication and HTTPS before entering a key or storing any sensitive context.

## Project layout

```text
backend/        FastAPI application and Jev API proxy
frontend/       Single-page interface, styling, and editor behavior
data/           Local API-key settings, history, and drafts (ignored by Git)
BarWidget.qml   Omarchy Quattro bar entry point
LabPanel.qml    Native Omarchy challenge editor and saved-work panel
LabModel.js     Shared request and draft conversion for the widget
LabExamples.js  Native examples generated from the browser examples
manifest.json   Omarchy plugin metadata
bin/            Local-service launcher used by the Omarchy plugin
compose.yaml    Docker Compose configuration
```

## Development checks

```bash
.venv/bin/python -m py_compile backend/app.py
node --check frontend/app.js
curl http://127.0.0.1:8765/api/health
```

For the Omarchy package, validate a clean plugin checkout with:

```bash
omarchy plugin validate .
```

## License

Released under the [MIT License](LICENSE).
