# Script Util — Remote Command & File Operations

A simple web app to run shell commands across multiple hosts and perform file operations (upload and copy, copy from VM). Built with Flask (Python) + Vanilla JS. SSH and SFTP are handled via Paramiko.

## For Users

### What You Can Do
- Run a command on many IPs at once.
- Upload a local file and place it on target hosts.
- Copy a file from a source VM and distribute it to target hosts.
- Use the Shortcut Hub to trigger common actions (service start/stop/restart, etc.).

### Requirements
- Python 3 installed on your machine.
- Target hosts must:
  - Allow SSH connections.
  - Support `sudo` with the provided password.
  - Have the specified `owner` and `group` (if you choose to override ownership).

### Quick Start
1. Create a virtual environment (recommended) and install dependencies:
   ```bash
   python3 -m venv .venv
   . .venv/bin/activate
   pip install Flask Paramiko
   ```
2. Run the app:
   ```bash
   PORT=5050 "$PWD"/.venv/bin/python main.py
   ```
3. Open the app in your browser: http://localhost:5050

### Using the App
- Enter target IPs (one per line) and a command, or use the Shortcut Hub.
- File Operations:
  - Destination Directory: optional; defaults to `/home/<ssh-username>` when left empty.
  - Owner / Group: optional; if left empty, ownership defaults to the SSH username; if provided, both must exist on each target host.
  - Overwrite: files are moved with `mv -f`, so existing files at the destination will be replaced.
  - Permissions: files are set to `rw-rw-r--` (`chmod 0664`).
- Busy indicator shows while operations run; results table updates per host.

### Common Errors & Fixes
- Invalid IP format: correct the IPs (IPv4 only).
- Owner/Group not found on a host: that host is marked as failed; add the user/group on the host or leave fields empty to use defaults.
- Permission denied: the app always uploads to `/tmp` and uses `sudo` to create the destination folder and move the file into place.
- Network issues: ensure SSH connectivity and firewall rules permit access.

## For Developers

### Project Structure
- `main.py`: App entrypoint and Flask setup.
- `app/routes.py`: Flask routes for command execution, job polling, and file operations.
- `app/templates/index.html`: UI layout (Jinja/HTML) with modals for file operations.
- `app/static/app.js`: UI logic (Shortcut Hub, validation, modals, job polling, results rendering).
- `app/static/styles.css`: Dark theme styling, button hierarchy, busy indicator.
- `app/ssh_executor.py`: SSH command runner utility (used by routes).
- `app/job_manager.py`: In-memory job tracking for async execution.
- `instance/uploads/`: Temporary storage for uploaded/downloaded files on the server.

### Key Behaviors
- Command execution:
  - Sync: immediate results returned.
  - Async: job created and polled via `/api/job/<id>`.
- File operations:
  - Upload to `/tmp` on each target, then `sudo mkdir -p <destDir>`, `sudo mv -f <tmp> <dest>`, `sudo chown <owner>:<group> <dest>`, `sudo chmod 0664 <dest>`.
  - Owner/Group: optional inputs; default to SSH username when empty; validation checks `id -u` and `getent group` per host.

### API Endpoints
- `POST /api/execute` — Run a command across IPs; returns sync results or a job id.
- `GET /api/job/<jobId>` — Poll job status/results.
- `POST /api/upload-copy` — Multipart form: upload a file and copy to targets.
- `POST /api/copy-from-vm` — JSON: fetch from source VM and distribute to targets.

### Configuration (Environment Variables)
- `PORT` — HTTP port (default often 5000; we use 5050 in dev).
- `SSH_USERNAME` — Username for target hosts (default: `user`).
- `SSH_PASSWORD` — Password for target hosts (used for SSH and `sudo`).
- `SSH_DEFAULT_PORT` — SSH port (default: `22`).
- `SSH_TIMEOUT_SECONDS` — SSH/SFTP timeout (default: `30`).
- `MAX_PARALLEL` — Max concurrent operations (default: `30`).
- `MAX_CONTENT_LENGTH` — Max upload size.

### Development
- Install deps in a virtualenv:
  ```bash
  python3 -m venv .venv
  . .venv/bin/activate
  pip install Flask Paramiko
  ```
- Run:
  ```bash
  PORT=5050 "$PWD"/.venv/bin/python main.py
  ```
- Frontend changes live-reload on refresh; backend changes require restart.

### Security Notes
- `sudo` is invoked via `echo <password> | sudo -S ...`. Use caution and consider host-level policies (NOPASSWD) in production.
- SSH host key verification and key-based auth can be added for stricter security.
- Overwrite behavior (`mv -f`) will replace existing files — ensure this is acceptable.

### Troubleshooting
- Check terminal output for stack traces if the app fails to start.
- Confirm environment variables are set and reachable.
- Validate target host reachability (`ssh user@host`).

---

Need enhancements or docs updates? Contributions welcome. Keep changes small and focused to avoid impacting functionality.# Remote Command Runner

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

## FAQ
- Can it ssh into 30 VMs? Yes — set `MAX_PARALLEL=30` (subject to network/host limits).
 - Where do uploads go? To `/home/<SSH_USERNAME>/<filename>` on each host; existing files are overwritten.
 - How do I call sync mode? Send `{"ips": [...], "command": "...", "mode": "sync"}` to `/api/execute`.
