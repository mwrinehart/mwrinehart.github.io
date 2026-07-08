# Duplex Voice Model — PersonaPlex Setup Kit

Run [NVIDIA PersonaPlex](https://github.com/NVIDIA/personaplex), an open-weights,
real-time, **full-duplex** speech-to-speech model (it listens and speaks
simultaneously — interruptions, backchannels, natural turn-taking), entirely on
your own hardware. No API costs: the code is MIT-licensed and the weights are
under the NVIDIA Open Model License. PersonaPlex is a fine-tune of
[Kyutai Moshi](https://github.com/kyutai-labs/moshi), so anything that works
with Moshi's ecosystem (including `moshi-finetune`) applies here too.

The persona is controlled with a plain-text role prompt and the voice with a
pre-packaged voice embedding — so for most use cases **no fine-tuning is
required at all**.

## Hardware requirements

- **Comfortable**: NVIDIA GPU with ~16GB+ VRAM (RTX 4080/3090/4090, A10, etc.)
- **Tight**: smaller GPUs work with `--cpu-offload` (layers spill to system RAM;
  slower but functional)
- **No GPU**: offline (file-in/file-out) mode runs on pure CPU with CPU-only
  PyTorch — fine for evaluating quality, not for live conversation
- Python ≥ 3.10, `git`, and the Opus codec headers (`libopus-dev`)

## Quickstart

```bash
# 1. One-time setup: clones PersonaPlex, creates a venv, installs everything
./setup.sh

# 2. Accept the model license (one time) at:
#    https://huggingface.co/nvidia/personaplex-7b-v1
#    then create a token at https://huggingface.co/settings/tokens
export HF_TOKEN=hf_...

# 3. Launch the live web UI (downloads ~7B weights on first run)
./run-server.sh                 # then open https://localhost:8998
./run-server.sh --cpu-offload   # if you hit CUDA out-of-memory
```

The server prints the URL to open (it uses a temporary self-signed cert, so
your browser will warn — proceed past it). Add `--gradio-tunnel` to get a
shareable public URL, or `--port`/`--host` to change where it listens.

### Smoke test without a microphone

`test-offline.sh` streams a bundled test WAV through the model and writes the
agent's audio + transcript to `out/`:

```bash
./test-offline.sh                        # GPU
./test-offline.sh --cpu-offload          # low VRAM
./test-offline.sh --device cpu           # no GPU at all (slow)
```

## Controlling the persona

Set the role with a text prompt in the web UI. Prompting styles the model was
trained on:

- **Assistant** (default): `You are a wise and friendly teacher. Answer
  questions or provide advice in a clear and engaging way.`
- **Customer service**: `You work for <business> which is a <type> and your
  name is <name>. Information: <facts the agent may use>.`
- **Casual conversation**: `You enjoy having a good conversation.` — optionally
  followed by a topic and a persona backstory.

It also responds plausibly to out-of-distribution prompts (the repo's demo
prompt is a panicking astronaut), so experiment freely.

## Choosing a voice

16+ voice embeddings ship with the weights, selectable in the UI or via
`--voice-prompt` in offline mode:

```
Natural female: NATF0–NATF3      Natural male: NATM0–NATM3
Variety female: VARF0–VARF4      Variety male: VARM0–VARM4
```

## Troubleshooting

- **`pip install` fails building `sphn`** — install the Opus headers first:
  `sudo apt install libopus-dev` (Debian/Ubuntu) or `sudo dnf install
  opus-devel` (Fedora/RHEL).
- **401/gated-repo error downloading weights** — you haven't accepted the
  license on the [model page](https://huggingface.co/nvidia/personaplex-7b-v1)
  or `HF_TOKEN` isn't set in the shell running the server.
- **CUDA out of memory** — add `--cpu-offload` (installed by `setup.sh` via the
  `accelerate` package).
- **RTX 50-series (Blackwell) GPU** — reinstall PyTorch with CUDA 13 wheels
  after setup: `pip install torch torchvision torchaudio --index-url
  https://download.pytorch.org/whl/cu130`
  ([upstream issue](https://github.com/NVIDIA/personaplex/issues/2)).

## Going further: fine-tuning

If role-prompting isn't enough (domain vocabulary, a specific speaking style,
another language), the path is Kyutai's official
[moshi-finetune](https://github.com/kyutai-labs/moshi-finetune) repo, which
supports LoRA. You'll need stereo conversational WAVs (left channel = agent,
right = user) with timestamped transcripts, and realistically a rented
A100/H100 for the training run (~$2–3/hr spot pricing) — a 24GB card works for
small experiments with reduced `batch_size`/`duration_sec`.
