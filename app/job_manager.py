import time
import threading
from typing import Dict, List


class JobManager:
    def __init__(self):
        self.jobs: Dict[str, Dict] = {}
        self._lock = threading.Lock()

    def create_job(self, job_id: str, ips: List[str], command: str):
        with self._lock:
            self.jobs[job_id] = {
                "jobId": job_id,
                "createdAt": time.time(),
                "command": command,
                "ips": ips,
                "statuses": {ip: "queued" for ip in ips},
                "results": {},
                "completed": False,
            }

    def update_status(self, job_id: str, ip: str, status: str):
        with self._lock:
            job = self.jobs.get(job_id)
            if job and ip in job["statuses"]:
                job["statuses"][ip] = status

    def store_result(self, job_id: str, ip: str, result: Dict):
        with self._lock:
            job = self.jobs.get(job_id)
            if job:
                job["results"][ip] = result

    def finalize_job(self, job_id: str):
        with self._lock:
            job = self.jobs.get(job_id)
            if job:
                job["completed"] = True
                job["completedAt"] = time.time()

    def get_job(self, job_id: str):
        with self._lock:
            job = self.jobs.get(job_id)
            # Return a shallow copy to avoid race conditions in callers
            return dict(job) if job else None
