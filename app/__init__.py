import os
from flask import Flask


def create_app():
    app = Flask(__name__, static_folder="static", template_folder="templates")
    app.config.from_mapping(
        JOB_CLEANUP_SECONDS=int(os.environ.get("JOB_CLEANUP_SECONDS", "3600")),
        SSH_DEFAULT_PORT=int(os.environ.get("SSH_DEFAULT_PORT", "22")),
        SSH_TIMEOUT_SECONDS=int(os.environ.get("SSH_TIMEOUT_SECONDS", "30")),
        MAX_PARALLEL=int(os.environ.get("MAX_PARALLEL", "30")),
        SSH_USERNAME=os.environ.get("SSH_USERNAME", "user"),
        SSH_PASSWORD=os.environ.get("SSH_PASSWORD", "palmedia1"),
        # 2GB upload limit; adjust via env if needed
        MAX_CONTENT_LENGTH=int(os.environ.get("MAX_CONTENT_LENGTH", str(2 * 1024 * 1024 * 1024))),
    )

    # Ensure instance/uploads exists for temporary file storage
    uploads_root = os.path.join(app.instance_path, "uploads")
    try:
        os.makedirs(uploads_root, exist_ok=True)
    except Exception:
        pass

    # Register routes
    from .routes import bp as routes_bp

    app.register_blueprint(routes_bp)

    return app
