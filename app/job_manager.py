import time
from typing import Dict, List


class JobManager:
    def __init__(self):
        self.jobs: Dict[str, Dict] = {}

    def create_job(self, job_id: str, ips: List[str], command: str):
        self.jobs[job_id] = {
            "jobId": job_id,
            "createdAt": time.time(),
            "command": command,
            "ips": ips,
            "statuses": {ip: "pending" for ip in ips},
            "results": {},
            "completed": False,
        }

    def update_status(self, job_id: str, ip: str, status: str):
        job = self.jobs.get(job_id)
        if job and ip in job["statuses"]:
            job["statuses"][ip] = status

    def store_result(self, job_id: str, ip: str, result: Dict):
        job = self.jobs.get(job_id)
        if job:
            job["results"][ip] = result

    def finalize_job(self, job_id: str):
        job = self.jobs.get(job_id)
        if job:
            job["completed"] = True
            job["completedAt"] = time.time()

    def get_job(self, job_id: str):
        return self.jobs.get(job_id)
