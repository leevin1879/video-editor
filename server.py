"""Video Editor - backend local (chỉ dùng thư viện chuẩn Python + ffmpeg).

Chạy:  python server.py   rồi mở http://127.0.0.1:8765
"""
import base64
import json
import math
import os
import re
import shutil
import subprocess
import sys
import threading
import time
import uuid
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import quote, unquote, urlparse

HOST, PORT = "127.0.0.1", int(os.environ.get("VEDIT_PORT", "8765"))
ROOT = os.path.dirname(os.path.abspath(__file__))
STATIC = os.path.join(ROOT, "static")
WS = os.path.join(ROOT, "workspace")
MEDIA = os.path.join(WS, "media")
THUMBS = os.path.join(WS, "thumbs")
EXPORTS = os.path.join(WS, "exports")
PROJECTS = os.path.join(WS, "projects")
TMP = os.path.join(WS, "tmp")
for d in (MEDIA, THUMBS, EXPORTS, PROJECTS, TMP):
    os.makedirs(d, exist_ok=True)

FFMPEG = shutil.which("ffmpeg") or "ffmpeg"
FFPROBE = shutil.which("ffprobe") or "ffprobe"
# Môi trường riêng cho tách giọng hát (torch GPU + demucs), tạo bằng setup_mr.bat
SEP_PY = os.path.join(ROOT, "sep-env", "Scripts", "python.exe")
SEP_SCRIPT = os.path.join(ROOT, "separate.py")
SEP_MODELS = {"fast": "htdemucs", "best": "htdemucs_ft"}
NO_WINDOW = 0x08000000 if os.name == "nt" else 0  # không bật cửa sổ console khi gọi ffmpeg

IMAGE_EXT = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}
MIME = {
    ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
    ".mp4": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm", ".mkv": "video/x-matroska",
    ".m4v": "video/mp4", ".avi": "video/x-msvideo",
    ".mp3": "audio/mpeg", ".wav": "audio/wav", ".m4a": "audio/mp4", ".aac": "audio/aac",
    ".ogg": "audio/ogg", ".flac": "audio/flac",
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp",
    ".bmp": "image/bmp", ".svg": "image/svg+xml", ".ico": "image/x-icon",
}

JOBS = {}
JOBS_LOCK = threading.Lock()


# ----------------------------------------------------------------- helpers
def safe_name(name, default="file"):
    name = re.sub(r'[\\/:*?"<>|\x00-\x1f]', "_", name).strip(" .")
    return name[:120] or default


def inside(base, path):
    base = os.path.realpath(base)
    path = os.path.realpath(path)
    return os.path.commonpath([base, path]) == base


def run(cmd, **kw):
    return subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8",
                          errors="replace", creationflags=NO_WINDOW, **kw)


def probe(path):
    out = run([FFPROBE, "-v", "error", "-print_format", "json", "-show_format", "-show_streams", path])
    try:
        info = json.loads(out.stdout or "{}")
    except json.JSONDecodeError:
        info = {}
    streams = info.get("streams", [])
    ext = os.path.splitext(path)[1].lower()
    v = next((s for s in streams if s.get("codec_type") == "video"
              and not s.get("disposition", {}).get("attached_pic")), None)
    a = next((s for s in streams if s.get("codec_type") == "audio"), None)
    dur = float(info.get("format", {}).get("duration") or 0)
    if ext in IMAGE_EXT:
        kind = "image"
    elif v:
        kind = "video"
    elif a:
        kind = "audio"
    else:
        raise ValueError("File không phải video/âm thanh/ảnh hợp lệ")
    w = int(v.get("width", 0)) if v else 0
    h = int(v.get("height", 0)) if v else 0
    if v:  # video quay dọc trên điện thoại có metadata xoay -> đảo kích thước
        rot = v.get("tags", {}).get("rotate")
        for sd in v.get("side_data_list", []) or []:
            if "rotation" in sd:
                rot = sd["rotation"]
        if rot is not None and abs(int(float(rot))) % 180 == 90:
            w, h = h, w
    if kind == "image":
        dur = 0
    return {"type": kind, "duration": round(dur, 3), "width": w, "height": h, "hasAudio": bool(a)}


def make_thumb(src, dst, kind, dur):
    if kind == "audio":
        return False
    ss = min(1.0, dur / 2) if kind == "video" else 0
    r = run([FFMPEG, "-y", "-v", "error", "-ss", f"{ss:.2f}", "-i", src, "-frames:v", "1",
             "-vf", "scale=240:-2", dst])
    return r.returncode == 0 and os.path.exists(dst)


