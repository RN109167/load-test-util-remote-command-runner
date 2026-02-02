import os
from app import create_app


def main():
	app = create_app()
	# Use host 0.0.0.0 for VM deployment; port configurable via env var
	port = int(os.environ.get("PORT", "5000"))
	app.run(host="0.0.0.0", port=port, debug=False)


if __name__ == "__main__":
	main()