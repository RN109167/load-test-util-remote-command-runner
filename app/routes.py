from flask import Blueprint, render_template, request, jsonify, current_app
import re
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
import os
import paramiko
from .job_manager import JobManager
from .ssh_executor import execute_command_on_host

bp = Blueprint("routes", __name__)

job_manager = JobManager()

@bp.route("/")
def index():
    return render_template("index.html")


def _valid_ipv4(ip: str) -> bool:
    parts = ip.split(".")
    if len(parts) != 4:
        return False
    for p in parts:
        if not re.match(r"^\d{1,3}$", p):
            return False
        n = int(p)
        if n < 0 or n > 255:
            return False
    return True


@bp.route("/api/execute", methods=["POST"])
def api_execute():
    data = request.get_json(silent=True) or {}
    ips = data.get("ips") or []
    command = (data.get("command") or "").strip()
    mode = data.get("mode") or data.get("sync")

    # Validation
    errors = []
    if not ips or not isinstance(ips, list):
        errors.append("Provide a list of IP addresses.")
    else:
        invalid = [ip for ip in ips if not _valid_ipv4(ip)]
        if invalid:
            errors.append(f"Invalid IPv4: {', '.join(invalid)}")
    if not command:
        errors.append("Command is required.")
    if errors:
        return jsonify({"ok": False, "errors": errors}), 400

    max_workers = int(current_app.config.get("MAX_PARALLEL", 30))
    timeout = int(current_app.config.get("SSH_TIMEOUT_SECONDS", 20))
    username = current_app.config.get("SSH_USERNAME", "user")
    password = current_app.config.get("SSH_PASSWORD", "palmedia1")
    port = int(current_app.config.get("SSH_DEFAULT_PORT", 22))

    # Synchronous mode: execute and return results immediately (no polling)
    if mode in (True, "sync", "SYNC", "immediate"):
        results = {}
        statuses = {}
        with ThreadPoolExecutor(max_workers=max_workers) as ex:
            future_map = {ex.submit(
                execute_command_on_host,
                host=ip,
                port=port,
                username=username,
                password=password,
                private_key=None,
                command=command,
                timeout=timeout,
            ): ip for ip in ips}
            for fut in as_completed(future_map):
                ip = future_map[fut]
                try:
                    res = fut.result()
                    results[ip] = res
                    statuses[ip] = "completed" if res.get("ok") else "failed"
                except Exception as e:
                    results[ip] = {
                        "ok": False,
                        "error": str(e),
                        "stdout": "",
                        "stderr": "",
                        "exit_code": None,
                    }
                    statuses[ip] = "failed"
        return jsonify({
            "ok": True,
            "completed": True,
            "results": results,
            "statuses": statuses,
        })

    # Async/background mode: create a job and poll
    job_id = str(uuid.uuid4())
    job_manager.create_job(job_id, ips, command)

    def run_for_ip(ip):
        job_manager.update_status(job_id, ip, "running")
        try:
            result = execute_command_on_host(
                host=ip,
                port=port,
                username=username,
                password=password,
                private_key=None,
                command=command,
                timeout=timeout,
            )
            job_manager.store_result(job_id, ip, result)
            job_manager.update_status(job_id, ip, "completed" if result.get("ok") else "failed")
        except Exception as e:
            job_manager.store_result(job_id, ip, {
                "ok": False,
                "error": str(e),
                "stdout": "",
                "stderr": "",
                "exit_code": None,
            })
            job_manager.update_status(job_id, ip, "failed")

    executor = ThreadPoolExecutor(max_workers=max_workers)

    def supervisor():
        futures = [executor.submit(run_for_ip, ip) for ip in ips]
        for _ in as_completed(futures):
            pass
        job_manager.finalize_job(job_id)
        executor.shutdown(wait=False)

    executor.submit(supervisor)

    return jsonify({"ok": True, "jobId": job_id})


@bp.route("/api/job/<job_id>")
def api_job(job_id):
    job = job_manager.get_job(job_id)
    if not job:
        return jsonify({"ok": False, "error": "Job not found"}), 404
    # For table display, optionally truncate outputs
    truncated = {}
    for ip, res in job.get("results", {}).items():
        if not res:
            continue
        t = dict(res)
        for k in ("stdout", "stderr"):
            if isinstance(t.get(k), str):
                s = t[k]
                t[k] = s[:2000]  # 2KB for UI
        truncated[ip] = t
    job_view = dict(job)
    job_view["results"] = truncated
    return jsonify({"ok": True, "job": job_view})