def media_path(m):
    f = os.path.basename(str(m.get("file", "")))
    p = os.path.join(MEDIA, f)
    if not f or not os.path.isfile(p):
        raise ValueError(f"Thiếu file media: {m.get('name') or f}")
    return p


def atempo_chain(speed):
    parts = []
    while speed > 2.0:
        parts.append("atempo=2.0")
        speed /= 2.0
    while speed < 0.5:
        parts.append("atempo=0.5")
        speed /= 0.5
    parts.append(f"atempo={speed:.5f}")
    return parts


def num(d, k, default, lo=None, hi=None):
    try:
        v = float(d.get(k, default))
    except (TypeError, ValueError):
        v = float(default)
    if lo is not None:
        v = max(lo, v)
    if hi is not None:
        v = min(hi, v)
    return v


AFMT = "aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo"
SPEED_MIN, SPEED_MAX = 0.1, 10.0


def clip_timing(c, src, is_image=False):
    """Các đoạn tốc độ [(a, b, s)] tính từ điểm in (giây nguồn) + tổng thời lượng trên timeline.
    Clip có đường cong tốc độ: frontend gửi sẵn c["segs"] (cùng công thức với preview)."""
    if is_image:
        return [[0.0, src, 1.0]], src
    segs = []
    raw = c.get("segs")
    if isinstance(raw, list):
        for it in raw[:400]:
            try:
                a, b, sp = float(it[0]), float(it[1]), float(it[2])
            except (TypeError, ValueError, IndexError):
                continue
            a, b = max(0.0, min(src, a)), max(0.0, min(src, b))
            if b - a > 1e-4:
                segs.append([a, b, max(SPEED_MIN, min(SPEED_MAX, sp))])
    if not segs:
        segs = [[0.0, src, num(c, "speed", 1, SPEED_MIN, SPEED_MAX)]]
    merged = []
    for a, b, sp in segs:  # gộp các đoạn liền nhau cùng tốc độ
        if merged and abs(merged[-1][2] - sp) < 1e-4 and abs(merged[-1][1] - a) < 1e-4:
            merged[-1][1] = b
        else:
            merged.append([a, b, sp])
    return merged, sum((b - a) / sp for a, b, sp in merged)


def video_speed_filters(segs):
    """Đổi tốc độ hình: 1 tốc độ -> setpts chia; nhiều đoạn -> setpts theo hàm tuyến tính từng khúc của T."""
    if len(segs) == 1:
        return [f"setpts=(PTS-STARTPTS)/{segs[0][2]:.6f}"]
    pieces, t0 = [], 0.0
    for a, b, sp in segs:
        pieces.append((b, f"{t0:.6f}+(T-{a:.6f})/{sp:.6f}"))
        t0 += (b - a) / sp
    expr = pieces[-1][1]
    for b, e in reversed(pieces[:-1]):
        expr = f"if(lt(T\\,{b:.6f})\\,{e}\\,{expr})"
    return ["setpts=PTS-STARTPTS", f"setpts=({expr})/TB"]


def fps_filter(c, segs, fps):
    """Slow motion mượt khi xuất: blend = trộn khung (nhanh), flow = nội suy chuyển động (rất mượt, chậm)."""
    slow = min(sp for _a, _b, sp in segs) < 0.999
    mode = c.get("smooth")
    if slow and mode == "flow":
        return f"minterpolate=fps={fps}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1"
    if slow and mode == "blend":
        return f"framerate=fps={fps}"
    return f"fps={fps}"


def audio_speed_graph(inl, outl, segs, keep_pitch, tag):
    """Đổi tốc độ tiếng; giữ cao độ = atempo, không giữ = asetrate (giọng trầm/cao theo tốc độ)."""
    def chain(sp):
        if abs(sp - 1) < 1e-3:
            return []
        if keep_pitch:
            return atempo_chain(sp)
        return ["aresample=48000", f"asetrate={48000 * sp:.3f}", "aresample=48000"]

    if len(segs) == 1:
        return [f"[{inl}]{','.join(['asetpts=PTS-STARTPTS'] + chain(segs[0][2]))}[{outl}]"]
    n = len(segs)
    out = [f"[{inl}]asetpts=PTS-STARTPTS,asplit={n}" + "".join(f"[{tag}i{k}]" for k in range(n))]
    for k, (a, b, sp) in enumerate(segs):
        ch = [f"atrim=start={a:.6f}:end={b:.6f}", "asetpts=PTS-STARTPTS", AFMT] + chain(sp)
        out.append(f"[{tag}i{k}]{','.join(ch)}[{tag}o{k}]")
    out.append("".join(f"[{tag}o{k}]" for k in range(n)) + f"concat=n={n}:v=0:a=1[{outl}]")
    return out


