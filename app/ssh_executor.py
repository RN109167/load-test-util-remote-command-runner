import paramiko
import socket
import io
from typing import Optional


def execute_command_on_host(
    host: str,
    port: int,
    username: str,
    password: Optional[str],
    private_key: Optional[str],
    command: str,
    timeout: int,
):
    client = paramiko.SSHClient()
    # WARNING: In production, manage known hosts securely
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())

    pkey = None
    if private_key:
        # Attempt RSA, then fallback to Ed25519 or ECDSA if needed
        key_io = io.StringIO(private_key)
        try:
            pkey = paramiko.RSAKey.from_private_key(key_io)
        except Exception:
            key_io.seek(0)
            try:
                pkey = paramiko.Ed25519Key.from_private_key(key_io)
            except Exception:
                key_io.seek(0)
                pkey = paramiko.ECDSAKey.from_private_key(key_io)

    try:
        client.connect(
            hostname=host,
            port=port,
            username=username,
            password=password,
            pkey=pkey,
            timeout=timeout,
        )

        stdin, stdout, stderr = client.exec_command(command, timeout=timeout)
        out = stdout.read().decode("utf-8", errors="replace")
        err = stderr.read().decode("utf-8", errors="replace")
        exit_status = stdout.channel.recv_exit_status()
        return {
            "ok": True,
            "stdout": out,
            "stderr": err,
            "exit_code": exit_status,
        }
    except (paramiko.SSHException, socket.error) as e:
        raise RuntimeError(f"SSH error: {e}")
    finally:
        try:
            client.close()
        except Exception:
            pass
