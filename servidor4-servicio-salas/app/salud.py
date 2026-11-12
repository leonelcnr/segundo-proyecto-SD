import json
import os
import sys
import time

try:
    with open(os.environ.get("SALUD_ARCHIVO", "/tmp/salud.json")) as f:
        d = json.load(f)
    sys.exit(0 if d.get("conectado") and time.time() - d.get("ts", 0) < 30 else 1)
except (OSError, ValueError):
    sys.exit(1)
