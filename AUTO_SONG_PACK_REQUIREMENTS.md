# Auto Song Pack - System Requirements

## External Tools Required

| Tool | Install | Purpose |
|------|---------|---------|
| **Python 3.9+** | `brew install python` / `apt install python3` | Runs Demucs & basic-pitch |
| **ffmpeg** | `brew install ffmpeg` / `apt install ffmpeg` | Audio processing, duration probe |
| **yt-dlp** | `pip install yt-dlp` | YouTube audio download |
| **demucs** | `pip install demucs` | Vocal/instrumental separation |
| **basic-pitch** | `pip install basic-pitch` | Audio → MIDI (Spotify) |

## Quick Install (macOS)

```bash
brew install python ffmpeg
pip install -r requirements.txt
```

## Quick Install (Ubuntu/Debian)

```bash
sudo apt update && sudo apt install python3 python3-pip ffmpeg
pip3 install -r requirements.txt
```

## Docker (Alternative)

```dockerfile
# Add to Dockerfile if you want auto-song-pack in container
RUN apt-get update && apt-get install -y python3 python3-pip ffmpeg \
    && pip3 install demucs basic-pitch yt-dlp
```

## Verify Installation

```bash
# Test each component
yt-dlp --version
demucs --help
basic-pitch --help
ffprobe -version
python3 -c "import demucs, basic_pitch, yt_dlp; print('OK')"
```

## GPU Acceleration (Optional)

For faster Demucs separation:

```bash
# NVIDIA CUDA
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu118

# Apple Silicon (MPS) - works automatically with PyTorch 2.0+
```

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `demucs: command not found` | Add `~/.local/bin` to PATH or use `python -m demucs` |
| `basic-pitch: command not found` | Same as above |
| `torch not compiled with CUDA` | Reinstall PyTorch with CUDA support |
| `Out of memory` | Use `--device cpu` or reduce batch size |
| `yt-dlp fails` | Update: `pip install -U yt-dlp` |