@bp.route("/api/upload-copy", methods=["POST"])
def api_upload_copy():
    # Expect multipart/form-data with 'file' and 'ips' (JSON array or delimited string)
    if "file" not in request.files:
        return jsonify({"ok": False, "error": "No file uploaded"}), 400
    file = request.files["file"]
    ips_raw = (request.form.get("ips") or "").strip()

    # Parse IPs from JSON or split by newline/comma/space
    ips = []
    if ips_raw:
        try:
            import json
            parsed = json.loads(ips_raw)
            if isinstance(parsed, list):
                ips = [str(x).strip() for x in parsed if str(x).strip()]
        except Exception:
            ips = [s.strip() for s in re.split(r"\n|\r|,|\s+", ips_raw) if s.strip()]

    if not ips:
        return jsonify({"ok": False, "error": "Provide IP addresses"}), 400
    invalid = [ip for ip in ips if not _valid_ipv4(ip)]
    if invalid:
        return jsonify({"ok": False, "error": f"Invalid IPv4: {', '.join(invalid)}"}), 400

    # Save uploaded file to instance/uploads
    uploads_root = os.path.join(current_app.instance_path, "uploads")
    os.makedirs(uploads_root, exist_ok=True)
    filename = file.filename or "uploaded_file"
    tmp_path = os.path.join(uploads_root, filename)
    file.save(tmp_path)

    username = current_app.config.get("SSH_USERNAME", "user")
    password = current_app.config.get("SSH_PASSWORD", "palmedia1")
    port = int(current_app.config.get("SSH_DEFAULT_PORT", 22))
    max_workers = int(current_app.config.get("MAX_PARALLEL", 30))
    # Optional destination directory
    dest_dir = (request.form.get("destDir") or "").strip()
    if not dest_dir:
        dest_dir = f"/home/{username}"

    results = {}
    statuses = {}

    def sftp_copy(ip):
        try:
            transport = paramiko.Transport((ip, port))
            transport.connect(username=username, password=password)
            sftp = paramiko.SFTPClient.from_transport(transport)
            try:
                # Destination path
                dest = f"{dest_dir.rstrip('/')}/{filename}"
                sftp.put(tmp_path, dest)
                # Set permissions to 0644
                try:
                    sftp.chmod(dest, 0o644)
                except Exception:
                    pass
                statuses[ip] = "completed"
                results[ip] = {"ok": True, "dest": dest}
            finally:
                try:
                    sftp.close()
                except Exception:
                    pass
                try:
                    transport.close()
                except Exception:
                    pass
        except Exception as e:
            statuses[ip] = "failed"
            results[ip] = {"ok": False, "error": str(e)}

    with ThreadPoolExecutor(max_workers=max_workers) as ex:
        futmap = {ex.submit(sftp_copy, ip): ip for ip in ips}
        for _ in as_completed(futmap):
            pass

    # Cleanup temp file
    try:
        os.remove(tmp_path)
    except Exception:
        pass

    return jsonify({
        "ok": True,
        "completed": True,
        "results": results,
        "statuses": statuses,
        "filename": filename,
    })


@bp.route("/api/copy-from-vm", methods=["POST"])
def api_copy_from_vm():
    data = request.get_json(silent=True) or {}
    ips = data.get("ips") or []
    source = data.get("source") or {}
    dest_dir = (data.get("destDir") or "").strip()

    # Validate targets
    if not ips or not isinstance(ips, list):
        return jsonify({"ok": False, "error": "Provide target IP addresses"}), 400
    invalid = [ip for ip in ips if not _valid_ipv4(ip)]
    if invalid:
        return jsonify({"ok": False, "error": f"Invalid IPv4: {', '.join(invalid)}"}), 400

    # Validate source
    src_ip = (source.get("ip") or "").strip()
    src_user = (source.get("username") or "").strip()
    src_pass = (source.get("password") or "").strip()
    src_port = int(source.get("port") or current_app.config.get("SSH_DEFAULT_PORT", 22))
    src_path = (source.get("path") or "").strip()

    if not _valid_ipv4(src_ip):
        return jsonify({"ok": False, "error": "Invalid source IP"}), 400
    if not src_user or not src_pass or not src_path:
        return jsonify({"ok": False, "error": "Source username, password, and path are required"}), 400

    # Prepare temp download location
    uploads_root = os.path.join(current_app.instance_path, "uploads")
    os.makedirs(uploads_root, exist_ok=True)
    basename = os.path.basename(src_path) or "source_file"
    tmp_path = os.path.join(uploads_root, f"tmp-{uuid.uuid4()}-{basename}")

    # Download from source VM
    try:
        transport = paramiko.Transport((src_ip, src_port))
        transport.connect(username=src_user, password=src_pass)
        sftp = paramiko.SFTPClient.from_transport(transport)
        try:
            sftp.get(src_path, tmp_path)
        finally:
            try:
                sftp.close()
            except Exception:
                pass
            try:
                transport.close()
            except Exception:
                pass
    except Exception as e:
        # Clean up temp if any
        try:
            if os.path.exists(tmp_path):
                os.remove(tmp_path)
        except Exception:
            pass
        return jsonify({"ok": False, "error": f"Download from source failed: {e}"}), 500

    # Upload to target hosts
    username = current_app.config.get("SSH_USERNAME", "user")
    password = current_app.config.get("SSH_PASSWORD", "palmedia1")
    port = int(current_app.config.get("SSH_DEFAULT_PORT", 22))
    max_workers = int(current_app.config.get("MAX_PARALLEL", 30))
    if not dest_dir:
        dest_dir = f"/home/{username}"

    results = {}
    statuses = {}

    def sftp_put(ip):
        try:
            transport = paramiko.Transport((ip, port))
            transport.connect(username=username, password=password)
            sftp = paramiko.SFTPClient.from_transport(transport)
            try:
                dest = f"{dest_dir.rstrip('/')}/{basename}"
                sftp.put(tmp_path, dest)
                try:
                    sftp.chmod(dest, 0o644)
                except Exception:
                    pass
                statuses[ip] = "completed"
                results[ip] = {"ok": True, "dest": dest}
            finally:
                try:
                    sftp.close()
                except Exception:
                    pass
                try:
                    transport.close()
                except Exception:
                    pass
        except Exception as e:
            statuses[ip] = "failed"
            results[ip] = {"ok": False, "error": str(e)}

    with ThreadPoolExecutor(max_workers=max_workers) as ex:
        futmap = {ex.submit(sftp_put, ip): ip for ip in ips}
        for _ in as_completed(futmap):
            pass

    # Cleanup temp file
    try:
        os.remove(tmp_path)
    except Exception:
        pass

    return jsonify({
        "ok": True,
        "completed": True,
        "results": results,
        "statuses": statuses,
        "filename": basename,
    })
