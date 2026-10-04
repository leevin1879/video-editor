"""Tách giọng hát khỏi bài nhạc bằng AI (Demucs) -> MR (beat) + giọng hát.

Chạy bằng môi trường riêng sep-env (có torch GPU + demucs):
    sep-env\\Scripts\\python.exe separate.py <input> <out_mr.mp3> <out_vocals.mp3> [htdemucs|htdemucs_ft]

In ra stdout các dòng "STATUS ..." và "PROGRESS 0.xx" để server hiển thị tiến trình.
Đọc/ghi âm thanh qua ffmpeg (không phụ thuộc backend I/O của torchaudio).
"""
import shutil
import subprocess
import sys

import numpy as np

FFMPEG = shutil.which("ffmpeg") or "ffmpeg"
NO_WINDOW = 0x08000000 if sys.platform == "win32" else 0


def say(*a):
    print(*a, flush=True)


def load_audio(path, sr):
    r = subprocess.run([FFMPEG, "-v", "error", "-i", path, "-vn", "-map", "0:a:0", "-f", "f32le",
                        "-ac", "2", "-ar", str(sr), "-"], capture_output=True, creationflags=NO_WINDOW)
    if r.returncode != 0 or not r.stdout:
        raise RuntimeError("Không đọc được âm thanh: " + r.stderr.decode("utf-8", "replace")[-400:])
    return np.frombuffer(r.stdout, dtype=np.float32).reshape(-1, 2).T.copy()


def save_mp3(wav, sr, out):
    data = np.ascontiguousarray(np.clip(wav.T, -1.0, 1.0).astype(np.float32)).tobytes()
    r = subprocess.run([FFMPEG, "-y", "-v", "error", "-f", "f32le", "-ar", str(sr), "-ac", "2", "-i", "-",
                        "-c:a", "libmp3lame", "-q:a", "2", out], input=data, capture_output=True,
                       creationflags=NO_WINDOW)
    if r.returncode != 0:
        raise RuntimeError("Không ghi được MP3: " + r.stderr.decode("utf-8", "replace")[-400:])


def main():
    src, out_mr, out_vocals = sys.argv[1:4]
    model_name = sys.argv[4] if len(sys.argv) > 4 else "htdemucs"

    say("STATUS Đang khởi động AI…")
    import torch
    import demucs.apply as dapply
    from demucs.apply import BagOfModels, apply_model
    from demucs.pretrained import get_model

    say("STATUS Đang tải model (lần đầu sẽ tải từ mạng)…")
    model = get_model(model_name)
    model.eval()
    device = "cuda" if torch.cuda.is_available() else "cpu"
    stages = len(model.models) if isinstance(model, BagOfModels) else 1
    say(f"STATUS Đang tách giọng hát ({'GPU' if device == 'cuda' else 'CPU - sẽ chậm hơn'})…")

    # demucs báo tiến trình qua tqdm -> thay bằng bộ đếm in ra stdout (model "ft" gồm nhiều model con)
    state = {"stage": 0}

    class _Progress:
        @staticmethod
        def tqdm(iterable, **_kw):
            items = list(iterable)
            state["stage"] += 1
            n = max(1, len(items))
            for i, x in enumerate(items):
                yield x
                say(f"PROGRESS {min(0.98, (state['stage'] - 1 + (i + 1) / n) / stages):.3f}")

    dapply.tqdm = _Progress

    wav = torch.from_numpy(load_audio(src, model.samplerate))
    ref = wav.mean(0)
    mean, std = ref.mean(), ref.std() + 1e-8
    wav = (wav - mean) / std
    with torch.no_grad():
        sources = apply_model(model, wav[None], device=device, shifts=1, split=True, overlap=0.25,
                              progress=True, num_workers=0)[0]
    sources = sources * std + mean

    names = list(model.sources)
    vi = names.index("vocals")
    vocals = sources[vi]
    mr = sum(sources[i] for i in range(len(names)) if i != vi)

    say("STATUS Đang lưu file MP3…")
    save_mp3(mr.cpu().numpy(), model.samplerate, out_mr)
    save_mp3(vocals.cpu().numpy(), model.samplerate, out_vocals)
    say("PROGRESS 1.000")
    say("STATUS Xong")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # noqa: BLE001
        say(f"ERROR {e}")
        sys.exit(1)
