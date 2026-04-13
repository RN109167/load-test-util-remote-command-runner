# Script Util — Remote Command & File Operations

A web app to run shell commands across multiple hosts, perform file operations (upload and copy, copy from VM), and configure NTP time synchronisation. Built with Flask (Python) + Vanilla JS. SSH and SFTP are handled via Paramiko. Supports both RHEL and Debian-based hosts.

## User Guide

### Use Cases
- Run a command on many IPs at once.
- Upload a local file and place it on target hosts.
- Copy a file from a source VM and distribute it to target hosts.
- Use the Shortcut Hub to trigger common actions (service start/stop/restart, etc.).
- Configure NTP time synchronisation: set up an NTP server and sync client VMs to it.

### Requirements (Users)
- A modern web browser.
- Access to the app URL on the VM where this tool is hosted (e.g., `http://<vm-host>:5050`). No local installation is needed.
- Valid SSH credentials (username and password) for the target hosts.
- Network connectivity from the app VM to the target hosts on the SSH port (default 22).
- Note: Default credentials are centrally stored for Onelink VMs on the server. If the credentials change on the hosts, operations will fail until the server configuration (`SSH_USERNAME`/`SSH_PASSWORD`) is updated and the app is restarted.

### Prerequisites on Target VMs
- Shell scripts expected by Shortcut Hub:
  - Unload scripts in home directory: `~/start-unload.sh`, `~/stop-unload.sh`.
  - nConnect Mock scripts in home directory: `~/start-nconnectmock.sh`, `~/stop-nconnectmock.sh`.
  - Ensure each is executable (`chmod +x`), and paths match the Shortcut Hub labels.
- Systemd service names must exist for service shortcuts:
  - `onelink-concentrator`, `onelink-appserver`, `onelink-nconnect`.
  - MySQL: automatically uses `mysqld` on RHEL or `mysql` on Debian (OS auto-detected).
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

### IP Entry Modes
The app supports two modes for entering target IPs, toggled via the **Quick Entry** / **Per-IP Credentials** buttons:

- **Quick Entry** (default): Enter IPs in a textarea (one per line, comma-separated, or space-separated). All hosts use the server's default credentials.
- **Per-IP Credentials**: Add individual IP rows with optional username and password fields per host. Hosts without credentials filled in will fall back to the server's default credentials.

### Loading IPs from a File
Click **Load IPs from File** to import targets from a local file:
- **TXT**: Plain list of IPs (one per line).
- **CSV**: Columns `ip`, `username`, `password`. The `username` and `password` columns are optional — if present, per-IP credentials are loaded automatically and the UI switches to Per-IP Credentials mode.

### Using the App
- Open the app URL in your browser (e.g., `http://<vm-host>:5050`).
- Enter target IPs and a command, or use the Shortcut Hub.
- File Operations:
  - Destination Directory: optional; defaults to `/home/<ssh-username>` when left empty.
  - Owner / Group: optional; if left empty, ownership defaults to the SSH username; if provided, both must exist on each target host.
  - Permissions: optional; defaults to `0664` (`rw-rw-r--`). Enter a standard octal value (e.g. `755`, `0644`).
  - Overwrite: files are moved with `mv -f`, so existing files at the destination will be replaced.
- Busy indicator shows while operations run; results table updates per host.
- Review per-host results in the table; failed hosts will show errors (including authentication failures).
- The command input is cleared automatically only when **all** hosts complete successfully.

### NTP Time Synchronisation
The **NTP Time Sync** shortcut configures chrony-based NTP across your VMs:

1. Click **NTP Time Sync** → **Configure NTP** in the Shortcut Hub.
2. Enter the NTP server IP and its SSH credentials.
3. Client VMs are taken from the **IP Addresses** input on the main page.
4. Click **Check & Configure** — the app runs pre-flight checks before making changes.

**Pre-flight checks:**
- Detects OS (RHEL vs Debian) and NTP daemon (chrony vs ntpd) on each host.
- Warns if the NTP server IP is also listed as a client (auto-skipped).
- Warns if any client is already configured as an NTP server — offers to reconfigure it as a client.
- Warns if any client already syncs to a different NTP source.
- Warns about unreachable hosts.
- If warnings are found, a dialog is shown with **Cancel** / **Proceed Anyway**.

**What it configures:**
- **Server**: Installs chrony if not present, configures as a standalone local stratum 10 clock (`local stratum 10`, `allow all`), opens firewall (firewalld on RHEL, ufw on Debian), restarts and enables the service.
- **Clients**: Installs chrony if not present, removes existing server/pool directives, adds `server <ntp-server-ip> iburst`, restarts and enables the service.
- Config files are backed up before modification (timestamped `.bak`).
- Verification output (`chronyc tracking` / `chronyc sources`) is shown in the results table.

