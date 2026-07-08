#!/usr/bin/env bash
# Launch the PersonaPlex live web UI. Extra flags are passed through, e.g.:
#   ./run-server.sh --cpu-offload        # low-VRAM GPUs
#   ./run-server.sh --gradio-tunnel      # shareable public URL
#   ./run-server.sh --port 9000
set -euo pipefail
cd "$(dirname "$0")"

[ -x .venv/bin/python ] || { echo "ERROR: run ./setup.sh first" >&2; exit 1; }
: "${HF_TOKEN:?Set HF_TOKEN to a Hugging Face token (accept the license at https://huggingface.co/nvidia/personaplex-7b-v1 first)}"

SSL_DIR="$(mktemp -d)"
echo "==> Starting server (first run downloads ~7B model weights)..."
echo "==> Open https://localhost:8998 and accept the self-signed cert warning."
exec ./.venv/bin/python -m moshi.server --ssl "$SSL_DIR" "$@"
