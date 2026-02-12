# Script Util — Remote Command & File Operations

A simple web app to run shell commands across multiple hosts and perform file operations (upload and copy, copy from VM). Built with Flask (Python) + Vanilla JS. SSH and SFTP are handled via Paramiko.

## User Guide

### Use Cases
- Run a command on many IPs at once.
- Upload a local file and place it on target hosts.
- Copy a file from a source VM and distribute it to target hosts.
- Use the Shortcut Hub to trigger common actions (service start/stop/restart, etc.).

### Requirements (Users)
- A modern web browser.
- Access to the app URL on the VM where this tool is hosted (e.g., http://<vm-host>:5050). No local installation is needed.
- Valid SSH credentials (username and password) for the target hosts.
- Network connectivity from the app VM to the target hosts on the SSH port (default 22).

### Prerequisites on Target VMs
- Shell scripts expected by Shortcut Hub:
  - Unload scripts in home directory: `~/start-unload.sh`, `~/stop-unload.sh`.
  - nConnect Mock scripts in home directory: `~/start-nconnectmock.sh`, `~/stop-nconnectmock.sh`.
  - Ensure each is executable (`chmod +x`), and paths match the Shortcut Hub labels.
- Systemd service names must exist for service shortcuts:
  - `onelink-concentrator`, `onelink-appserver`, `onelink-nconnect`, `mysqld`.
  - Verify with `systemctl status <service>` on each VM.
- Sudo availability and password:
  - The app invokes `sudo` for directory creation, file moves, ownership and permissions.
  - The SSH user must have `sudo` access; consider `NOPASSWD` policies for production.
- Owner/Group existence:
  - If you specify `owner`/`group` in file operations, those must exist on each target VM (validated via `id -u` and `getent group`).
  - Leave empty to default to the SSH username.
- Temporary directory access:
  - `/tmp` must be writable on each VM; uploads are staged to `/tmp` before `sudo mv` into the destination.
- PATH and shell:
  - Commands run via `/bin/bash -lc` with `cd "$HOME"` to mimic interactive environments.

### Using the App
- Open the app URL in your browser (e.g., http://<vm-host>:5050).
- Enter target IPs (one per line) and a command, or use the Shortcut Hub.
- File Operations:
  - Destination Directory: optional; defaults to `/home/<ssh-username>` when left empty.
  - Owner / Group: optional; if left empty, ownership defaults to the SSH username; if provided, both must exist on each target host.
  - Overwrite: files are moved with `mv -f`, so existing files at the destination will be replaced.
  - Permissions: files are set to `rw-rw-r--` (`chmod 0664`).
- Busy indicator shows while operations run; results table updates per host.
 - Review per-host results in the table; failed hosts will show errors.

### Common Errors & Fixes
- Invalid IP format: correct the IPs (IPv4 only).
- Owner/Group not found on a host: that host is marked as failed; add the user/group on the host or leave fields empty to use defaults.
- Permission denied: the app always uploads to `/tmp` and uses `sudo` to create the destination folder and move the file into place.
- Network issues: ensure SSH connectivity and firewall rules permit access.

## For Developers

### Developer Setup
- Python 3 installed on your development machine.
- Recommended: use a virtual environment and install dependencies locally.
- Start the app on the hosting VM and expose the HTTP port to users.

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
  pip install -r requirements.txt
  ```
- Run:
  ```bash
  # Ensure required environment variables are set (see Configuration)
  python main.py
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

Need enhancements or docs updates? Contributions welcome. Keep changes small and focused to avoid impacting functionality.
