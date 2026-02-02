from flask import Blueprint, render_template
import re
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from flask import Blueprint, render_template, request, jsonify, current_app
import time
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
    postcheck_pattern = (data.get("postcheckPattern") or "").strip()

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

    max_workers = int(current_app.config.get("MAX_PARALLEL", 10))
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
                    # Optional post-check: verify process started (e.g., after nohup/background)
                    if postcheck_pattern:
                        try:
                            # Small delay to allow process launch
                            time.sleep(1)
                            check = execute_command_on_host(
                                host=ip,
                                port=22,
                                username="user",
                                password="palmedia1",
                                private_key=None,
                                command=f'pgrep -f "{postcheck_pattern}" || true',
                                timeout=timeout,
                            )
                            # Parse PIDs from stdout
                            pids = []
                            if check.get("stdout"):
                                try:
                                    pids = [int(x) for x in check["stdout"].strip().split() if x.isdigit()]
                                except Exception:
                                    pids = []
                            res["postcheck"] = {
                                "started": len(pids) > 0,
                                "pids": pids,
                            }
                            results[ip] = res
                        except Exception:
                            # Ignore postcheck errors
                            pass
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
