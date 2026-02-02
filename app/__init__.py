import os
from flask import Flask


def create_app():
    app = Flask(__name__, static_folder="static", template_folder="templates")
    app.config.from_mapping(
        SECRET_KEY=os.environ.get("SECRET_KEY", "change-me"),
        JOB_CLEANUP_SECONDS=int(os.environ.get("JOB_CLEANUP_SECONDS", "3600")),
        SSH_DEFAULT_PORT=int(os.environ.get("SSH_DEFAULT_PORT", "22")),
        SSH_TIMEOUT_SECONDS=int(os.environ.get("SSH_TIMEOUT_SECONDS", "20")),
        MAX_PARALLEL=int(os.environ.get("MAX_PARALLEL", "30")),
        SSH_USERNAME=os.environ.get("SSH_USERNAME", "user"),
        SSH_PASSWORD=os.environ.get("SSH_PASSWORD", "palmedia1"),
    )

    # Register routes
    from .routes import bp as routes_bp

    app.register_blueprint(routes_bp)

    return app
