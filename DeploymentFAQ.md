# Load Test Util - Deployment & Operations Guide

A concise guide to deploy, run, and operate the app with Flask, Gunicorn, Nginx, and systemd. It preserves the original operational model while improving readability.

## High-Level Architecture

Components:
- **Flask:** Application logic, UI, APIs
- **Gunicorn:** Runs Flask safely with workers/threads
- **Nginx:** Reverse proxy, HTTPS, serves static files
- **systemd:** Starts app, manages crashes, logs

Flow:
```
Browser (User)
   ↓ HTTP (80 / 443)
Nginx (Web Server / Reverse Proxy)
   ↓ HTTP (localhost)
Gunicorn (Python WSGI Server)
   ↓ Python calls
Flask App (this project)
   ↓
SSH / Job Manager / Business Logic
```

## Project Directory
Target path:
```
/opt/script_util/load-test-util-remote-command-runner
```
Structure:
```
load-test-util-remote-command-runner/
├─ app/
├─ main.py
├─ requirements.txt
├─ venv/
```

## Production App Target
- Use `app:create_app()` as the Gunicorn target.
- `main.py` is only for dev/testing.
- Do NOT use `main:app` in production.

## Deployment Steps

### 4.1 Virtual Environment
```bash
cd /opt/script_util/load-test-util-remote-command-runner
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
pip install gunicorn
```

### 4.2 Test Gunicorn
```bash
gunicorn -w 1 -b 127.0.0.1:8000 "app:create_app()"
curl http://127.0.0.1:8000
```
- If the above works, the app is healthy.

### 4.3 systemd Service
Create or edit service file:
```bash
sudo nano /etc/systemd/system/script_util.service
```
Content:
```
[Unit]
Description=Load Test Util OpsRunner
After=network.target

[Service]
User=user
Group=www-data
WorkingDirectory=/opt/script_util/load-test-util-remote-command-runner
Environment="PATH=/opt/script_util/load-test-util-remote-command-runner/venv/bin"
ExecStart=/opt/script_util/load-test-util-remote-command-runner/venv/bin/gunicorn \
    -w 1 \
    --threads 4 \
    -b 127.0.0.1:8000 \
    "app:create_app()"
Restart=always

[Install]
WantedBy=multi-user.target
```
Enable and start:
```bash
sudo systemctl daemon-reexec
sudo systemctl daemon-reload
sudo systemctl enable script_util
sudo systemctl start script_util
```

### 4.4 Nginx Configuration
Create site config:
```bash
sudo nano /etc/nginx/sites-available/script_util
```
Content:
```
server {
    listen 80;
    server_name _;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```
Enable and reload:
```bash
sudo ln -s /etc/nginx/sites-available/script_util /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl restart nginx
```

### 4.5 Access App
Open in browser:
```
http://<VM-IP>/
```
- Gunicorn port `8000` is internal only; external access is via Nginx.

## Logs
- Gunicorn / App:
```bash
journalctl -u script_util -f
journalctl -u script_util -n 50
```
- Nginx:
```bash
sudo tail -f /var/log/nginx/error.log
sudo tail -f /var/log/nginx/access.log
```

## Troubleshooting
| Issue | Command / Fix |
|---|---|
| App not loading | `systemctl status script_util` / `ss -tulpn` |
| ModuleNotFoundError | `source venv/bin/activate` then `pip install -r requirements.txt` |
| ImportError / app not found | Use `"app:create_app()"` in ExecStart |
| Port 8000 not accessible externally | Normal; use Nginx on port 80 |

## Operational Commands
```bash
sudo systemctl restart script_util  # restart app
sudo systemctl stop script_util     # stop app
sudo systemctl reload nginx         # reload Nginx
ss -tulpn                           # check listening ports
```

## Notes
- In-memory job manager → must use `-w 1 --threads 4`.
- Flask dev server is never used in production.
- `www-data` group allows Nginx + Gunicorn permission compatibility.
- Configure host key management and SSL for production.

## Architecture (ASCII Diagram)
```
          +-----------------+
          |   Browser/User  |
          +-----------------+
                    |
                    v  HTTP (80/443)
          +-----------------+
          |      Nginx      |
          | (Reverse Proxy) |
          +-----------------+
                    |
                    v  HTTP (localhost:8000)
          +-----------------+
          |    Gunicorn     |
          | (WSGI Server)   |
          +-----------------+
                    |
                    v  Python calls
          +-----------------+
          |      Flask      |
          |  (App Factory)  |
          +-----------------+
                    |
                    v
          +-----------------+
          | Job Manager /   |
          | SSH Executor    |
          +-----------------+
```
