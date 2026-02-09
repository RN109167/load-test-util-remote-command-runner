# Ports & Multi-App Setup FAQ

A clear, preview-friendly guide to ports, external access, and running multiple apps on the same VM with Gunicorn + Nginx.

## 1️⃣ Is your app running on any port?
From systemd status:
```
Listening at: http://127.0.0.1:8000
```
✅ Gunicorn is listening on `127.0.0.1:8000` — internal only. It’s not accessible externally because `127.0.0.1` is loopback. Only Nginx (on the same VM) can forward to it.

Check:
```bash
ss -tulpn | grep 8000
```
Expected:
```
LISTEN 0 128 127.0.0.1:8000 0.0.0.0:* users:(("gunicorn",pid=708711,fd=4))
```

## 2️⃣ What if you want to run another application?
If another app wants port `8000`, it cannot use it.

Options:
- Use a different internal port (e.g., `8001`):
```bash
gunicorn -w 1 -b 127.0.0.1:8001 "other_app:create_app()"
```
- Use Nginx to proxy different paths to each app:
```
http://vm-ip/app1 → 127.0.0.1:8000
http://vm-ip/app2 → 127.0.0.1:8001
```

## 3️⃣ Why isn’t it running on “any port” externally?
Gunicorn is bound to `127.0.0.1:8000` (loopback, internal only). Nginx exposes port 80 externally and proxies to Gunicorn.
- External access: `http://<VM-IP>/`
- You won’t see Gunicorn directly on `:8000` from outside the VM.

## 4️⃣ How to run it on a particular port?
**Option A — Direct Gunicorn binding (testing):**
```bash
gunicorn -w 1 -b 0.0.0.0:5050 "app:create_app()"
```
- `0.0.0.0` → listen on all interfaces.
- Access: `http://<VM-IP>:5050/`
- ⚠️ Not recommended for production.

**Option B — Keep Gunicorn on localhost; change Nginx external port:**
Nginx site:
```
server {
    listen 8080;   # external port
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
Reload Nginx:
```bash
sudo nginx -t
sudo systemctl restart nginx
```
Access: `http://<VM-IP>:8080/`

## ✅ Summary
| Question | Answer |
|---|---|
| Is app running? | Yes — internally on `127.0.0.1:8000` |
| Run another app? | Yes — bind to a different port (e.g., `8001`) |
| Why not on “any port”? | Gunicorn binds to localhost for security |
| Run on a specific port? | Use `-b 0.0.0.0:<port>` or change Nginx `listen` |

---

## Multi-App Deployment on One VM
Run multiple Flask apps safely with distinct internal ports, proxied by Nginx.

Assume:
- App 1: `OpsRunner` → internal `8000`
- App 2: `other-flask-app` → internal `8001`

### 1️⃣ Gunicorn / systemd Setup
App 1 — existing service `/etc/systemd/system/script_util.service`:
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
    -w 1 --threads 4 -b 127.0.0.1:8000 "app:create_app()"
Restart=always

[Install]
WantedBy=multi-user.target
```
Enable & start:
```bash
sudo systemctl daemon-reload
sudo systemctl enable script_util
sudo systemctl start script_util
```

App 2 — new service `/etc/systemd/system/other_app.service`:
```
[Unit]
Description=Other Flask App
After=network.target

[Service]
User=user
Group=www-data
WorkingDirectory=/opt/other-flask-app
Environment="PATH=/opt/other-flask-app/venv/bin"
ExecStart=/opt/other-flask-app/venv/bin/gunicorn \
    -w 1 --threads 4 -b 127.0.0.1:8001 "app:create_app()"
Restart=always

[Install]
WantedBy=multi-user.target
```
Enable & start:
```bash
sudo systemctl daemon-reload
sudo systemctl enable other_app
sudo systemctl start other_app
```

### 2️⃣ Nginx Configuration
Expose each app via different paths or ports.

**Option A — Different paths:**
File `/etc/nginx/sites-available/multi_app`:
```
server {
    listen 80;
    server_name _;

    location /app1/ {
        proxy_pass http://127.0.0.1:8000/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /app2/ {
        proxy_pass http://127.0.0.1:8001/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```
Enable & restart Nginx:
```bash
sudo ln -s /etc/nginx/sites-available/multi_app /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```
Access:
```
http://<VM-IP>/app1/ → App 1
http://<VM-IP>/app2/ → App 2
```

**Option B — Different external ports:**
```
server {
    listen 8080;
    server_name _;
    location / {
        proxy_pass http://127.0.0.1:8000;
    }
}

server {
    listen 8081;
    server_name _;
    location / {
        proxy_pass http://127.0.0.1:8001;
    }
}
```
Access:
```
http://<VM-IP>:8080 → App 1
http://<VM-IP>:8081 → App 2
```

### 3️⃣ Troubleshooting Multi-App Setup
| Problem | Check / Fix |
|---|---|
| App not accessible | `systemctl status <service>` / `ss -tulpn` |
| Port conflict | Ensure unique Gunicorn ports (`8000`, `8001`, …) |
| Nginx misconfigured | `sudo nginx -t` then `sudo systemctl restart nginx` |
| Logs | `journalctl -u <service> -f` |

### ✅ Summary
- Each Flask app runs internally on its own port via Gunicorn.
- Nginx routes external requests to the correct internal port.
- Use different paths or external ports. Keep Gunicorn on `127.0.0.1` in production.
