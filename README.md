# Jev Challenge Lab

A self-hosted web interface for building, reviewing, and sending typed requests to the TypeSafe Jev API.

## What it does

- Builds `choice`, `score`, and `noul` (yes/no probability) questions with visual menus.
- Adds shared context as text, numbers, booleans, lists, objects, and nested groups.
- Imports a complete Jev request or a context-only JSON object into the visual editor.
- Shows the exact JSON before it is sent.
- Sends the request through the local server, keeping the API key out of the browser.
- Lets the user add or replace the API key from the connection panel. The server saves it privately for future sessions and never returns it to the browser.
- Translates Jev's typed JSON response into plain language and probability bars.
- Saves every successful execution to a local SQLite history with its request, response, timestamp, model, and decision count.
- Reopens saved requests and answers, and supports renaming, deleting, and reusing them.
- Saves complete requests before they are sent, as well as incomplete work-in-progress drafts. Reopen either from **History** and continue editing later.

## Run locally

```bash
cd outputs/feedpilot
python -m uvicorn backend.app:app --host 127.0.0.1 --port 8765
```

Open `http://127.0.0.1:8765/`.

Store the TypeSafe key in `.env`:

```dotenv
TYPESAFE_API_KEY=your_key_here
```

You can also select **Add key** or **Change key** under the Jev connection status. Keys saved from the interface are stored in the ignored `data/settings.json` file with owner-only permissions and take precedence over `.env`.

Saved executions and drafts are stored in the ignored `data/history.db` SQLite database. Select **History** in the top bar to open, reuse, rename, delete, or continue saved work. A draft is marked **Complete request** when the current form can be sent to Jev; otherwise it is marked **Incomplete draft** and keeps every field exactly as entered.

## Docker

```bash
docker compose up --build
```

Open `http://127.0.0.1:8787/`.

Docker mounts the local `data` directory so saved keys and challenge history remain available after the container restarts.