def build_job(project, overlay_files, out_path, script_path):
    """Dựng lệnh ffmpeg + filter_complex từ JSON dự án. Trả về (cmd, total_seconds)."""
    W = int(num(project, "width", 1920, 16, 4096)) // 2 * 2
    H = int(num(project, "height", 1080, 16, 4096)) // 2 * 2
    FPS = int(num(project, "fps", 30, 1, 60))
    media = {m["id"]: m for m in project.get("media", [])}
    tracks = project.get("tracks", {})
    args = [FFMPEG, "-y", "-hide_banner"]
    filters = []
    idx = 0
    main_total = 0.0
    segs = []

    for n, c in enumerate(tracks.get("main", [])):
        m = media.get(c.get("mediaId"))
        if not m:
            raise ValueError("Clip tham chiếu media không tồn tại")
        path = media_path(m)
        cin, cout = num(c, "in", 0, 0), num(c, "out", 0, 0)
        src = cout - cin
        if src <= 0.03:
            continue
        if m["type"] == "image":
            args += ["-loop", "1", "-framerate", str(FPS), "-t", f"{src:.3f}", "-i", path]
        else:
            args += ["-ss", f"{cin:.3f}", "-t", f"{src:.3f}", "-i", path]
        tsegs, dur = clip_timing(c, src, m["type"] == "image")
        vf = video_speed_filters(tsegs)
        if c.get("fit") == "cover":
            vf += [f"scale={W}:{H}:force_original_aspect_ratio=increase", f"crop={W}:{H}"]
        else:
            vf += [f"scale={W}:{H}:force_original_aspect_ratio=decrease",
                   f"pad={W}:{H}:(ow-iw)/2:(oh-ih)/2:color=black"]
        vf += ["setsar=1", fps_filter(c, tsegs, FPS), "format=yuv420p"]
        if c.get("hidden"):  # track Video chính bị ẩn: giữ thời lượng + tiếng, hình đen
            vf.append("drawbox=c=black:t=fill")
        b, ct, s = num(c, "brightness", 0, -100, 100), num(c, "contrast", 0, -100, 100), num(c, "saturation", 0, -100, 100)
        if b or ct or s:
            vf.append(f"eq=brightness={b / 100 * 0.25:.4f}:contrast={1 + ct / 100:.4f}:saturation={1 + s / 100:.4f}")
        fi, fo = num(c, "fadeIn", 0, 0, dur / 2), num(c, "fadeOut", 0, 0, dur / 2)
        if fi > 0:
            vf.append(f"fade=t=in:st=0:d={fi:.3f}")
        if fo > 0:
            vf.append(f"fade=t=out:st={dur - fo:.3f}:d={fo:.3f}")
        vf += [f"trim=duration={dur:.3f}", "setpts=PTS-STARTPTS"]
        filters.append(f"[{idx}:v:0]{','.join(vf)}[v{n}]")

        vol = num(c, "volume", 1, 0, 4)
        if m["type"] == "video" and m.get("hasAudio"):
            filters.extend(audio_speed_graph(f"{idx}:a:0", f"ms{n}", tsegs, c.get("keepPitch") is not False, f"m{n}"))
            af = [f"volume={vol:.3f}", AFMT]
            if fi > 0:
                af.append(f"afade=t=in:st=0:d={fi:.3f}")
            if fo > 0:
                af.append(f"afade=t=out:st={dur - fo:.3f}:d={fo:.3f}")
            af += ["apad", f"atrim=duration={dur:.3f}", "asetpts=PTS-STARTPTS"]
            filters.append(f"[ms{n}]{','.join(af)}[a{n}]")
        else:
            filters.append(f"anullsrc=r=48000:cl=stereo,atrim=duration={dur:.3f},{AFMT}[a{n}]")
        segs.append(n)
        main_total += dur
        idx += 1

    text_end = max([num(t, "start", 0, 0) + num(t, "duration", 0, 0) for t in tracks.get("text", [])] or [0])
    audio_end = 0.0
    for a in tracks.get("audio", []):
        audio_end = max(audio_end, num(a, "start", 0, 0) + clip_timing(a, max(0.0, num(a, "out", 0) - num(a, "in", 0)))[1])
    ov_end = 0.0
    for c in tracks.get("overlay", []):
        m = media.get(c.get("mediaId")) or {}
        osrc = max(0.0, num(c, "out", 0) - num(c, "in", 0))
        ov_end = max(ov_end, num(c, "start", 0, 0) + clip_timing(c, osrc, m.get("type") == "image")[1])
    total = max(main_total, text_end, audio_end, ov_end)
    if total <= 0.05:
        raise ValueError("Timeline đang trống")

    if segs:
        filters.append("".join(f"[v{n}][a{n}]" for n in segs) + f"concat=n={len(segs)}:v=1:a=1[vcat][acat]")
        if total - main_total > 0.02:
            filters.append(f"[vcat]tpad=stop_duration={total - main_total:.3f}:color=black[vbase]")
            vlabel = "vbase"
        else:
            vlabel = "vcat"
    else:
        filters.append(f"color=c=black:s={W}x{H}:r={FPS}:d={total:.3f},format=yuv420p[vbase]")
        filters.append(f"anullsrc=r=48000:cl=stereo,atrim=duration={total:.3f},{AFMT}[acat]")
        vlabel = "vbase"

    # Lớp phủ PiP: scale theo khung "vừa khung" * scale, xoay, trong suốt, mờ vào/ra, dời thời gian tới start
    extra_audio = []
    for j, c in enumerate(tracks.get("overlay", [])):
        m = media.get(c.get("mediaId"))
        if not m or m.get("type") not in ("video", "image"):
            continue
        path = media_path(m)
        cin, cout = num(c, "in", 0, 0), num(c, "out", 0, 0)
        src = cout - cin
        if src <= 0.03:
            continue
        start = num(c, "start", 0, 0)
        if m["type"] == "image":
            args += ["-loop", "1", "-framerate", str(FPS), "-t", f"{src:.3f}", "-i", path]
        else:
            args += ["-ss", f"{cin:.3f}", "-t", f"{src:.3f}", "-i", path]
        tsegs, dur = clip_timing(c, src, m["type"] == "image")
        mw, mh = int(m.get("width") or W), int(m.get("height") or H)
        s0 = min(W / mw, H / mh) * num(c, "scale", 0.4, 0.02, 3)
        ow, oh = max(2, int(round(mw * s0 / 2)) * 2), max(2, int(round(mh * s0 / 2)) * 2)
        vf = video_speed_filters(tsegs) + [f"scale={ow}:{oh}", "setsar=1", fps_filter(c, tsegs, FPS)]
        b, ct, sa = num(c, "brightness", 0, -100, 100), num(c, "contrast", 0, -100, 100), num(c, "saturation", 0, -100, 100)
        if b or ct or sa:
            vf.append(f"eq=brightness={b / 100 * 0.25:.4f}:contrast={1 + ct / 100:.4f}:saturation={1 + sa / 100:.4f}")
        vf.append("format=rgba")
        op = num(c, "opacity", 1, 0, 1)
        if op < 0.999:
            vf.append(f"colorchannelmixer=aa={op:.3f}")
        rot = num(c, "rotation", 0, -360, 360)
        if abs(rot) > 0.01:
            rad = rot * math.pi / 180
            vf.append(f"rotate={rad:.6f}:c=none:ow=rotw({rad:.6f}):oh=roth({rad:.6f})")
        fi, fo = num(c, "fadeIn", 0, 0, dur / 2), num(c, "fadeOut", 0, 0, dur / 2)
        if fi > 0:
            vf.append(f"fade=t=in:st=0:d={fi:.3f}:alpha=1")
        if fo > 0:
            vf.append(f"fade=t=out:st={dur - fo:.3f}:d={fo:.3f}:alpha=1")
        vf += [f"trim=duration={dur:.3f}", f"setpts=PTS-STARTPTS+{start:.3f}/TB"]
        if not c.get("hidden"):  # track Lớp phủ bị ẩn: bỏ hình, vẫn giữ tiếng
            filters.append(f"[{idx}:v:0]{','.join(vf)}[pv{j}]")
            cx, cy = num(c, "x", 0.5) * W, num(c, "y", 0.5) * H
            filters.append(f"[{vlabel}][pv{j}]overlay=x={cx:.2f}-w/2:y={cy:.2f}-h/2:eof_action=pass"
                           f":enable='between(t,{start:.3f},{start + dur:.3f})'[po{j}]")
            vlabel = f"po{j}"
        vol = num(c, "volume", 1, 0, 4)
        if m["type"] == "video" and m.get("hasAudio") and vol > 0:
            filters.extend(audio_speed_graph(f"{idx}:a:0", f"ps{j}", tsegs, c.get("keepPitch") is not False, f"p{j}"))
            af = [f"volume={vol:.3f}", AFMT]
            if fi > 0:
                af.append(f"afade=t=in:st=0:d={fi:.3f}")
            if fo > 0:
                af.append(f"afade=t=out:st={dur - fo:.3f}:d={fo:.3f}")
            af += [f"atrim=duration={dur:.3f}", f"adelay={int(round(start * 1000))}:all=1"]
            filters.append(f"[ps{j}]{','.join(af)}[pa{j}]")
            extra_audio.append(f"[pa{j}]")
        idx += 1

    # Bộ lọc màu toàn video (trước lớp chữ): ma trận 3x4 từ frontend; cột alpha (=1) đóng vai offset
    fm = project.get("filterMatrix")
    if isinstance(fm, list) and len(fm) == 3 and all(isinstance(r, list) and len(r) == 4 for r in fm):
        vals = [[max(-4.0, min(4.0, float(v))) for v in r] for r in fm]
        keys = ["r", "g", "b"]
        opts = ":".join(f"{keys[i]}{k}={vals[i][j]:.5f}" for i in range(3) for j, k in enumerate(["r", "g", "b", "a"]))
        filters.append(f"[{vlabel}]format=rgba,colorchannelmixer={opts},format=yuv420p[vfx]")
        vlabel = "vfx"

    for j, ov in enumerate(overlay_files):
        args += ["-i", ov["path"]]
        s, e = ov["start"], ov["end"]
        filters.append(f"[{vlabel}][{idx}:v:0]overlay=0:0:enable='between(t,{s:.3f},{e:.3f})'[vo{j}]")
        vlabel = f"vo{j}"
        idx += 1
    filters.append(f"[{vlabel}]format=yuv420p[vout]")

    mix = ["[acat]"] + extra_audio
    for j, a in enumerate(tracks.get("audio", [])):
        m = media.get(a.get("mediaId"))
        if not m or not m.get("hasAudio", m.get("type") == "audio"):
            continue
        path = media_path(m)
        ain, aout = num(a, "in", 0, 0), num(a, "out", 0, 0)
        d = aout - ain
        if d <= 0.03:
            continue
        args += ["-ss", f"{ain:.3f}", "-t", f"{d:.3f}", "-i", path]
        tsegs, d = clip_timing(a, d)  # d = thời lượng trên timeline
        filters.extend(audio_speed_graph(f"{idx}:a:0", f"ts{j}", tsegs, a.get("keepPitch") is not False, f"t{j}"))
        af = [f"volume={num(a, 'volume', 1, 0, 4):.3f}", AFMT]
        fi, fo = num(a, "fadeIn", 0, 0, d / 2), num(a, "fadeOut", 0, 0, d / 2)
        if fi > 0:
            af.append(f"afade=t=in:st=0:d={fi:.3f}")
        if fo > 0:
            af.append(f"afade=t=out:st={d - fo:.3f}:d={fo:.3f}")
        delay = int(round(num(a, "start", 0, 0) * 1000))
        af.append(f"adelay={delay}:all=1")
        filters.append(f"[ts{j}]{','.join(af)}[x{j}]")
        mix.append(f"[x{j}]")
        idx += 1
    if len(mix) > 1:
        filters.append("".join(mix) + f"amix=inputs={len(mix)}:duration=longest:normalize=0,"
                       f"apad,atrim=duration={total:.3f}[aout]")
    else:
        filters.append(f"[acat]apad,atrim=duration={total:.3f}[aout]")

    with open(script_path, "w", encoding="utf-8") as f:
        f.write(";\n".join(filters))
    args += ["-filter_complex_script", script_path, "-map", "[vout]", "-map", "[aout]",
             "-c:v", "libx264", "-preset", "veryfast", "-crf", str(int(num(project, "crf", 20, 14, 35))),
             "-pix_fmt", "yuv420p", "-r", str(FPS), "-c:a", "aac", "-b:a", "192k",
             "-movflags", "+faststart", "-t", f"{total:.3f}",
             "-progress", "pipe:1", "-nostats", out_path]
    return args, total


