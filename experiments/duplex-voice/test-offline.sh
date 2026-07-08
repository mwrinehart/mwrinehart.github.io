#!/usr/bin/env bash
# No-microphone smoke test: streams a bundled test conversation through the
# model and writes the agent's reply audio + transcript to out/.
# Extra flags pass through, e.g.:
#   ./test-offline.sh --cpu-offload     # low-VRAM GPUs
#   ./test-offline.sh --device cpu      # no GPU (slow, needs CPU PyTorch)
set -euo pipefail
cd "$(dirname "$0")"

[ -x .venv/bin/python ] || { echo "ERROR: run ./setup.sh first" >&2; exit 1; }
: "${HF_TOKEN:?Set HF_TOKEN to a Hugging Face token (accept the license at https://huggingface.co/nvidia/personaplex-7b-v1 first)}"

mkdir -p out
./.venv/bin/python -m moshi.offline \
  --voice-prompt "NATF2.pt" \
  --input-wav "personaplex/assets/test/input_assistant.wav" \
  --seed 42424242 \
  --output-wav "out/assistant_reply.wav" \
  --output-text "out/assistant_reply.json" \
  "$@"

echo
echo "Done. Listen to out/assistant_reply.wav and read out/assistant_reply.json"
