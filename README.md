# Remote Command Runner

Flask + Vanilla JS tool to run shell commands across multiple VMs via SSH and show per-host results.

## Features
- Strict IPv4 input validation; clear error messages for invalid IPs.
- Command input with a `Run` button that enables only when inputs are valid.
- Shortcut Hub buttons:
  - Clean Concentrators → `sh clean.sh`
  - Start Load Injector → `sh start.sh`
  - Stop Load Injector → `sh stop.sh`
  - Restart Load Injector → `sh restart.sh`
- Immediate results mode (default): executes across all IPs and returns stdout, stderr, and exit codes without polling.
- Optional async mode (fallback): creates a job and exposes `/api/job/<id>` for polling.

## Requirements
- Python 3.10+
- `Flask`, `paramiko` (see `requirements.txt`)

## Configuration
The app is configured via environment variables (no credentials in the UI):

- `SSH_USERNAME` (default: `user`)
- `SSH_PASSWORD` (default: `palmedia1`)
- `SSH_DEFAULT_PORT` (default: `22`)
- `SSH_TIMEOUT_SECONDS` (default: `20`)
- `MAX_PARALLEL` (default: `10`) — set to `30` to ssh into 30 VMs concurrently
- `PORT` (default: `5000`) — web server port

Example:
```bash
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt

SSH_USERNAME="user" \
SSH_PASSWORD="palmedia1" \
MAX_PARALLEL=30 \
PORT=5050 \
.venv/bin/python main.py
```
Open http://127.0.0.1:5050

## How it works
- Backend runs commands via SSH using `/bin/bash -lc 'cd "$HOME" && <command>'`.
- Success is based on the remote exit code.
- In sync mode, the server returns a single response with per-IP `stdout`, `stderr`, and `exit_code`.
- In async mode, the server returns a `jobId` and the UI (or client) can poll `/api/job/<id>` until `completed`.

## Notes on scripts and logging
- The utility does not add redirection; your scripts control logging.
- For background tasks, ensure your script captures both streams, e.g.:
  - Truncate then log: `> Output.log 2>&1`
  - Append and log: `>> Output.log 2>&1`
  - Optionally detach stdin: `< /dev/null` when using `nohup ... &`

## Project Structure
```
script_util/
├─ app/
│  ├─ __init__.py        # Flask app factory + env config
│  ├─ routes.py          # UI + /api/execute (sync + async) + /api/job/<id>
│  ├─ job_manager.py     # In-memory jobs for async mode
│  ├─ ssh_executor.py    # Paramiko-based remote exec
│  ├─ templates/
│  │  └─ index.html      # UI
│  └─ static/
│     ├─ app.js          # Validation, sync requests, table rendering
│     └─ styles.css
├─ main.py               # Entrypoint
├─ requirements.txt      # Dependencies
└─ README.md             # Docs
```

## Security & Production
- Known hosts: currently accepts unknown host keys automatically; configure host key management for production.
- Use a production WSGI server behind a reverse proxy (gunicorn/waitress + nginx) for deployment.

## FAQ
- Can it ssh into 30 VMs? Yes — set `MAX_PARALLEL=30` (subject to network/host limits).