def sep_ready():
    return os.path.isfile(SEP_PY) and os.path.isdir(os.path.join(ROOT, "sep-env", "Lib", "site-packages", "demucs"))


def run_separate(job_id, src, base, model):
    """Chạy separate.py trong sep-env; xong thì tạo 2 media mới (MR + giọng hát) trong thư viện."""
    job = JOBS[job_id]
    mr_id, vo_id = uuid.uuid4().hex[:12], uuid.uuid4().hex[:12]
    mr_path, vo_path = os.path.join(MEDIA, mr_id + ".mp3"), os.path.join(MEDIA, vo_id + ".mp3")
    tail = []
    try:
        env = dict(os.environ, PYTHONIOENCODING="utf-8", PYTHONUNBUFFERED="1")
        proc = subprocess.Popen([SEP_PY, SEP_SCRIPT, src, mr_path, vo_path, model], stdout=subprocess.PIPE,
                                stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace",
                                creationflags=NO_WINDOW, env=env, cwd=ROOT)
        job["proc"] = proc
        for line in proc.stdout:
            line = line.strip()
            if line.startswith("PROGRESS "):
                try:
                    job["progress"] = float(line.split()[1])
                except ValueError:
                    pass
            elif line.startswith("STATUS "):
                job["message"] = line[7:]
            elif line.startswith("ERROR "):
                job["error"] = line[6:]
            elif line:
                tail = (tail + [line])[-15:]
        proc.wait()
        if job.get("cancelled"):
            job.update(status="cancelled")
        elif proc.returncode == 0 and os.path.isfile(mr_path) and os.path.isfile(vo_path):
            stamp = time.strftime("%Y%m%d_%H%M%S")
            out = []
            for mid, path, label, suffix in ((mr_id, mr_path, "MR - beat", "MR"), (vo_id, vo_path, "giọng hát", "giong-hat")):
                dl_name = f"{base}_{suffix}_{stamp}.mp3"
                shutil.copyfile(path, os.path.join(EXPORTS, dl_name))
                out.append({"id": mid, "name": f"{base} ({label}).mp3", "file": os.path.basename(path),
                            "url": f"/media/{os.path.basename(path)}", "thumb": None,
                            "download": f"/exports/{quote(dl_name)}", "savedPath": os.path.join(EXPORTS, dl_name),
                            **probe(path)})
            job.update(status="done", progress=1.0, media=out)
        else:
            job.update(status="error", error=job.get("error") or "\n".join(tail[-6:]) or f"exit {proc.returncode}")
    except Exception as e:  # noqa: BLE001
        job.update(status="error", error=str(e))
    finally:
        job.pop("proc", None)
        if job.get("status") != "done":
            for f in (mr_path, vo_path):
                if os.path.isfile(f):
                    os.remove(f)


