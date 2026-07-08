#!/usr/bin/env bash
# One-time setup for PersonaPlex: clones the repo, creates a Python venv,
# and installs the model package. Safe to re-run.
set -euo pipefail
cd "$(dirname "$0")"

PYTHON="${PYTHON:-python3}"
REPO_URL="https://github.com/NVIDIA/personaplex"

command -v git >/dev/null 2>&1 || { echo "ERROR: git is required" >&2; exit 1; }
command -v "$PYTHON" >/dev/null 2>&1 || { echo "ERROR: python3 not found (set PYTHON=...)" >&2; exit 1; }

if ! "$PYTHON" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)'; then
  echo "ERROR: Python >= 3.10 required, found: $("$PYTHON" --version 2>&1)" >&2
  exit 1
fi

# Opus codec headers are needed to build the sphn audio dependency.
if command -v pkg-config >/dev/null 2>&1 && ! pkg-config --exists opus 2>/dev/null; then
  echo "WARNING: Opus development headers not detected." >&2
  echo "  Debian/Ubuntu: sudo apt install libopus-dev" >&2
  echo "  Fedora/RHEL:   sudo dnf install opus-devel" >&2
  echo "Continuing — pip install will fail if they are truly missing." >&2
fi

if [ ! -d personaplex/.git ]; then
  echo "==> Cloning PersonaPlex..."
  git clone --depth 1 "$REPO_URL" personaplex
else
  echo "==> personaplex/ already cloned, skipping"
fi

if [ ! -d .venv ]; then
  echo "==> Creating virtualenv..."
  "$PYTHON" -m venv .venv
fi

echo "==> Installing PersonaPlex (this pulls PyTorch — may take a while)..."
./.venv/bin/pip install --upgrade pip
./.venv/bin/pip install ./personaplex/moshi
# accelerate enables --cpu-offload for GPUs with insufficient VRAM
./.venv/bin/pip install accelerate

cat <<'EOF'

Setup complete. Next steps:

  1. Accept the model license (one time, free):
       https://huggingface.co/nvidia/personaplex-7b-v1
  2. Create a Hugging Face token and export it:
       export HF_TOKEN=hf_...
  3. Launch the live web UI:
       ./run-server.sh            (add --cpu-offload if low on VRAM)
     or run the no-microphone smoke test:
       ./test-offline.sh

Note for RTX 50-series (Blackwell) GPUs — reinstall PyTorch with CUDA 13:
  ./.venv/bin/pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu130
EOF
