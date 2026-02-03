# Remote Command Runner

Flask + Vanilla JS tool to run shell commands across multiple VMs via SSH and show per-host results.

### Run (macOS)
```bash
# 1) Create and activate a virtual environment
python3 -m venv .venv
. .venv/bin/activate

# 2) Install dependencies
pip install -r requirements.txt

# 3) Configure environment (adjust as needed)
export SSH_USERNAME="user"
export SSH_PASSWORD="palmedia1"
export MAX_PARALLEL=30
export PORT=5050

# 4) Start the server
python main.py
# Open http://127.0.0.1:5050
```

### Run (Windows PowerShell)
```powershell
# 1) Create and activate a virtual environment
py -m venv .venv
.\.venv\Scripts\Activate.ps1

# 2) Install dependencies
pip install -r requirements.txt

# 3) Configure environment (adjust as needed)
$env:SSH_USERNAME = "user"
$env:SSH_PASSWORD = "palmedia1"
$env:MAX_PARALLEL = 30
$env:PORT = 5050

# 4) Start the server
python .\main.py
# Open http://127.0.0.1:5050
```

### Run (Windows CMD)
```cmd
:: 1) Create and activate a virtual environment
py -m venv .venv
call .venv\Scripts\activate.bat

:: 2) Install dependencies
pip install -r requirements.txt

:: 3) Configure environment (adjust as needed)
set SSH_USERNAME=user
set SSH_PASSWORD=palmedia1
set MAX_PARALLEL=30
set PORT=5050

:: 4) Start the server
python main.py
:: Open http://127.0.0.1:5050
```

## How it works
- Backend runs commands via SSH using `/bin/bash -lc 'cd "$HOME" && <command>'`.
- Success is based on the remote exit code.
- In async mode (default), the server returns a `jobId` and the UI (or client) can poll `/api/job/<id>` until `completed`.
- In sync mode (opt-in), the server returns a single response with per-IP `stdout`, `stderr`, and `exit_code`.
 - Upload and Copy uses SFTP (`paramiko`) to write files to `/home/<username>/<filename>` and sets permissions to `0644`.
 - Copy From VM: downloads a file from a source VM (provided IP, credentials, and path) to the server, then distributes it to all target hosts concurrently.

## Project Structure
```
script_util/
├─ app/
│  ├─ __init__.py        # Flask app factory + env config
│  ├─ routes.py          # UI + /api/execute (sync/async) + /api/job/<id> + /api/upload-copy
│  │                      # + /api/copy-from-vm (download from source VM and distribute)
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
 - Set `SECRET_KEY` via environment in production.

## FAQ
- Can it ssh into 30 VMs? Yes — set `MAX_PARALLEL=30` (subject to network/host limits).
 - Where do uploads go? To `/home/<SSH_USERNAME>/<filename>` on each host; existing files are overwritten.
 - How do I call sync mode? Send `{"ips": [...], "command": "...", "mode": "sync"}` to `/api/execute`.