def run_export(job_id, cmd, total, log_path, job_dir):
    job = JOBS[job_id]
    try:
        with open(log_path, "w", encoding="utf-8", errors="replace") as log:
            proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=log, text=True,
                                    encoding="utf-8", errors="replace", creationflags=NO_WINDOW)
            job["proc"] = proc
            for line in proc.stdout:
                if line.startswith("out_time_us=") or line.startswith("out_time_ms="):
                    try:
                        us = int(line.split("=", 1)[1])
                        job["progress"] = max(0.0, min(0.999, us / 1e6 / total))
                    except ValueError:
                        pass
            proc.wait()
        if job.get("cancelled"):
            job.update(status="cancelled")
            if os.path.exists(job["out"]):
                os.remove(job["out"])
        elif proc.returncode == 0:
            job.update(status="done", progress=1.0)
        else:
            with open(log_path, encoding="utf-8", errors="replace") as f:
                tail = f.read()[-1500:]
            job.update(status="error", error=tail or f"ffmpeg exit {proc.returncode}")
    except Exception as e:  # noqa: BLE001
        job.update(status="error", error=str(e))
    finally:
        job.pop("proc", None)
        shutil.rmtree(job_dir, ignore_errors=True)
        try:
            os.remove(log_path)  # lỗi đã được chép vào job["error"]
        except OSError:
            pass


