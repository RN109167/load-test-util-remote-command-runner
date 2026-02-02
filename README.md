# Remote Command Runner (UI Only)

Interactive UI (Vanilla JS + Flask) to collect IPs and commands, show validation, and render a preview table. Backend SSH execution will be added later.

## UI Features
- IP input with strict IPv4 validation.
- Command input; Run button enabled only when IPs are valid and command is non-empty.
- Shortcut Hub above the form:
  - Clean Concentrators → `sh clean.sh`
  - Start Load Injector → `sh start.sh`
  - Stop Load Injector → `sh stop.sh`
  - Restart Load Injector → `sh restart.sh`
- Table-only output (no export, no backend calls yet).

## Requirements
- Python 3.10+

## Setup

```bash
# From the project root
python3 -m venv .venv
. .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

## Run

```bash
PORT=5050 python main.py
```
Open http://localhost:5050

## Project Structure
```
script_util/
├─ app/
│  ├─ __init__.py        # Flask app factory
│  ├─ routes.py          # Serves index.html
│  ├─ templates/         # UI templates
│  │  └─ index.html
│  └─ static/            # Vanilla JS + CSS
│     ├─ app.js
│     └─ styles.css
├─ main.py               # Entrypoint
├─ requirements.txt      # Dependencies
└─ README.md             # Docs
```

## Next Steps
- Add backend API to execute SSH commands over all IPs.
- Stream per-host results (stdout/stderr, exit codes) to the table.
- Add download of results (JSON) once backend is live.