### Common Errors & Fixes
- **Invalid IP format**: correct the IPs (IPv4 only).
- **Authentication failed**: check username/password for the failing host. Use Per-IP Credentials mode if some hosts have different credentials.
- **Owner/Group not found**: that host is marked as failed; add the user/group on the host or leave fields empty to use defaults.
- **Permission denied**: the app always uploads to `/tmp` and uses `sudo` to create the destination folder and move the file into place.
- **Network issues**: ensure SSH connectivity and firewall rules permit access.

## For Developers

### Developer Setup
- Python 3 installed on your development machine.
- Recommended: use a virtual environment and install dependencies locally.
- Start the app on the hosting VM and expose the HTTP port to users.

### Project Structure
- `main.py` — App entrypoint and Flask setup.
- `app/routes.py` — Flask routes for command execution, job polling, and file operations.
- `app/templates/index.html` — UI layout (Jinja/HTML) with modals for file operations.
- `app/static/app.js` — UI logic (Shortcut Hub, validation, modals, job polling, results rendering).
- `app/static/styles.css` — Dark theme styling, button hierarchy, busy indicator.
- `app/ssh_executor.py` — SSH command runner utility (used by routes).
- `app/job_manager.py` — In-memory job tracking for async execution.
- `instance/uploads/` — Temporary storage for uploaded/downloaded files on the server.

### Key Behaviors
- Command execution:
  - Sync: immediate results returned.
  - Async: job created and polled via `/api/job/<id>`.
  - Up to 30 hosts executed in parallel (configurable via `MAX_PARALLEL`).
- Per-IP credentials:
  - All three API endpoints (`/api/execute`, `/api/upload-copy`, `/api/copy-from-vm`) accept an optional `ip_credentials` map: `{ "ip": { "username": "...", "password": "..." } }`.
  - If credentials are provided for a host, they override the server defaults; otherwise the defaults are used.
- File operations:
  - Upload to `/tmp` on each target, then `sudo mkdir -p <destDir>`, `sudo mv -f <tmp> <dest>`, `sudo chown <owner>:<group> <dest>`, `sudo chmod <permissions> <dest>`.
  - Owner/Group: optional inputs; default to SSH username when empty; validation checks `id -u` and `getent group` per host.
  - Permissions: optional; defaults to `0664`; validated as a 3-4 digit octal value.
- Error handling:
  - Authentication failures (`paramiko.AuthenticationException`) are caught with a descriptive message per host.
  - SSH/network errors are reported per host in the results table.

### API Endpoints
- `POST /api/execute` — Run a command across IPs; returns sync results or a job id. Accepts optional `ip_credentials`.
- `GET /api/job/<jobId>` — Poll job status/results.
- `POST /api/upload-copy` — Multipart form: upload a file and copy to targets. Accepts optional `ip_credentials` (JSON string in form data).
- `POST /api/copy-from-vm` — JSON: fetch from source VM and distribute to targets. Accepts optional `ip_credentials`.
- `POST /api/ntp-preflight` — Pre-flight checks for NTP setup: detects OS, NTP daemon, existing server configs, and returns warnings.
- `POST /api/ntp-configure` — Configure NTP server and clients (chrony/ntpd, RHEL/Debian auto-detected).

### Configuration (Environment Variables)
- `PORT` — HTTP port (default: `5050`).
- `SSH_USERNAME` — Default username for target hosts (default: `user`).
- `SSH_PASSWORD` — Default password for target hosts (used for SSH and `sudo`).
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
  python main.py
  ```
- Frontend changes live-reload on refresh; backend changes require restart.

### Security Notes
- `sudo` is invoked via `echo <password> | sudo -S ...`. Use caution and consider host-level policies (NOPASSWD) in production.
- SSH host key verification and key-based auth can be added for stricter security.
- Overwrite behavior (`mv -f`) will replace existing files — ensure this is acceptable.
- Per-IP credentials are transmitted over the local network; use HTTPS in production if credentials differ across hosts.

### Troubleshooting
- Check terminal output for stack traces if the app fails to start.
- Confirm environment variables are set and reachable.
- Validate target host reachability (`ssh user@host`).
- If authentication errors appear, verify credentials are correct or switch to Per-IP Credentials mode.

---

Contributions welcome. Keep changes small and focused to avoid impacting functionality.