# ----------------------------------------------------------------- HTTP
class Handler(BaseHTTPRequestHandler):
    server_version = "VideoEditor/1.0"

    def log_message(self, fmt, *a):  # gọn console
        if "/api/export/" not in self.path:
            sys.stderr.write("%s %s\n" % (self.command, self.path[:120]))

    def send_json(self, obj, code=200):
        data = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def read_json(self, limit=200 * 1024 * 1024):
        n = int(self.headers.get("Content-Length") or 0)
        if n <= 0 or n > limit:
            raise ValueError("Body không hợp lệ")
        return json.loads(self.rfile.read(n).decode("utf-8"))

    def send_file(self, path, download=False):
        if not os.path.isfile(path):
            return self.send_error(404)
        size = os.path.getsize(path)
        ctype = MIME.get(os.path.splitext(path)[1].lower(), "application/octet-stream")
        start, end = 0, size - 1
        rng = self.headers.get("Range")
        m = re.match(r"bytes=(\d*)-(\d*)", rng or "")
        if m and (m.group(1) or m.group(2)):
            if m.group(1):
                start = int(m.group(1))
                end = min(int(m.group(2)) if m.group(2) else size - 1, size - 1)
            else:
                start = max(0, size - int(m.group(2)))
            if start >= size or start > end:
                self.send_response(416)
                self.send_header("Content-Range", f"bytes */{size}")
                self.end_headers()
                return
            self.send_response(206)
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        else:
            self.send_response(200)
        length = end - start + 1
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(length))
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Cache-Control", "no-cache")
        if download:
            fn = os.path.basename(path)
            self.send_header("Content-Disposition", f"attachment; filename=\"video.mp4\"; filename*=UTF-8''{quote(fn)}")
        self.end_headers()
        try:
            with open(path, "rb") as f:
                f.seek(start)
                while length > 0:
                    chunk = f.read(min(256 * 1024, length))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    length -= len(chunk)
        except (ConnectionResetError, BrokenPipeError, ConnectionAbortedError):
            pass

    def serve_under(self, base, rel, download=False):
        p = os.path.join(base, unquote(rel))
        if not inside(base, p):
            return self.send_error(403)
        self.send_file(p, download)

    # ---------- GET
    def do_GET(self):
        path = urlparse(self.path).path
        try:
            if path in ("/", "/index.html"):
                return self.send_file(os.path.join(STATIC, "index.html"))
            if path.startswith("/static/"):
                return self.serve_under(STATIC, path[8:])
            if path.startswith("/media/"):
                return self.serve_under(MEDIA, path[7:])
            if path.startswith("/thumbs/"):
                return self.serve_under(THUMBS, path[8:])
            if path.startswith("/exports/"):
                return self.serve_under(EXPORTS, path[9:], download=True)
            if path == "/api/projects":
                items = []
                for f in os.listdir(PROJECTS):
                    if f.endswith(".json"):
                        p = os.path.join(PROJECTS, f)
                        items.append({"name": f[:-5], "mtime": os.path.getmtime(p)})
                items.sort(key=lambda x: -x["mtime"])
                return self.send_json(items)
            if path.startswith("/api/projects/"):
                p = os.path.join(PROJECTS, safe_name(unquote(path[14:])) + ".json")
                if not os.path.isfile(p):
                    return self.send_json({"error": "Không tìm thấy dự án"}, 404)
                with open(p, encoding="utf-8") as f:
                    return self.send_json(json.load(f))
            m = re.fullmatch(r"/api/export/([0-9a-f]+)", path)
            if m:
                job = JOBS.get(m.group(1))
                if not job:
                    return self.send_json({"error": "Không có job"}, 404)
                return self.send_json({k: v for k, v in job.items() if k not in ("proc", "out")})
            if path == "/api/separate/ready":
                return self.send_json({"ready": sep_ready()})
            if path == "/api/health":
                return self.send_json({"ok": True, "ffmpeg": FFMPEG})
            self.send_error(404)
        except Exception as e:  # noqa: BLE001
            self.send_json({"error": str(e)}, 500)

    # ---------- POST
    def do_POST(self):
        path = urlparse(self.path).path
        try:
            if path == "/api/upload":
                return self.handle_upload()
            if path == "/api/projects":
                body = self.read_json()
                proj = body.get("project") or {}
                name = safe_name(str(proj.get("name") or "du-an"), "du-an")
                with open(os.path.join(PROJECTS, name + ".json"), "w", encoding="utf-8") as f:
                    json.dump(proj, f, ensure_ascii=False)
                return self.send_json({"ok": True, "name": name})
            if path == "/api/export":
                return self.handle_export()
            if path == "/api/separate":
                return self.handle_separate()
            if path == "/api/extract-audio":
                return self.handle_extract_audio()
            m = re.fullmatch(r"/api/export/([0-9a-f]+)/cancel", path)
            if m:
                job = JOBS.get(m.group(1))
                if job and job.get("proc"):
                    job["cancelled"] = True
                    job["proc"].kill()
                return self.send_json({"ok": True})
            self.send_error(404)
        except ValueError as e:
            self.send_json({"error": str(e)}, 400)
        except Exception as e:  # noqa: BLE001
            self.send_json({"error": str(e)}, 500)

    def handle_upload(self):
        n = int(self.headers.get("Content-Length") or 0)
        orig = unquote(self.headers.get("X-Filename") or "file")
        if n <= 0:
            raise ValueError("File rỗng")
        ext = os.path.splitext(orig)[1].lower()[:8]
        mid = uuid.uuid4().hex[:12]
        fname = mid + (ext if re.fullmatch(r"\.[a-z0-9]+", ext or "") else "")
        dst = os.path.join(MEDIA, fname)
        remaining = n
        with open(dst, "wb") as f:
            while remaining > 0:
                chunk = self.rfile.read(min(1024 * 1024, remaining))
                if not chunk:
                    break
                f.write(chunk)
                remaining -= len(chunk)
        if remaining:
            os.remove(dst)
            raise ValueError("Upload bị gián đoạn")
        try:
            info = probe(dst)
        except ValueError:
            os.remove(dst)
            raise
        thumb = None
        tpath = os.path.join(THUMBS, mid + ".jpg")
        if make_thumb(dst, tpath, info["type"], info["duration"]):
            thumb = f"/thumbs/{mid}.jpg"
        self.send_json({"id": mid, "name": orig, "file": fname, "url": f"/media/{fname}",
                        "thumb": thumb, **info})

    def handle_separate(self):
        if not sep_ready():
            raise ValueError("Chưa cài bộ tách giọng hát. Chạy setup_mr.bat trong thư mục video-editor rồi thử lại.")
        body = self.read_json(limit=64 * 1024)
        src = media_path({"file": body.get("file"), "name": body.get("name")})
        base = safe_name(os.path.splitext(str(body.get("name") or "audio"))[0], "audio")
        model = SEP_MODELS.get(str(body.get("quality")), "htdemucs")
        job_id = uuid.uuid4().hex[:12]
        JOBS[job_id] = {"id": job_id, "kind": "separate", "status": "running", "progress": 0.0,
                        "message": "Đang chuẩn bị…"}
        threading.Thread(target=run_separate, args=(job_id, src, base, model), daemon=True).start()
        self.send_json({"jobId": job_id})

    def handle_extract_audio(self):
        """Tách tiếng của video -> MP3 mới: thêm vào thư viện media (workspace/media) + bản sao để tải ở exports."""
        body = self.read_json(limit=64 * 1024)
        src = media_path({"file": body.get("file"), "name": body.get("name")})
        base = safe_name(os.path.splitext(str(body.get("name") or "audio"))[0], "audio")
        mid = uuid.uuid4().hex[:12]
        media_file = mid + ".mp3"
        media_out = os.path.join(MEDIA, media_file)
        r = run([FFMPEG, "-y", "-v", "error", "-i", src, "-vn", "-map", "0:a:0",
                 "-c:a", "libmp3lame", "-q:a", "2", media_out])
        if r.returncode != 0 or not os.path.isfile(media_out):
            raise ValueError("Không tách được âm thanh: " + (r.stderr or "")[-400:])
        out_name = f"{base}_am-thanh_{time.strftime('%Y%m%d_%H%M%S')}.mp3"
        out_path = os.path.join(EXPORTS, out_name)
        shutil.copyfile(media_out, out_path)
        media = {"id": mid, "name": f"{base} (âm thanh).mp3", "file": media_file, "url": f"/media/{media_file}",
                 "thumb": None, **probe(media_out)}
        self.send_json({"media": media, "file": out_name, "url": f"/exports/{quote(out_name)}", "path": out_path})

    def handle_export(self):
        body = self.read_json()
        project = body.get("project") or {}
        job_id = uuid.uuid4().hex[:12]
        job_dir = os.path.join(TMP, job_id)
        os.makedirs(job_dir, exist_ok=True)
        overlays = []
        for i, ov in enumerate(body.get("overlays") or []):
            data = str(ov.get("png", ""))
            if not data.startswith("data:image/png;base64,"):
                continue
            p = os.path.join(job_dir, f"ov{i}.png")
            with open(p, "wb") as f:
                f.write(base64.b64decode(data.split(",", 1)[1]))
            overlays.append({"path": p, "start": num(ov, "start", 0, 0), "end": num(ov, "end", 0, 0)})
        out_name = f"{safe_name(str(project.get('name') or 'video'), 'video')}_{time.strftime('%Y%m%d_%H%M%S')}.mp4"
        out_path = os.path.join(EXPORTS, out_name)
        try:
            cmd, total = build_job(project, overlays, out_path, os.path.join(job_dir, "graph.txt"))
        except Exception:
            shutil.rmtree(job_dir, ignore_errors=True)
            raise
        JOBS[job_id] = {"id": job_id, "status": "running", "progress": 0.0, "out": out_path,
                        "file": out_name, "url": f"/exports/{quote(out_name)}", "path": out_path, "total": total}
        log_path = os.path.join(EXPORTS, f".{job_id}.log")
        threading.Thread(target=run_export, args=(job_id, cmd, total, log_path, job_dir), daemon=True).start()
        self.send_json({"jobId": job_id, "total": total})


def main():
    # console Windows tiếng Hàn (cp949) không in được tiếng Việt -> ép UTF-8 để khỏi crash
    for s in (sys.stdout, sys.stderr):
        try:
            s.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass
    if not shutil.which(FFMPEG) and not os.path.isfile(FFMPEG):
        print("!! Không tìm thấy ffmpeg trong PATH. Cài ffmpeg rồi chạy lại.")
        sys.exit(1)
    srv = ThreadingHTTPServer((HOST, PORT), Handler)
    url = f"http://{HOST}:{PORT}/"
    print(f"Video Editor đang chạy: {url}  (Ctrl+C để tắt)")
    if "--no-browser" not in sys.argv:
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
