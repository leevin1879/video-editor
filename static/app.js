'use strict';
/* VEdit — trình chỉnh sửa video kiểu CapCut (frontend). Xuất video do server.py + ffmpeg đảm nhiệm. */

// ------------------------------------------------------------------ utils
const $ = (s, el = document) => el.querySelector(s);
const uid = () => Math.random().toString(36).slice(2, 10);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const pad2 = n => String(n).padStart(2, '0');
const fmt = t => { t = Math.max(0, t || 0); return `${pad2(Math.floor(t / 60))}:${pad2(Math.floor(t % 60))}.${pad2(Math.floor((t % 1) * 100))}`; };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MIN_CLIP = 0.1;

function toast(msg, ms = 2200) {
  const el = $('#toast'); el.textContent = msg; el.classList.remove('hidden');
  clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.add('hidden'), ms);
}
async function api(url, opts = {}) {
  const r = await fetch(url, opts);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
  return data;
}

// ------------------------------------------------------------------ state
const RATIOS = { '16:9': [1920, 1080], '9:16': [1080, 1920], '1:1': [1080, 1080], '4:5': [1080, 1350], '4:3': [1440, 1080] };
const FONTS = ['Arial', 'Segoe UI', 'Malgun Gothic', 'Times New Roman', 'Georgia', 'Impact', 'Comic Sans MS', 'Consolas', 'Tahoma', 'Verdana'];

// Bật/tắt hiển thị và âm thanh theo track (nút 👁 / 🔊 ở đầu track)
const TRACK_TOGGLES = { text: ['hidden'], overlay: ['hidden', 'muted'], main: ['hidden', 'muted'], audio: ['muted'] };
function defaultTrackState() {
  return Object.fromEntries(Object.keys(TRACK_TOGGLES).map(k => [k, { hidden: false, muted: false }]));
}
const trackHidden = t => !!P.trackState?.[t]?.hidden;
const trackMuted = t => !!P.trackState?.[t]?.muted;
function newProject() {
  return { version: 1, name: 'Dự án mới', ratio: '16:9', width: 1920, height: 1080, fps: 30,
    media: [], tracks: { main: [], overlay: [], text: [], audio: [] }, trackState: defaultTrackState(), filter: { id: 'none', intensity: 1 } };
}
let P = newProject();
const ui = { sel: null, playhead: 0, playing: false, zoom: 80, wall0: 0, t0: 0, dirty: true, editing: false };
const hist = { undo: [], redo: [] };

function commit() {
  hist.undo.push(JSON.stringify(P));
  if (hist.undo.length > 150) hist.undo.shift();
  hist.redo.length = 0;
}
function undo() {
  if (!hist.undo.length) return;
  hist.redo.push(JSON.stringify(P)); P = JSON.parse(hist.undo.pop()); changed(true);
}
function redo() {
  if (!hist.redo.length) return;
  hist.undo.push(JSON.stringify(P)); P = JSON.parse(hist.redo.pop()); changed(true);
}
function changed(full = true) {
  if (ui.sel && !findClip(ui.sel.track, ui.sel.id)) ui.sel = null;
  if (full && !$('#tab-filter').classList.contains('hidden')) renderFilterPanel();
  ui.dirty = true;
  renderTimeline();
  if (full) { renderProps(); renderMedia(); }
  $('#mnav [data-m="props"]')?.classList.toggle('has-sel', !!ui.sel);
  updateButtons();
  autosave();
}

const mediaById = id => P.media.find(m => m.id === id);
const findClip = (track, id) => P.tracks[track]?.find(c => c.id === id);
const isImage = c => mediaById(c.mediaId)?.type === 'image';
// ---- tốc độ: thường (c.speed) hoặc đường cong (c.curve.pts = [[u nguồn 0..1, tốc độ], ...])
const SPEED_MIN = 0.1, SPEED_MAX = 10, CURVE_K = 48;
const CURVES = [
  { id: 'montage', name: 'Montage', pts: [[0, 1.5], [0.25, 4], [0.5, 0.5], [0.75, 4], [1, 1.5]] },
  { id: 'hero', name: 'Anh hùng', pts: [[0, 1], [0.35, 1], [0.5, 0.25], [0.65, 1], [1, 1]] },
  { id: 'bullet', name: 'Viên đạn', pts: [[0, 5], [0.3, 5], [0.4, 0.2], [0.6, 0.2], [0.7, 5], [1, 5]] },
  { id: 'jump', name: 'Nhảy cắt', pts: [[0, 1], [0.4, 1], [0.45, 8], [0.55, 8], [0.6, 1], [1, 1]] },
  { id: 'flashin', name: 'Lóe vào', pts: [[0, 6], [0.4, 4], [0.6, 1], [1, 1]] },
  { id: 'flashout', name: 'Lóe ra', pts: [[0, 1], [0.4, 1], [0.6, 4], [1, 6]] },
];
function curveSpeedAt(pts, u) { // nội suy tuyến tính theo log(tốc độ)
  if (u <= pts[0][0]) return pts[0][1];
  for (let i = 0; i < pts.length - 1; i++) {
    const [u0, s0] = pts[i], [u1, s1] = pts[i + 1];
    if (u <= u1) { const k = u1 > u0 ? (u - u0) / (u1 - u0) : 0; return Math.exp(Math.log(s0) + k * (Math.log(s1) - Math.log(s0))); }
  }
  return pts[pts.length - 1][1];
}
const segCache = new Map();
// Các đoạn tốc độ của clip: {a, b} = giây nguồn, s = tốc độ, t0 = vị trí trên clip (timeline), d = độ dài timeline
function speedSegs(c) {
  const src = Math.max(0, c.out - c.in);
  if (c.mediaId && isImage(c)) return [{ a: c.in, b: c.out, s: 1, t0: 0, d: src }];
  if (!c.curve?.pts?.length) { const s = clamp(c.speed || 1, SPEED_MIN, SPEED_MAX); return [{ a: c.in, b: c.out, s, t0: 0, d: src / s }]; }
  const key = c.in + '|' + c.out + '|' + JSON.stringify(c.curve.pts);
  let segs = segCache.get(key);
  if (!segs) {
    segs = []; let t = 0;
    for (let k = 0; k < CURVE_K; k++) {
      const a = c.in + src * k / CURVE_K, b = c.in + src * (k + 1) / CURVE_K;
      const s = clamp(curveSpeedAt(c.curve.pts, (k + 0.5) / CURVE_K), SPEED_MIN, SPEED_MAX);
      segs.push({ a, b, s, t0: t, d: (b - a) / s }); t += (b - a) / s;
    }
    if (segCache.size > 400) segCache.clear();
    segCache.set(key, segs);
  }
  return segs;
}
function clipLen(c) { const S = speedSegs(c), l = S[S.length - 1]; return l.t0 + l.d; }
function segAt(c, local) { const S = speedSegs(c); for (const g of S) if (local < g.t0 + g.d) return g; return S[S.length - 1]; }
function srcAt(c, local) { const g = segAt(c, local); return clamp(g.a + (local - g.t0) * g.s, g.a, g.b); }
function rateAt(c, local) { return segAt(c, local).s; }
function edgeRate(c, side) { const S = speedSegs(c); return side === 'l' ? S[0].s : S[S.length - 1].s; }
function subCurve(pts, u0, u1) { // phần đường cong trong [u0, u1], co giãn lại về [0, 1]
  const inner = pts.filter(([u]) => u > u0 + 1e-6 && u < u1 - 1e-6).map(([u, sp]) => [(u - u0) / (u1 - u0), sp]);
  return [[0, curveSpeedAt(pts, u0)], ...inner, [1, curveSpeedAt(pts, u1)]];
}
function speedLabel(c) { return c.curve ? '〰 ' + (c.curve.name || 'Đường cong') : (c.speed && c.speed !== 1 ? `${+(+c.speed).toFixed(2)}x` : ''); }
function mainDur(c) { return clipLen(c); }
function audDur(c) { return clipLen(c); }
function ovDur(c) { return clipLen(c); }
const TRACK_H = 52;
// Xếp lớp phủ vào các hàng không chồng thời gian (hàng 0 sát track chính; clip sau trong mảng = nằm trên)
function overlayRows() {
  const rows = [], rowOf = new Map();
  for (const c of P.tracks.overlay) {
    const s0 = c.start, e0 = c.start + ovDur(c);
    let r = 0;
    for (const [i, row] of rows.entries()) if (row.some(([s, e]) => s < e0 - 1e-6 && e > s0 + 1e-6)) r = i + 1;
    (rows[r] ||= []).push([s0, e0]); rowOf.set(c.id, r);
  }
  return { rowOf, n: Math.max(1, rows.length) };
}
function mainLayout() {
  let t = 0;
  return P.tracks.main.map(c => { const d = mainDur(c); const r = { c, start: t, dur: d }; t += d; return r; });
}
function mainTotal() { return P.tracks.main.reduce((s, c) => s + mainDur(c), 0); }
function totalDuration() {
  let t = mainTotal();
  for (const c of P.tracks.text) t = Math.max(t, c.start + c.duration);
  for (const c of P.tracks.audio) t = Math.max(t, c.start + audDur(c));
  for (const c of P.tracks.overlay) t = Math.max(t, c.start + ovDur(c));
  return t;
}
function clipRange(track, c) {
  if (track === 'main') { const l = mainLayout().find(x => x.c === c); return [l.start, l.start + l.dur]; }
  if (track === 'text') return [c.start, c.start + c.duration];
  if (track === 'overlay') return [c.start, c.start + ovDur(c)];
  return [c.start, c.start + audDur(c)];
}

// ------------------------------------------------------------------ autosave
let saveTimer;
let autosaveKey = null;
function autosave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { try { if (autosaveKey) localStorage.setItem(autosaveKey, JSON.stringify(P)); } catch { /* bỏ qua */ } }, 400);
}
function loadAutosave() {
  try {
    const s = autosaveKey && localStorage.getItem(autosaveKey);
    if (s) { const p = JSON.parse(s); if (p && p.tracks) P = normalizeProject(p); }
  } catch { /* bỏ qua */ }
}
// bỏ các media mà file trên server đã bị xóa (tránh clip "chết" trên timeline)
async function pruneMissingMedia() {
  const missing = [];
  await Promise.all(P.media.map(async m => {
    try {
      const r = await fetch(m.url, { headers: { Range: 'bytes=0-0' } });
      if (r.status === 404) missing.push(m.id);
      r.body?.cancel();
    } catch { /* mạng lỗi: giữ nguyên */ }
  }));
  if (!missing.length) return;
  P.media = P.media.filter(m => !missing.includes(m.id));
  for (const t of ['main', 'overlay', 'audio']) P.tracks[t] = P.tracks[t].filter(c => !missing.includes(c.mediaId));
  changed();
  toast(`Đã bỏ ${missing.length} media không còn file gốc`);
}
function normalizeProject(p) {
  const base = newProject();
  const out = { ...base, ...p, tracks: { ...base.tracks, ...(p.tracks || {}) } };
  out.filter = { id: 'none', intensity: 1, ...(p.filter || {}) };
  out.trackState = defaultTrackState();
  for (const k of Object.keys(out.trackState)) Object.assign(out.trackState[k], p.trackState?.[k] || {});
  out.media = Array.isArray(out.media) ? out.media : [];
  return out;
}

// ------------------------------------------------------------------ media library
const fileInput = $('#fileInput');
fileInput.addEventListener('change', () => { uploadFiles([...fileInput.files]); fileInput.value = ''; });
const uploading = new Map();

function uploadFiles(files) {
  for (const f of files) {
    if (!/^(video|audio|image)\//.test(f.type) && !/\.(mp4|mov|mkv|webm|avi|m4v|mp3|wav|m4a|aac|ogg|flac|jpe?g|png|webp|bmp)$/i.test(f.name)) {
      toast(`Bỏ qua: ${f.name} (không hỗ trợ)`); continue;
    }
    const key = uid();
    uploading.set(key, { name: f.name, p: 0 });
    renderMedia();
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload');
    xhr.setRequestHeader('X-Filename', encodeURIComponent(f.name));
    xhr.upload.onprogress = e => { if (e.lengthComputable) { uploading.get(key).p = e.loaded / e.total; renderMedia(); } };
    xhr.onload = () => {
      uploading.delete(key);
      let res = {};
      try { res = JSON.parse(xhr.responseText); } catch { /* bỏ qua */ }
      if (xhr.status === 200 && res.id) {
        commit(); P.media.push(res); changed(); toast(`Đã nhập: ${res.name}`);
      } else { renderMedia(); toast(`Lỗi nhập ${f.name}: ${res.error || xhr.status}`, 4000); }
    };
    xhr.onerror = () => { uploading.delete(key); renderMedia(); toast(`Lỗi mạng khi nhập ${f.name}`); };
    xhr.send(f);
  }
}

function renderMedia() {
  const list = $('#mediaList');
  let html = '';
  for (const [, u] of uploading) {
    html += `<div class="media-item"><div class="mthumb">⏳</div><div class="mname">${esc(u.name)}</div>
      <div class="mprog" style="width:${(u.p * 100).toFixed(0)}%"></div></div>`;
  }
  for (const m of P.media) {
    const tag = t => `<span style="font-size:11px;margin-left:4px">${t}</span>`;
    const icon = m.type !== 'audio' ? '' : m.mrOf ? '🎵' + tag('MR - beat') : m.vocalsOf ? '🎤' + tag('giọng hát') : m.sourceOf ? '♪' + tag('tách từ video') : '♪';
    const canSep = m.hasAudio && !m.mrOf && !m.vocalsOf;
    const bg = m.thumb ? `style="background-image:url('${m.thumb}')"` : '';
    const dur = m.type === 'image' ? 'Ảnh' : fmt(m.duration);
    html += `<div class="media-item" draggable="true" data-id="${m.id}" title="${esc(m.name)}">
      <div class="mthumb" ${bg}>${icon}</div><div class="mdur">${dur}</div>
      <div class="mname">${esc(m.name)}</div>
      <button class="madd" data-act="add" title="Thêm vào timeline">＋</button>
      ${m.type !== 'audio' ? `<button class="mbtn mpip" data-act="pip" title="Thêm làm lớp phủ (video trong video - PiP)">PiP</button>` : ''}
      ${m.type === 'video' && m.hasAudio ? `<button class="mbtn maud" data-act="audio" title="Chỉ lấy tiếng (không lấy hình) đưa vào track Âm thanh">♪</button>
      <button class="mbtn mmp3" data-act="mp3" title="Tách tiếng ra file MP3 để tải về">MP3</button>` : ''}
      ${canSep ? `<button class="mbtn msep" data-act="sep" style="left:${m.type === 'audio' ? 4 : 40}px" title="Tách giọng hát bằng AI để tạo beat (MR)">MR</button>` : ''}
      <button class="mdel" data-act="del" title="Xóa khỏi thư viện">✕</button></div>`;
  }
  list.innerHTML = html || '<div class="hint">Chưa có media.</div>';
}
$('#mediaList').addEventListener('click', e => {
  const item = e.target.closest('.media-item[data-id]'); if (!item) return;
  const m = mediaById(item.dataset.id); const act = e.target.dataset.act;
  if (act === 'add') addMediaToTimeline(m);
  if (act === 'audio') addMediaToTimeline(m, { track: 'audio' });
  if (act === 'pip') addMediaToTimeline(m, { track: 'overlay' });
  if (act === 'mp3') extractMp3(m);
  if (act === 'sep') askSeparate(m);
  if (act === 'del') {
    const used = ['main', 'overlay', 'audio'].some(t => P.tracks[t].some(c => c.mediaId === m.id));
    if (used && !confirm('Media này đang dùng trên timeline. Xóa luôn các clip liên quan?')) return;
    commit();
    P.media = P.media.filter(x => x !== m);
    for (const t of ['main', 'overlay', 'audio']) P.tracks[t] = P.tracks[t].filter(c => c.mediaId !== m.id);
    changed();
  }
});
$('#mediaList').addEventListener('dblclick', e => {
  const item = e.target.closest('.media-item[data-id]'); if (item) addMediaToTimeline(mediaById(item.dataset.id));
});
$('#mediaList').addEventListener('dragstart', e => {
  const item = e.target.closest('.media-item[data-id]'); if (!item) return;
  e.dataTransfer.setData('text/x-media', item.dataset.id);
  e.dataTransfer.effectAllowed = 'copy';
});

function makeMainClip(m) {
  return { id: uid(), mediaId: m.id, in: 0, out: m.type === 'image' ? 3 : m.duration, speed: 1, volume: 1,
    fit: 'contain', brightness: 0, contrast: 0, saturation: 0, fadeIn: 0, fadeOut: 0 };
}
function makeAudioClip(m, start) {
  return { id: uid(), mediaId: m.id, start: Math.max(0, start), in: 0, out: m.duration, speed: 1, volume: 1, fadeIn: 0, fadeOut: 0 };
}
function makeOverlayClip(m, start) {
  return { id: uid(), mediaId: m.id, start: Math.max(0, start), in: 0, out: m.type === 'image' ? 3 : m.duration, speed: 1, volume: 1,
    x: 0.72, y: 0.28, scale: 0.4, rotation: 0, opacity: 1, brightness: 0, contrast: 0, saturation: 0, fadeIn: 0, fadeOut: 0 };
}
function addMediaToTimeline(m, opts = {}) {
  if (!m) return;
  commit();
  let clip, track;
  if (m.type === 'audio' || opts.track === 'audio') {
    if (!m.hasAudio) { hist.undo.pop(); return toast('Media này không có âm thanh'); }
    track = 'audio'; clip = makeAudioClip(m, opts.time ?? ui.playhead); P.tracks.audio.push(clip);
  } else if (opts.track === 'overlay') {
    track = 'overlay'; clip = makeOverlayClip(m, opts.time ?? ui.playhead); P.tracks.overlay.push(clip);
  } else {
    track = 'main'; clip = makeMainClip(m);
    const at = opts.index ?? P.tracks.main.length;
    P.tracks.main.splice(at, 0, clip);
    if (P.tracks.main.length === 1 && m.width && m.height) autoRatio(m);
  }
  ui.sel = { track, id: clip.id };
  if (isMobile()) openSheet(null);
  changed();
}
function autoRatio(m) { // clip đầu tiên: chọn tỉ lệ khung gần nhất với media
  const r = m.width / m.height;
  let best = '16:9', bd = 9;
  for (const [k, [w, h]] of Object.entries(RATIOS)) { const d = Math.abs(Math.log(r / (w / h))); if (d < bd) { bd = d; best = k; } }
  setRatio(best);
}
function setRatio(k) {
  if (!RATIOS[k]) return;
  P.ratio = k; [P.width, P.height] = RATIOS[k]; resizeCanvas();
}

// text presets
const TEXT_PRESETS = [
  { label: 'Văn bản thường', text: 'Nhập văn bản', color: '#ffffff', strokeWidth: 0, bg: false, bold: false },
  { label: 'Phụ đề', text: 'Phụ đề ở đây', color: '#ffffff', strokeWidth: 4, strokeColor: '#000000', bg: false, bold: true, y: 0.86, fontSize: 64 },
  { label: 'Tiêu đề lớn', text: 'TIÊU ĐỀ', color: '#ffe14d', strokeWidth: 6, strokeColor: '#000000', bold: true, fontSize: 140, font: 'Impact' },
  { label: 'Nền đen', text: 'Ghi chú', color: '#ffffff', bg: true, bgColor: '#000000cc', bold: true },
  { label: 'Nền vàng', text: 'HOT!', color: '#111111', bg: true, bgColor: '#ffd400', bold: true, fontSize: 90 },
  { label: 'Viền đỏ', text: 'Wow', color: '#ffffff', strokeWidth: 8, strokeColor: '#e0123c', bold: true, fontSize: 120 },
];
function makeTextClip(preset) {
  const p = { ...preset }; delete p.label;
  return { id: uid(), start: ui.playhead, duration: 3, text: 'Văn bản', font: 'Arial', fontSize: 80, color: '#ffffff',
    bold: false, strokeWidth: 0, strokeColor: '#000000', bg: false, bgColor: '#000000aa', x: 0.5, y: 0.5, ...p };
}
function renderTextPresets() {
  $('#textPresets').innerHTML = TEXT_PRESETS.map((p, i) => {
    const st = [`color:${p.color}`, `font-family:'${p.font || 'Arial'}'`, `font-weight:${p.bold ? 700 : 400}`];
    if (p.strokeWidth) st.push(`-webkit-text-stroke:1px ${p.strokeColor}`);
    const inner = p.bg ? `<span style="background:${p.bgColor};padding:2px 8px;border-radius:4px">${esc(p.text)}</span>` : esc(p.text);
    return `<div class="text-preset" data-i="${i}" style="${st.join(';')}" title="${esc(p.label)}">${inner}</div>`;
  }).join('');
}
$('#textPresets').addEventListener('click', e => {
  const el = e.target.closest('.text-preset'); if (!el) return;
  commit();
  const c = makeTextClip(TEXT_PRESETS[+el.dataset.i]);
  P.tracks.text.push(c); ui.sel = { track: 'text', id: c.id }; changed();
  if (isMobile()) openSheet(null);
});
document.querySelectorAll('.tab').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x === b));
  document.querySelectorAll('.tab-body').forEach(x => x.classList.toggle('hidden', x.id !== 'tab-' + b.dataset.tab));
  if (b.dataset.tab === 'filter') { renderFilterPanel(); ui.dirty = true; }
}));

$('#filterGrid').addEventListener('click', e => {
  const it = e.target.closest('.fx-item'); if (it && it.dataset.fx !== (P.filter?.id || 'none')) setFilter(it.dataset.fx);
});
$('#fxIntensity').addEventListener('input', e => {
  if (!ui.editing) { commit(); ui.editing = true; }
  P.filter.intensity = +e.target.value;
  $('#fxIntensityOut').textContent = Math.round(P.filter.intensity * 100) + '%';
  ui.dirty = true; autosave();
});
$('#fxIntensity').addEventListener('change', () => { ui.editing = false; changed(false); });

// ------------------------------------------------------------------ preview engine
const canvas = $('#preview');
const ctx = canvas.getContext('2d');
const pool = $('#mediaPool');
const videos = new Map();   // mediaId -> <video>  (track chính)
const images = new Map();   // mediaId -> Image
const audios = new Map();   // clipId  -> <audio>  (track âm thanh)

function getVideo(m, key = m.id) {
  let v = videos.get(key);
  if (!v) {
    v = document.createElement('video');
    v.src = m.url; v.preload = 'auto'; v.playsInline = true;
    v.addEventListener('seeked', () => { ui.dirty = true; });
    v.addEventListener('loadeddata', () => { ui.dirty = true; });
    pool.appendChild(v); videos.set(key, v);
  }
  return v;
}
function getImage(m) {
  let im = images.get(m.id);
  if (!im) { im = new Image(); im.onload = () => { ui.dirty = true; }; im.src = m.url; images.set(m.id, im); }
  return im;
}
function getAudio(c, m) {
  let a = audios.get(c.id);
  if (!a || a.dataset.src !== m.url) {
    a?.pause();
    a = new Audio(m.url); a.preload = 'auto'; a.dataset.src = m.url; audios.set(c.id, a);
  }
  return a;
}

function resizeCanvas() {
  canvas.width = P.width; canvas.height = P.height;
  const st = $('#stage');
  const s = Math.min((st.clientWidth - 24) / P.width, (st.clientHeight - 24) / P.height);
  canvas.style.width = Math.max(10, P.width * s) + 'px';
  canvas.style.height = Math.max(10, P.height * s) + 'px';
  ui.dirty = true;
}
new ResizeObserver(resizeCanvas).observe($('#stage'));

const fadeFactor = (local, dur, fi, fo) => {
  let f = 1;
  if (fi > 0) f = Math.min(f, local / fi);
  if (fo > 0) f = Math.min(f, (dur - local) / fo);
  return clamp(f, 0, 1);
};
// ------------------------------------------------------------------ bộ lọc màu toàn video
// Mỗi bộ lọc = ma trận màu 3x4 (3x3 + offset) trên giá trị RGB 0..1.
// Preview: SVG feColorMatrix (sRGB). Xuất: ffmpeg colorchannelmixer (cột alpha = offset). Cùng một bộ số -> giống hệt.
const MI = () => [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0]];
function mxThen(A, B) { // áp A rồi B
  const R = [];
  for (let i = 0; i < 3; i++) {
    R.push([0, 1, 2].map(j => B[i][0] * A[0][j] + B[i][1] * A[1][j] + B[i][2] * A[2][j]));
    R[i].push(B[i][0] * A[0][3] + B[i][1] * A[1][3] + B[i][2] * A[2][3] + B[i][3]);
  }
  return R;
}
const LUM = [0.2126, 0.7152, 0.0722];
const OPS = {
  contrast: c => [[c, 0, 0, 0.5 * (1 - c)], [0, c, 0, 0.5 * (1 - c)], [0, 0, c, 0.5 * (1 - c)]],
  bright: b => [[1, 0, 0, b], [0, 1, 0, b], [0, 0, 1, b]],
  sat: v => [0, 1, 2].map(i => [0, 1, 2].map(j => (1 - v) * LUM[j] + (i === j ? v : 0)).concat(0)),
  gains: (r, g, b) => [[r, 0, 0, 0], [0, g, 0, 0], [0, 0, b, 0]],
  offset: (r, g, b) => [[1, 0, 0, r], [0, 1, 0, g], [0, 0, 1, b]],
  fade: f => [[1 - f, 0, 0, f * 0.45], [0, 1 - f, 0, f * 0.45], [0, 0, 1 - f, f * 0.45]],
  sepia: a => {
    const S = [[0.393, 0.769, 0.189], [0.349, 0.686, 0.168], [0.272, 0.534, 0.131]];
    return [0, 1, 2].map(i => [0, 1, 2].map(j => (i === j ? 1 : 0) + a * (S[i][j] - (i === j ? 1 : 0))).concat(0));
  },
  hue: deg => {
    const r = deg * Math.PI / 180, c = Math.cos(r), n = Math.sin(r);
    return [[0.213 + c * 0.787 - n * 0.213, 0.715 - c * 0.715 - n * 0.715, 0.072 - c * 0.072 + n * 0.928, 0],
      [0.213 - c * 0.213 + n * 0.143, 0.715 + c * 0.285 + n * 0.140, 0.072 - c * 0.072 - n * 0.283, 0],
      [0.213 - c * 0.213 - n * 0.787, 0.715 - c * 0.715 + n * 0.715, 0.072 + c * 0.928 + n * 0.072, 0]];
  },
};
const FILTERS = [
  { id: 'none', name: 'Gốc', ops: [] },
  { id: 'clear', name: 'Trong trẻo', ops: [['contrast', 1.12], ['sat', 1.15], ['bright', 0.02]] },
  { id: 'vivid', name: 'Rực rỡ', ops: [['sat', 1.45], ['contrast', 1.08]] },
  { id: 'warm', name: 'Ấm áp', ops: [['gains', 1.08, 1.0, 0.88], ['offset', 0.02, 0.01, -0.01]] },
  { id: 'cool', name: 'Mát lạnh', ops: [['gains', 0.9, 1.0, 1.1], ['offset', -0.01, 0, 0.03]] },
  { id: 'cinema', name: 'Điện ảnh', ops: [['contrast', 1.18], ['sat', 0.8], ['gains', 1.04, 1.0, 0.96], ['offset', -0.02, 0.01, 0.04]] },
  { id: 'golden', name: 'Hoàng hôn', ops: [['gains', 1.1, 0.98, 0.8], ['offset', 0.03, 0, -0.02], ['sat', 1.15]] },
  { id: 'vintage', name: 'Cổ điển', ops: [['sepia', 0.35], ['fade', 0.12], ['contrast', 0.95]] },
  { id: 'retro', name: 'Retro', ops: [['hue', 12], ['sat', 0.85], ['fade', 0.08], ['gains', 1.04, 1, 0.92]] },
  { id: 'sepia', name: 'Nâu hoài niệm', ops: [['sepia', 1]] },
  { id: 'bw', name: 'Đen trắng', ops: [['sat', 0], ['contrast', 1.15]] },
  { id: 'faded', name: 'Phai màu', ops: [['fade', 0.18], ['sat', 0.8]] },
  { id: 'moody', name: 'Trầm buồn', ops: [['sat', 0.7], ['contrast', 1.2], ['bright', -0.04]] },
  { id: 'pink', name: 'Hồng mộng', ops: [['gains', 1.06, 0.96, 1.04], ['offset', 0.04, 0, 0.03], ['sat', 1.05]] },
  { id: 'forest', name: 'Rừng xanh', ops: [['gains', 0.95, 1.08, 0.95], ['sat', 1.1], ['contrast', 1.05]] },
  { id: 'night', name: 'Đêm xanh', ops: [['bright', -0.06], ['gains', 0.85, 0.95, 1.12], ['contrast', 1.1]] },
];
const filterById = id => FILTERS.find(f => f.id === id) || FILTERS[0];
function filterMatrix(f, k = 1) {
  let M = MI();
  for (const [op, ...a] of f.ops) M = mxThen(M, OPS[op](...a));
  return M.map((row, i) => row.map((v, j) => (j === i ? 1 : 0) + k * (v - (j === i ? 1 : 0)))); // trộn với ma trận gốc theo cường độ
}
const activeFilter = () => (P.filter && P.filter.id !== 'none' && P.filter.intensity > 0) ? filterById(P.filter.id) : null;
const SVGNS = 'http://www.w3.org/2000/svg';
const fxDefs = (() => {
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('width', 0); svg.setAttribute('height', 0); svg.style.position = 'absolute';
  const defs = document.createElementNS(SVGNS, 'defs'); svg.appendChild(defs); document.body.appendChild(svg);
  return defs;
})();
function setSvgFilter(id, M) {
  let f = document.getElementById(id);
  if (!f) {
    f = document.createElementNS(SVGNS, 'filter'); f.id = id;
    f.setAttribute('color-interpolation-filters', 'sRGB');
    f.setAttribute('x', '0'); f.setAttribute('y', '0'); f.setAttribute('width', '1'); f.setAttribute('height', '1');
    f.appendChild(document.createElementNS(SVGNS, 'feColorMatrix'));
    fxDefs.appendChild(f);
  }
  const vals = M.map(r => [r[0], r[1], r[2], 0, r[3]].map(v => +v.toFixed(5)).join(' ')).join(' ') + ' 0 0 0 1 0';
  f.firstChild.setAttribute('type', 'matrix'); f.firstChild.setAttribute('values', vals);
}
FILTERS.forEach(f => setSvgFilter('vfx-' + f.id, filterMatrix(f, 1)));
let fxKey = '';
function syncActiveFilter() { // cập nhật SVG cho bộ lọc đang dùng (theo cường độ)
  const f = activeFilter(); const key = f ? f.id + ':' + P.filter.intensity : '';
  if (key !== fxKey && f) setSvgFilter('vfx-active', filterMatrix(f, P.filter.intensity));
  fxKey = key;
  return !!f;
}
const fxBuf = document.createElement('canvas');
const rawThumb = document.createElement('canvas'); rawThumb.width = 240; rawThumb.height = 135;
let thumbTimer = 0;
function applyGlobalFilter(W, H) { // lọc toàn bộ hình (video chính + lớp phủ), chưa gồm chữ
  const filterTabOpen = !$('#tab-filter').classList.contains('hidden');
  if (filterTabOpen) {
    rawThumb.height = Math.round(240 * H / W);
    rawThumb.getContext('2d').drawImage(canvas, 0, 0, rawThumb.width, rawThumb.height);
    clearTimeout(thumbTimer); thumbTimer = setTimeout(drawFilterThumbs, ui.playing ? 400 : 60);
  }
  if (!syncActiveFilter()) return;
  if (fxBuf.width !== W || fxBuf.height !== H) { fxBuf.width = W; fxBuf.height = H; }
  const b = fxBuf.getContext('2d'); b.clearRect(0, 0, W, H); b.drawImage(canvas, 0, 0);
  ctx.save(); ctx.filter = 'url(#vfx-active)'; ctx.globalCompositeOperation = 'copy'; ctx.drawImage(fxBuf, 0, 0); ctx.restore();
}
function renderFilterPanel() {
  const cur = P.filter?.id || 'none';
  $('#filterGrid').innerHTML = FILTERS.map(f => `<div class="fx-item${f.id === cur ? ' on' : ''}" data-fx="${f.id}" title="${esc(f.name)}">
    <canvas width="240" height="135" data-fxc="${f.id}"></canvas><div class="fx-name">${esc(f.name)}</div></div>`).join('');
  $('#fxIntensity').value = P.filter?.intensity ?? 1;
  $('#fxIntensityOut').textContent = Math.round((P.filter?.intensity ?? 1) * 100) + '%';
  $('#fxIntensityRow').classList.toggle('hidden', cur === 'none');
  drawFilterThumbs();
}
function drawFilterThumbs() {
  const hasFrame = P.tracks.main.length || P.tracks.overlay.length;
  for (const c of document.querySelectorAll('#filterGrid canvas')) {
    c.height = rawThumb.height;
    const g = c.getContext('2d');
    g.filter = 'none';
    if (!hasFrame) { // chưa có video: dùng ảnh mẫu
      const gr = g.createLinearGradient(0, 0, c.width, c.height);
      gr.addColorStop(0, '#f2b880'); gr.addColorStop(0.5, '#5aa9e6'); gr.addColorStop(1, '#3b8a5a');
      g.fillStyle = gr; g.fillRect(0, 0, c.width, c.height);
      g.fillStyle = '#f6d6c2'; g.beginPath(); g.arc(c.width * 0.5, c.height * 0.45, c.height * 0.22, 0, Math.PI * 2); g.fill();
      rawThumb.getContext('2d').drawImage(c, 0, 0);
    }
    g.clearRect(0, 0, c.width, c.height);
    g.filter = `url(#vfx-${c.dataset.fxc})`;
    g.drawImage(rawThumb, 0, 0, c.width, c.height);
    g.filter = 'none';
  }
}
function setFilter(id) {
  commit();
  P.filter = { id, intensity: P.filter?.intensity || 1 };
  renderFilterPanel(); changed(false);
  toast(id === 'none' ? 'Đã bỏ bộ lọc' : `Bộ lọc: ${filterById(id).name}`);
}

function cssFilter(c) {
  const b = c.brightness || 0, ct = c.contrast || 0, s = c.saturation || 0;
  if (!b && !ct && !s) return 'none';
  return `brightness(${1 + b / 100 * 0.5}) contrast(${1 + ct / 100}) saturate(${1 + s / 100})`;
}
function seekIfNeeded(el, target, tol) {
  if (Math.abs(el.currentTime - target) > tol && !el.seeking) el.currentTime = target;
}

function activeMain(t) {
  const L = mainLayout();
  return L.find(x => t >= x.start && t < x.start + x.dur) || null;
}

function syncMedia(t) {
  const act = activeMain(t);
  const activeVid = act && !isImage(act.c) ? mediaById(act.c.mediaId) : null;
  for (const [id, v] of videos) if (!id.startsWith('ov:') && (!activeVid || id !== activeVid.id)) { if (!v.paused) v.pause(); }
  if (activeVid) {
    const c = act.c, v = getVideo(activeVid);
    const local = t - act.start, target = srcAt(c, local), rate = rateAt(c, local);
    v.playbackRate = rate; v.preservesPitch = c.keepPitch !== false;
    v.volume = trackMuted('main') ? 0 : clamp((c.volume ?? 1) * fadeFactor(local, act.dur, c.fadeIn, c.fadeOut), 0, 1);
    if (ui.playing) {
      if (v.paused) { v.currentTime = target; v.play().catch(() => {}); } else seekIfNeeded(v, target, 0.25 * Math.max(1, rate));
    } else { if (!v.paused) v.pause(); seekIfNeeded(v, target, 0.02); }
  }
  // tải trước clip kế tiếp để chuyển cảnh không bị khựng
  if (ui.playing && act) {
    const L = mainLayout(); const i = L.findIndex(x => x.c === act.c); const nx = L[i + 1];
    if (nx && !isImage(nx.c) && nx.start - t < 1.2) {
      const nm = mediaById(nx.c.mediaId);
      if (!activeVid || nm.id !== activeVid.id) { const nv = getVideo(nm); if (nv.paused) seekIfNeeded(nv, nx.c.in, 0.05); }
    }
  }
  // lớp phủ (PiP): mỗi clip một <video> riêng
  const ovLive = new Set();
  for (const c of P.tracks.overlay) {
    const m = mediaById(c.mediaId); if (!m || m.type !== 'video') continue;
    const key = 'ov:' + c.id, d = ovDur(c), local = t - c.start;
    if (local < 0 || local >= d) {
      const v = videos.get(key);
      if (v) { ovLive.add(key); if (!v.paused) v.pause(); }
      if (ui.playing && local < 0 && local > -1.2) { const pv = getVideo(m, key); ovLive.add(key); seekIfNeeded(pv, c.in, 0.05); }
      continue;
    }
    const v = getVideo(m, key); ovLive.add(key);
    const target = srcAt(c, local), sp = rateAt(c, local);
    v.playbackRate = sp; v.preservesPitch = c.keepPitch !== false;
    v.volume = trackMuted('overlay') ? 0 : clamp((c.volume ?? 1) * fadeFactor(local, d, c.fadeIn, c.fadeOut), 0, 1);
    if (ui.playing) { if (v.paused) { v.currentTime = target; v.play().catch(() => {}); } else seekIfNeeded(v, target, 0.25 * Math.max(1, sp)); }
    else { if (!v.paused) v.pause(); seekIfNeeded(v, target, 0.02); }
  }
  for (const [k, v] of videos) if (k.startsWith('ov:') && !ovLive.has(k)) { v.pause(); v.removeAttribute('src'); v.load(); v.remove(); videos.delete(k); }
  // track âm thanh
  const live = new Set();
  for (const c of P.tracks.audio) {
    const m = mediaById(c.mediaId); if (!m) continue;
    const d = audDur(c), local = t - c.start;
    const a = audios.get(c.id);
    if (local < 0 || local >= d) { if (a && !a.paused) a.pause(); if (a) live.add(c.id); continue; }
    const el = getAudio(c, m); live.add(c.id);
    el.volume = trackMuted('audio') ? 0 : clamp((c.volume ?? 1) * fadeFactor(local, d, c.fadeIn, c.fadeOut), 0, 1);
    const target = srcAt(c, local), sp = rateAt(c, local);
    el.playbackRate = sp; el.preservesPitch = c.keepPitch !== false;
    if (ui.playing) { if (el.paused) { el.currentTime = target; el.play().catch(() => {}); } else seekIfNeeded(el, target, 0.25 * Math.max(1, sp)); }
    else if (!el.paused) el.pause();
  }
  for (const [id, a] of audios) if (!live.has(id)) { a.pause(); audios.delete(id); }
}

function drawFit(src, sw, sh, fit) {
  const W = canvas.width, H = canvas.height;
  const s = fit === 'cover' ? Math.max(W / sw, H / sh) : Math.min(W / sw, H / sh);
  const dw = sw * s, dh = sh * s;
  ctx.drawImage(src, (W - dw) / 2, (H - dh) / 2, dw, dh);
}

function drawText(g, c, W, H) {
  const lines = String(c.text || '').split('\n');
  const fs = c.fontSize || 60, lh = fs * 1.25;
  g.save();
  g.font = `${c.bold ? 700 : 400} ${fs}px "${c.font || 'Arial'}", sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const bw = Math.max(0, ...lines.map(l => g.measureText(l).width)), bh = lh * lines.length;
  const cx = c.x * W, cy = c.y * H;
  if (c.bg) {
    const px = fs * 0.35, py = fs * 0.18;
    g.fillStyle = c.bgColor || '#000000aa';
    g.beginPath(); g.roundRect(cx - bw / 2 - px, cy - bh / 2 - py, bw + 2 * px, bh + 2 * py, fs * 0.2); g.fill();
  }
  lines.forEach((l, i) => {
    const y = cy - bh / 2 + lh * (i + 0.5);
    if (c.strokeWidth > 0) {
      g.lineWidth = c.strokeWidth * 2; g.strokeStyle = c.strokeColor || '#000'; g.lineJoin = 'round';
      g.strokeText(l, cx, y);
    }
    g.fillStyle = c.color || '#fff'; g.fillText(l, cx, y);
  });
  g.restore();
  return { x: cx - bw / 2, y: cy - bh / 2, w: bw, h: bh };
}

const textBoxes = []; // hộp chữ đang hiển thị, để kéo trên preview
const ovBoxes = [];   // lớp phủ đang hiển thị (tâm, kích thước, góc xoay)
function overlaySource(c) {
  const m = mediaById(c.mediaId); if (!m) return null;
  if (m.type === 'image') { const im = getImage(m); return im.complete && im.naturalWidth ? { src: im, sw: im.naturalWidth, sh: im.naturalHeight } : null; }
  const v = videos.get('ov:' + c.id); return v && v.readyState >= 2 && v.videoWidth ? { src: v, sw: v.videoWidth, sh: v.videoHeight } : null;
}
function overlayBox(c, sw, sh, W, H) { // kích thước = khung "vừa khung" * scale (server tính y hệt)
  const m = mediaById(c.mediaId);
  const mw = m?.width || sw, mh = m?.height || sh;
  const s0 = Math.min(W / mw, H / mh) * (c.scale ?? 0.4);
  return { cx: c.x * W, cy: c.y * H, w: mw * s0, h: mh * s0, rot: (c.rotation || 0) * Math.PI / 180 };
}
function render(t) {
  const W = canvas.width, H = canvas.height;
  ctx.globalAlpha = 1; ctx.filter = 'none';
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  const act = activeMain(t);
  if (act && !trackHidden('main')) {
    const c = act.c, m = mediaById(c.mediaId);
    const local = t - act.start;
    let src = null, sw = 0, sh = 0;
    if (m.type === 'image') { const im = getImage(m); if (im.complete && im.naturalWidth) { src = im; sw = im.naturalWidth; sh = im.naturalHeight; } }
    else { const v = getVideo(m); if (v.readyState >= 2 && v.videoWidth) { src = v; sw = v.videoWidth; sh = v.videoHeight; } }
    if (src) {
      ctx.filter = cssFilter(c);
      ctx.globalAlpha = fadeFactor(local, act.dur, c.fadeIn, c.fadeOut);
      drawFit(src, sw, sh, c.fit);
      ctx.globalAlpha = 1; ctx.filter = 'none';
    }
  }
  ovBoxes.length = 0;
  for (const c of trackHidden('overlay') ? [] : P.tracks.overlay) {
    const local = t - c.start, d = ovDur(c);
    if (local < 0 || local >= d) continue;
    const s = overlaySource(c); if (!s) continue;
    const b = overlayBox(c, s.sw, s.sh, W, H);
    ctx.save();
    ctx.translate(b.cx, b.cy); ctx.rotate(b.rot);
    ctx.filter = cssFilter(c);
    ctx.globalAlpha = (c.opacity ?? 1) * fadeFactor(local, d, c.fadeIn, c.fadeOut);
    ctx.drawImage(s.src, -b.w / 2, -b.h / 2, b.w, b.h);
    ctx.restore();
    ovBoxes.push({ c, box: b });
  }
  applyGlobalFilter(W, H);
  const ovSel = ui.sel?.track === 'overlay' && ovBoxes.find(o => o.c.id === ui.sel.id);
  if (ovSel && !ui.playing) {
    const b = ovSel.box, hs = handleSize();
    ctx.save(); ctx.translate(b.cx, b.cy); ctx.rotate(b.rot);
    ctx.strokeStyle = '#22d3c5'; ctx.lineWidth = Math.max(2, W / 600); ctx.setLineDash([12, 8]);
    ctx.strokeRect(-b.w / 2, -b.h / 2, b.w, b.h);
    ctx.setLineDash([]); ctx.fillStyle = '#22d3c5';
    ctx.fillRect(b.w / 2 - hs / 2, b.h / 2 - hs / 2, hs, hs);
    ctx.restore();
  }
  textBoxes.length = 0;
  for (const c of trackHidden('text') ? [] : P.tracks.text) {
    if (t >= c.start && t < c.start + c.duration) textBoxes.push({ c, box: drawText(ctx, c, W, H) });
  }
  const sel = ui.sel?.track === 'text' && textBoxes.find(b => b.c.id === ui.sel.id);
  if (sel && !ui.playing) {
    const { x, y, w, h } = sel.box, p = 12;
    ctx.save(); ctx.strokeStyle = '#22d3c5'; ctx.lineWidth = Math.max(2, W / 600); ctx.setLineDash([12, 8]);
    ctx.strokeRect(x - p, y - p, w + 2 * p, h + 2 * p); ctx.restore();
  }
}

// vòng lặp chính
function loop(now) {
  if (ui.playing) {
    const total = totalDuration();
    ui.playhead = ui.t0 + (now - ui.wall0) / 1000;
    if (ui.playhead >= total) { ui.playhead = total; setPlaying(false); }
    ui.dirty = true;
  }
  if (ui.dirty) {
    ui.dirty = false;
    syncMedia(ui.playhead);
    render(ui.playhead);
    updatePlayheadUI();
  }
  requestAnimationFrame(loop);
}
function setPlaying(on) {
  const total = totalDuration();
  if (on && total <= 0) return;
  if (on && ui.playhead >= total - 0.01) ui.playhead = 0;
  ui.playing = on;
  ui.t0 = ui.playhead; ui.wall0 = performance.now();
  if (!on) { for (const v of videos.values()) v.pause(); for (const a of audios.values()) a.pause(); }
  $('#btnPlay').textContent = on ? '❚❚' : '▶';
  ui.dirty = true;
}
function seek(t) {
  ui.playhead = clamp(t, 0, Math.max(0, totalDuration()));
  if (ui.playing) { ui.t0 = ui.playhead; ui.wall0 = performance.now(); for (const v of videos.values()) v.pause(); for (const a of audios.values()) a.pause(); }
  ui.dirty = true;
}

// kéo chữ / lớp phủ trực tiếp trên preview
const handleSize = () => Math.max(18, canvas.width / 55);
function toLocal(b, px, py) { // toạ độ điểm trong hệ trục của khung (đã bỏ góc xoay)
  const dx = px - b.cx, dy = py - b.cy, co = Math.cos(-b.rot), si = Math.sin(-b.rot);
  return [dx * co - dy * si, dx * si + dy * co];
}
canvas.addEventListener('pointerdown', e => {
  const r = canvas.getBoundingClientRect();
  const toCanvas = ev => [(ev.clientX - r.left) * canvas.width / r.width, (ev.clientY - r.top) * canvas.height / r.height];
  const [px, py] = toCanvas(e);
  let target = null, mode = 'move';
  // 1) góc đổi cỡ của lớp phủ đang chọn
  const selOv = ui.sel?.track === 'overlay' && ovBoxes.find(o => o.c.id === ui.sel.id);
  if (selOv) {
    const [lx, ly] = toLocal(selOv.box, px, py), hs = handleSize() * 1.2;
    if (Math.abs(lx - selOv.box.w / 2) <= hs && Math.abs(ly - selOv.box.h / 2) <= hs) { target = { track: 'overlay', c: selOv.c, box: selOv.box }; mode = 'resize'; }
  }
  // 2) chữ (nằm trên cùng)
  if (!target) {
    const hit = [...textBoxes].reverse().find(b => px >= b.box.x - 15 && px <= b.box.x + b.box.w + 15 && py >= b.box.y - 15 && py <= b.box.y + b.box.h + 15);
    if (hit) target = { track: 'text', c: hit.c };
  }
  // 3) lớp phủ (lớp trên được ưu tiên)
  if (!target) {
    const hit = [...ovBoxes].reverse().find(o => { const [lx, ly] = toLocal(o.box, px, py); return Math.abs(lx) <= o.box.w / 2 && Math.abs(ly) <= o.box.h / 2; });
    if (hit) target = { track: 'overlay', c: hit.c, box: hit.box };
  }
  if (!target) { if (ui.sel) { ui.sel = null; changed(); } return; }
  const c = target.c;
  if (!(ui.sel && ui.sel.id === c.id)) { ui.sel = { track: target.track, id: c.id }; changed(); }
  const before = JSON.stringify(P); const ox = c.x, oy = c.y, oscale = c.scale;
  const d0 = target.box ? Math.hypot(px - target.box.cx, py - target.box.cy) : 1;
  canvas.setPointerCapture(e.pointerId);
  const move = ev => {
    if (mode === 'resize') {
      const [qx, qy] = toCanvas(ev);
      c.scale = clamp(oscale * Math.hypot(qx - target.box.cx, qy - target.box.cy) / Math.max(1, d0), 0.05, 3);
    } else {
      c.x = clamp(ox + (ev.clientX - e.clientX) / r.width, -0.5, 1.5);
      c.y = clamp(oy + (ev.clientY - e.clientY) / r.height, -0.5, 1.5);
      if (Math.abs(c.x - 0.5) < 0.012) c.x = 0.5; // hít vào tâm khung
      if (Math.abs(c.y - 0.5) < 0.012) c.y = 0.5;
    }
    ui.dirty = true;
  };
  const up = () => {
    canvas.removeEventListener('pointermove', move); canvas.removeEventListener('pointerup', up);
    if (JSON.stringify(P) !== before) { hist.undo.push(before); hist.redo.length = 0; changed(); }
  };
  canvas.addEventListener('pointermove', move); canvas.addEventListener('pointerup', up);
});
canvas.addEventListener('pointermove', e => { // con trỏ đổi cỡ khi rê vào góc
  const selOv = ui.sel?.track === 'overlay' && ovBoxes.find(o => o.c.id === ui.sel.id);
  let cur = '';
  if (selOv && e.buttons === 0) {
    const r = canvas.getBoundingClientRect();
    const [lx, ly] = toLocal(selOv.box, (e.clientX - r.left) * canvas.width / r.width, (e.clientY - r.top) * canvas.height / r.height);
    const hs = handleSize() * 1.2;
    if (Math.abs(lx - selOv.box.w / 2) <= hs && Math.abs(ly - selOv.box.h / 2) <= hs) cur = 'nwse-resize';
    else if (Math.abs(lx) <= selOv.box.w / 2 && Math.abs(ly) <= selOv.box.h / 2) cur = 'move';
  }
  canvas.style.cursor = cur;
});

// ------------------------------------------------------------------ timeline
const tlScroll = $('#tlScroll'), tlInner = $('#tlInner');
const trackEl = name => tlInner.querySelector(`.track[data-track="${name}"]`);
const xToT = clientX => (clientX - tlInner.getBoundingClientRect().left) / ui.zoom;

function renderRuler(width) {
  const z = ui.zoom;
  const steps = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
  const step = steps.find(s => s * z >= 80) || 600;
  const sub = step >= 2 ? step / 4 : step / 2;
  let html = '';
  const maxT = width / z;
  for (let t = 0; t <= maxT; t += sub) {
    const major = Math.abs(t / step - Math.round(t / step)) < 1e-6;
    html += major ? `<div class="tick" style="left:${t * z}px">${fmt(t).replace(/\.00$/, '')}</div>`
      : `<div class="tick minor" style="left:${t * z}px"></div>`;
  }
  $('#ruler').innerHTML = html;
}

function clipHTML(track, c, start, dur, top = null) {
  const sel = ui.sel && ui.sel.track === track && ui.sel.id === c.id;
  const cls = `clip ${track}${c.detachedFrom ? ' detached' : ''}${sel ? ' sel' : ''}`;
  const style = `left:${start * ui.zoom}px;width:${Math.max(4, dur * ui.zoom)}px${top != null ? `;top:${top + 5}px;height:${TRACK_H - 10}px;bottom:auto` : ''}`;
  let inner = '', bg = '';
  if (track === 'main' || track === 'overlay') {
    const m = mediaById(c.mediaId);
    if (m?.thumb) bg = `;background-image:url('${m.thumb}')`;
    const badges = [];
    if (speedLabel(c)) badges.push(speedLabel(c));
    if (m?.type === 'image') badges.push('Ảnh');
    if ((c.volume ?? 1) === 0 && m?.type === 'video') badges.push('🔇');
    if (track === 'overlay') badges.unshift('PiP');
    inner = `<div class="clabel">${esc(m?.name || '?')}</div>${badges.length ? `<div class="cbadge">${badges.join(' · ')}</div>` : ''}`;
  } else if (track === 'text') {
    inner = `<div class="clabel">T ${esc(c.text.split('\n')[0])}</div>`;
  } else {
    const m = mediaById(c.mediaId);
    inner = `<div class="wave"></div><div class="clabel">♪ ${esc(m?.name || '?')}</div>${speedLabel(c) ? `<div class="cbadge">${speedLabel(c)}</div>` : ''}`;
  }
  return `<div class="${cls}" data-track="${track}" data-id="${c.id}" style="${style}${bg}">
    <div class="h h-l" data-h="l"></div>${inner}<div class="h h-r" data-h="r"></div></div>`;
}

function renderTimeline() {
  const total = totalDuration();
  const width = Math.max(tlScroll.clientWidth, (total + 30) * ui.zoom);
  tlInner.style.width = width + 'px';
  renderRuler(width);
  trackEl('main').innerHTML = mainLayout().map(l => clipHTML('main', l.c, l.start, l.dur)).join('');
  const { rowOf, n } = overlayRows();
  const ovEl = trackEl('overlay');
  ovEl.style.height = $('.tl-head[data-track="overlay"]').style.height = n * TRACK_H + 'px';
  ovEl.innerHTML = P.tracks.overlay.map(c => clipHTML('overlay', c, c.start, ovDur(c), (n - 1 - rowOf.get(c.id)) * TRACK_H)).join('');
  trackEl('text').innerHTML = P.tracks.text.map(c => clipHTML('text', c, c.start, c.duration)).join('');
  renderTrackToggles();
  trackEl('audio').innerHTML = P.tracks.audio.map(c => clipHTML('audio', c, c.start, audDur(c))).join('');
  $('#timeTotal').textContent = fmt(total);
  updatePlayheadUI();
}
function renderTrackToggles() {
  for (const [t, keys] of Object.entries(TRACK_TOGGLES)) {
    const head = $(`.tl-head[data-track="${t}"]`);
    for (const k of keys) {
      const b = head.querySelector(`[data-toggle-track="${k}"]`), off = !!P.trackState[t][k];
      b.classList.toggle('off', off);
      b.textContent = k === 'hidden' ? (off ? '🚫' : '👁') : (off ? '🔇' : '🔊');
      b.title = k === 'hidden' ? (off ? 'Đang ẩn — bấm để hiện' : 'Ẩn hình của track này') : (off ? 'Đang tắt tiếng — bấm để bật' : 'Tắt tiếng track này');
    }
    trackEl(t).classList.toggle('track-hidden', trackHidden(t));
    trackEl(t).classList.toggle('track-muted', trackMuted(t));
    head.classList.toggle('dimmed', trackHidden(t) || (keys.length === 1 && trackMuted(t)));
  }
}
document.querySelector('.tl-heads').addEventListener('click', e => {
  const b = e.target.closest('[data-toggle-track]'); if (!b) return;
  const t = b.closest('.tl-head').dataset.track, k = b.dataset.toggleTrack;
  commit();
  P.trackState[t][k] = !P.trackState[t][k];
  toast(`${{ text: 'Văn bản', overlay: 'Lớp phủ', main: 'Video chính', audio: 'Âm thanh' }[t]}: ${k === 'hidden' ? (P.trackState[t][k] ? 'đã ẩn hình' : 'đã hiện hình') : (P.trackState[t][k] ? 'đã tắt tiếng' : 'đã bật tiếng')}`);
  changed(false);
});
function updatePlayheadUI() {
  $('#playhead').style.left = ui.playhead * ui.zoom + 'px';
  $('#timeCur').textContent = fmt(ui.playhead);
  if (ui.playing) { // tự cuộn theo đầu phát
    const x = ui.playhead * ui.zoom;
    if (x > tlScroll.scrollLeft + tlScroll.clientWidth - 60 || x < tlScroll.scrollLeft) tlScroll.scrollLeft = x - 60;
  }
}

function snapPoints(exceptId) {
  const pts = [0, ui.playhead];
  for (const l of mainLayout()) if (l.c.id !== exceptId) pts.push(l.start, l.start + l.dur);
  for (const c of P.tracks.text) if (c.id !== exceptId) pts.push(c.start, c.start + c.duration);
  for (const c of P.tracks.audio) if (c.id !== exceptId) pts.push(c.start, c.start + audDur(c));
  for (const c of P.tracks.overlay) if (c.id !== exceptId) pts.push(c.start, c.start + ovDur(c));
  return pts;
}
function snap(t, pts) {
  const th = 8 / ui.zoom; let best = null, bd = th;
  for (const p of pts) { const d = Math.abs(p - t); if (d < bd) { bd = d; best = p; } }
  return best;
}
function showSnap(t) {
  const el = $('#snapline');
  if (t == null) el.classList.add('hidden'); else { el.style.left = t * ui.zoom + 'px'; el.classList.remove('hidden'); }
}

// ruler / vùng trống: tua
function startScrub(e) {
  if (ui.playing) setPlaying(false);
  const mv = ev => { seek(xToT(ev.clientX)); };
  mv(e);
  const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); };
  window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
}
$('#ruler').addEventListener('pointerdown', startScrub);
$('.ph-knob').addEventListener('pointerdown', e => { e.stopPropagation(); startScrub(e); });

tlInner.addEventListener('pointerdown', e => {
  if (e.button !== 0) return;
  const clipEl = e.target.closest('.clip');
  if (!clipEl) {
    if (!e.target.closest('.track')) return;
    if (e.pointerType === 'touch') { // chạm nhẹ = tua; vuốt = cuộn timeline
      const x0 = e.clientX, y0 = e.clientY;
      const tapUp = ev => {
        window.removeEventListener('pointerup', tapUp); window.removeEventListener('pointercancel', tapUp);
        if (ev.type === 'pointerup' && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 10) {
          if (ui.sel) { ui.sel = null; changed(); }
          if (ui.playing) setPlaying(false);
          seek(xToT(ev.clientX));
        }
      };
      window.addEventListener('pointerup', tapUp); window.addEventListener('pointercancel', tapUp);
      return;
    }
    if (ui.sel) { ui.sel = null; changed(); } startScrub(e);
    return;
  }
  e.preventDefault();
  const track = clipEl.dataset.track, id = clipEl.dataset.id;
  const c = findClip(track, id); if (!c) return;
  const wasSel = ui.sel && ui.sel.id === id;
  if (e.pointerType === 'touch' && !wasSel) {
    const x0 = e.clientX;
    const tapUp = ev => {
      window.removeEventListener('pointerup', tapUp); window.removeEventListener('pointercancel', tapUp);
      if (ev.type === 'pointerup' && Math.abs(ev.clientX - x0) < 10) { ui.sel = { track, id }; changed(); }
    };
    window.addEventListener('pointerup', tapUp); window.addEventListener('pointercancel', tapUp);
    return;
  }
  ui.sel = { track, id };
  if (!wasSel) { renderProps(); renderTimeline(); ui.dirty = true; }
  const handle = e.target.dataset.h;
  const before = JSON.stringify(P);
  const orig = { ...c };
  const x0 = e.clientX;
  const m = c.mediaId ? mediaById(c.mediaId) : null;
  const pts = snapPoints(id);
  let moved = false, mainIndex = null;
  const el = () => tlInner.querySelector(`.clip[data-id="${id}"]`);

  const move = ev => {
    const dx = ev.clientX - x0;
    if (!moved && Math.abs(dx) < 3) return;
    moved = true;
    const d = dx / ui.zoom;
    let snapT = null;
    if (handle) {
      if (track === 'main') {
        const sp = m.type === 'image' ? 1 : edgeRate(orig, handle);
        if (m.type === 'image') {
          c.out = Math.max(MIN_CLIP, handle === 'r' ? orig.out + d : orig.out - d);
        } else if (handle === 'l') {
          c.in = clamp(orig.in + d * sp, 0, orig.out - MIN_CLIP);
        } else {
          c.out = clamp(orig.out + d * sp, orig.in + MIN_CLIP, m.duration);
        }
      } else if (track === 'text') {
        if (handle === 'l') {
          const end = orig.start + orig.duration;
          let s = clamp(orig.start + d, 0, end - MIN_CLIP);
          const sn = snap(s, pts); if (sn != null && sn < end - MIN_CLIP) { s = sn; snapT = sn; }
          c.start = s; c.duration = end - s;
        } else {
          let end = Math.max(orig.start + MIN_CLIP, orig.start + orig.duration + d);
          const sn = snap(end, pts); if (sn != null && sn > orig.start + MIN_CLIP) { end = sn; snapT = sn; }
          c.duration = end - orig.start;
        }
      } else if (track === 'overlay') {
        const img = m.type === 'image', sp = img ? 1 : edgeRate(orig, handle);
        if (handle === 'l') {
          const lo = img ? -orig.start : Math.max(-orig.in / sp, -orig.start), hi = ovDur(orig) - MIN_CLIP;
          let dd = clamp(d, lo, hi);
          const sn = snap(orig.start + dd, pts);
          if (sn != null) { const d2 = sn - orig.start; if (d2 >= lo && d2 <= hi) { dd = d2; snapT = sn; } }
          c.start = orig.start + dd;
          if (img) c.out = orig.out - dd; else c.in = orig.in + dd * sp;
        } else {
          let endT = orig.start + ovDur(orig) + d;
          const sn = snap(endT, pts); if (sn != null) { endT = sn; snapT = sn; }
          const out = orig.out + (endT - (orig.start + ovDur(orig))) * sp;
          c.out = img ? Math.max(orig.in + MIN_CLIP, out) : clamp(out, orig.in + MIN_CLIP, m.duration);
          if (snapT != null && Math.abs(orig.start + ovDur(c) - snapT) > 1e-3) snapT = null;
        }
      } else { // audio (d tính theo thời gian timeline, đổi sang thời gian nguồn bằng * tốc độ)
        const sp = edgeRate(orig, handle);
        if (handle === 'l') {
          const lo = Math.max(-orig.in / sp, -orig.start), hi = audDur(orig) - MIN_CLIP / sp;
          let dd = clamp(d, lo, hi);
          const sn = snap(orig.start + dd, pts);
          if (sn != null) { const d2 = sn - orig.start; if (d2 >= lo && d2 <= hi) { dd = d2; snapT = sn; } }
          c.in = orig.in + dd * sp; c.start = orig.start + dd;
        } else {
          let endT = orig.start + audDur(orig) + d;
          const sn = snap(endT, pts); if (sn != null) { endT = sn; snapT = sn; }
          c.out = clamp(orig.out + (endT - (orig.start + audDur(orig))) * sp, orig.in + MIN_CLIP, m.duration);
          if (snapT != null && Math.abs(orig.start + audDur(c) - snapT) > 1e-3) snapT = null;
        }
      }
      showSnap(snapT); renderTimeline(); ui.dirty = true;
    } else if (track === 'main') {
      // kéo đổi thứ tự trên track chính (kiểu nam châm)
      const node = el(); node.classList.add('dragging'); node.style.transform = `translateX(${dx}px)`;
      const L = mainLayout(); const me = L.find(l => l.c.id === id);
      const center = me.start + d + me.dur / 2;
      const others = L.filter(l => l.c.id !== id);
      mainIndex = others.filter(l => l.start + l.dur / 2 < center).length;
      let mark = tlInner.querySelector('.insert-mark');
      if (!mark) { mark = document.createElement('div'); mark.className = 'insert-mark'; trackEl('main').appendChild(mark); }
      const markT = mainIndex < others.length ? others[mainIndex].start : (others.length ? others.at(-1).start + others.at(-1).dur : 0);
      mark.style.left = markT * ui.zoom - 1 + 'px';
    } else {
      const dur = track === 'text' ? c.duration : track === 'overlay' ? ovDur(c) : audDur(c);
      let s = Math.max(0, orig.start + d);
      const s1 = snap(s, pts), s2 = snap(s + dur, pts);
      if (s1 != null) { s = s1; snapT = s1; } else if (s2 != null) { s = Math.max(0, s2 - dur); snapT = s2; }
      c.start = s;
      showSnap(snapT); renderTimeline(); ui.dirty = true;
    }
  };
  const up = ev => {
    window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up);
    showSnap(null);
    if (track === 'main' && !handle && moved && mainIndex != null) {
      const arr = P.tracks.main; const i = arr.indexOf(c); arr.splice(i, 1); arr.splice(mainIndex, 0, c);
    }
    if (!moved && !handle && ev?.type !== 'pointercancel') seek(Math.max(xToT(x0), clipRange(track, c)[0])); // click vào clip -> đưa đầu phát tới
    if (JSON.stringify(P) !== before) { hist.undo.push(before); hist.redo.length = 0; }
    changed();
  };
  window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
});

// thả media từ thư viện xuống timeline
for (const name of ['main', 'overlay', 'audio', 'text']) {
  const el = trackEl(name);
  el.addEventListener('dragover', e => {
    if (![...e.dataTransfer.types].includes('text/x-media')) return;
    e.preventDefault(); e.stopPropagation(); el.classList.add('drop-hl');
  });
  el.addEventListener('dragleave', () => el.classList.remove('drop-hl'));
  el.addEventListener('drop', e => {
    const id = e.dataTransfer.getData('text/x-media'); if (!id) return;
    e.preventDefault(); e.stopPropagation(); el.classList.remove('drop-hl');
    const m = mediaById(id); const t = Math.max(0, xToT(e.clientX));
    if (name === 'audio') return addMediaToTimeline(m, { track: 'audio', time: t });
    if (m.type === 'audio') return addMediaToTimeline(m, { track: 'audio', time: t });
    if (name === 'overlay' || name === 'text') return addMediaToTimeline(m, { track: 'overlay', time: t });
    const L = mainLayout(); const index = L.filter(l => l.start + l.dur / 2 < t).length;
    addMediaToTimeline(m, { index });
  });
}

$('#zoom').addEventListener('input', e => {
  const center = (tlScroll.scrollLeft + tlScroll.clientWidth / 2) / ui.zoom;
  ui.zoom = +e.target.value; renderTimeline();
  tlScroll.scrollLeft = center * ui.zoom - tlScroll.clientWidth / 2;
});
tlScroll.addEventListener('wheel', e => {
  if (!e.ctrlKey) return;
  e.preventDefault();
  const z = $('#zoom'); z.value = clamp(+z.value * (e.deltaY < 0 ? 1.15 : 0.87), +z.min, +z.max);
  z.dispatchEvent(new Event('input'));
}, { passive: false });

// ------------------------------------------------------------------ edit ops
function splitAtPlayhead() {
  const t = ui.playhead;
  let target = ui.sel ? { track: ui.sel.track, c: findClip(ui.sel.track, ui.sel.id) } : null;
  if (target) { const [s, e] = clipRange(target.track, target.c); if (!(t > s + 0.05 && t < e - 0.05)) target = null; }
  if (!target) { const a = activeMain(t); if (a && t > a.start + 0.05 && t < a.start + a.dur - 0.05) target = { track: 'main', c: a.c }; }
  if (!target) return toast('Đặt đầu phát vào giữa một clip để tách');
  commit();
  const { track, c } = target;
  const [s] = clipRange(track, c); const local = t - s;
  const b = { ...c, id: uid() };
  const arr = P.tracks[track];
  const cutSrc = track === 'text' ? 0 : srcAt(c, local);
  if (c.curve && track !== 'text') { // mỗi nửa giữ đúng phần đường cong của nó
    const uc = (cutSrc - c.in) / Math.max(1e-6, c.out - c.in), pts = c.curve.pts;
    c.curve = { ...c.curve, pts: subCurve(pts, 0, uc) }; b.curve = { ...c.curve, pts: subCurve(pts, uc, 1) };
  }
  if (track === 'main') {
    const cut = isImage(c) ? c.in + local : cutSrc;
    if (isImage(c)) { b.in = 0; b.out = c.out - local; c.out = local; } else { b.in = cut; c.out = cut; }
    c.fadeOut = 0; b.fadeIn = 0;
  } else if (track === 'text') {
    b.start = t; b.duration = c.duration - local; c.duration = local;
  } else if (track === 'overlay') {
    if (isImage(c)) { b.in = 0; b.out = c.out - local; c.out = c.in + local; }
    else { const cut = cutSrc; b.in = cut; c.out = cut; }
    b.start = t; c.fadeOut = 0; b.fadeIn = 0;
  } else {
    const cut = cutSrc;
    b.start = t; b.in = cut; c.out = cut; c.fadeOut = 0; b.fadeIn = 0;
  }
  arr.splice(arr.indexOf(c) + 1, 0, b);
  ui.sel = { track, id: b.id };
  changed();
}
// Tạo (hoặc dùng lại) file MP3 tách từ video, đặt ngay cạnh video trong thư viện Media
const extracting = new Map(); // mediaId video -> Promise (tránh tách trùng khi bấm liên tục)
async function ensureMp3(m) {
  const exist = P.media.find(x => x.sourceOf === m.id);
  if (exist) return { media: exist, created: false };
  if (!extracting.has(m.id)) {
    extracting.set(m.id, api('/api/extract-audio', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file: m.file, name: m.name }) }).finally(() => extracting.delete(m.id)));
  }
  const r = await extracting.get(m.id);
  const again = P.media.find(x => x.sourceOf === m.id);
  if (again) return { media: again, created: false };
  const media = { ...r.media, sourceOf: m.id, download: r.url, savedPath: r.path };
  const i = P.media.findIndex(x => x.id === m.id);
  P.media.splice(i < 0 ? P.media.length : i + 1, 0, media);
  return { media, created: true };
}

// Tách âm thanh: tạo MP3 mới cạnh video, đưa xuống track Âm thanh (đúng vị trí/tốc độ), tắt tiếng clip video
const detaching = new Set(); // clip đang tách (chặn bấm nhiều lần)
async function detachAudio(c) {
  const m = c && mediaById(c.mediaId);
  if (!m || m.type !== 'video' || !m.hasAudio) return toast('Clip này không có âm thanh');
  const done = () => (c.volume ?? 1) === 0 && P.tracks.audio.some(a => a.detachedFrom === c.id);
  if (done()) return toast('Clip này đã được tách âm thanh rồi');
  if (detaching.has(c.id)) return toast('Đang tách âm thanh, chờ chút…');
  detaching.add(c.id);
  toast('Đang tách âm thanh ra MP3…', 60000);
  const before = JSON.stringify(P);
  let res;
  try { res = await ensureMp3(m); } catch (e) { return toast('Lỗi tách âm thanh: ' + e.message, 5000); }
  finally { detaching.delete(c.id); }
  const ctrack = findClip('main', c.id) ? 'main' : findClip('overlay', c.id) ? 'overlay' : null;
  if (!ctrack) { renderMedia(); return toast('Clip đã bị xóa trong lúc tách'); }
  if (done()) return;
  hist.undo.push(before); hist.redo.length = 0;
  const [start] = clipRange(ctrack, c);
  const a = { id: uid(), mediaId: res.media.id, start, in: c.in, out: Math.min(c.out, res.media.duration || c.out),
    speed: c.speed || 1, curve: c.curve ? JSON.parse(JSON.stringify(c.curve)) : undefined, keepPitch: c.keepPitch,
    volume: c.volume || 1, fadeIn: c.fadeIn || 0, fadeOut: c.fadeOut || 0, detachedFrom: c.id };
  c.volume = 0;
  P.tracks.audio.push(a);
  ui.sel = { track: 'audio', id: a.id };
  changed();
  toast(`Đã tách âm thanh → tạo file "${res.media.name}" trong thư viện`, 3500);
}

// Nút MP3: tạo file MP3 cạnh video trong thư viện + cho tải về
async function extractMp3(m) {
  if (!m?.hasAudio) return toast('File này không có âm thanh');
  toast('Đang tách âm thanh ra MP3…', 60000);
  try {
    const before = JSON.stringify(P);
    const { media, created } = await ensureMp3(m);
    if (created) { hist.undo.push(before); hist.redo.length = 0; changed(); }
    toast(created ? 'Đã tạo file MP3 cạnh video trong thư viện' : 'File MP3 này đã có sẵn trong thư viện');
    modal('Tách âm thanh (MP3)', `<div>✅ <b>${esc(media.name)}</b> đã nằm cạnh video trong thư viện Media.</div>
      ${media.savedPath ? `<div class="dim" style="word-break:break-all;margin:6px 0 12px">Bản tải về: ${esc(media.savedPath)}</div>` : ''}
      ${media.download ? `<a href="${media.download}" download><button class="primary">Tải MP3</button></a>` : ''}`);
  } catch (e) { toast('Lỗi tách MP3: ' + e.message, 5000); }
}
// ------------------------------------------------------------------ tách beat (MR) bằng AI (Demucs ở server)
const separating = new Map(); // mediaId -> đang tách
function findSeparated(m) {
  const mr = P.media.find(x => x.mrOf === m.id), vocals = P.media.find(x => x.vocalsOf === m.id);
  return mr && vocals ? { mr, vocals } : null;
}
async function askSeparate(m, after) {
  if (!m?.hasAudio) return toast('File này không có âm thanh');
  const ex = findSeparated(m);
  if (ex) { if (after) after(ex); else showSepResult(ex, false); return; }
  if (separating.has(m.id)) return toast('Bài này đang được tách, chờ chút…');
  let ready = false;
  try { ready = (await api('/api/separate/ready')).ready; } catch { /* server lỗi -> coi như chưa sẵn sàng */ }
  if (!ready) {
    return modal('Tách beat (MR)', `<div>Chưa cài bộ tách giọng hát bằng AI.</div>
      <div class="dim" style="margin-top:8px">Chạy file <b>setup_mr.bat</b> trong thư mục cài app (cùng chỗ với <b>start.bat</b>)
      (tải khoảng 2,5GB, chỉ làm một lần), rồi thử lại.</div>`);
  }
  modal('Tách beat (MR) bằng AI', `<div>Tách giọng hát khỏi <b>${esc(m.name)}</b> → tạo <b>beat (MR)</b> và file <b>giọng hát</b> riêng.</div>
    <div class="group-title">Chất lượng</div>
    <div class="seg" id="sepQ"><button data-q="fast" class="on">Nhanh</button><button data-q="best">Chất lượng cao (chậm hơn ~4 lần)</button></div>
    <div style="margin-top:14px;text-align:right"><button class="primary" id="sepGo">Bắt đầu tách</button></div>`);
  let q = 'fast';
  $('#sepQ').onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    q = b.dataset.q; [...$('#sepQ').children].forEach(x => x.classList.toggle('on', x === b));
  };
  $('#sepGo').onclick = () => runSeparate(m, q, after);
}
async function runSeparate(m, quality, after) {
  separating.set(m.id, true);
  modal('Tách beat (MR) bằng AI', `<div><b>${esc(m.name)}</b></div>
    <div class="progress"><div id="sepBar"></div></div><div id="sepMsg" class="dim">Đang chuẩn bị…</div>
    <div class="dim" style="margin-top:6px;font-size:11px">Có thể đóng cửa sổ này, việc tách vẫn chạy và sẽ báo khi xong.</div>
    <div style="margin-top:12px;text-align:right"><button id="sepCancel">Hủy</button></div>`);
  const showErr = msg => {
    const el = $('#sepMsg');
    if (el && !$('#modal').classList.contains('hidden')) { el.innerHTML = `<div class="err">${esc(msg)}</div>`; $('#sepCancel')?.remove(); }
    else toast('Tách beat lỗi: ' + msg, 6000);
  };
  try {
    const job = await api('/api/separate', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file: m.file, name: m.name, quality }) });
    $('#sepCancel').onclick = () => api(`/api/export/${job.jobId}/cancel`, { method: 'POST' }).catch(() => {});
    let s;
    for (;;) {
      await new Promise(r => setTimeout(r, 700));
      try { s = await api('/api/export/' + job.jobId); } catch { continue; }
      const bar = $('#sepBar');
      if (bar) { bar.style.width = (s.progress * 100).toFixed(1) + '%'; $('#sepMsg').textContent = `${s.message || ''} ${Math.round(s.progress * 100)}%`; }
      if (s.status !== 'running') break;
    }
    if (s.status === 'cancelled') return showErr('Đã hủy');
    if (s.status !== 'done') return showErr(s.error || 'Lỗi không rõ');
    const before = JSON.stringify(P);
    const mr = { ...s.media[0], mrOf: m.id }, vocals = { ...s.media[1], vocalsOf: m.id };
    const i = P.media.findIndex(x => x.id === m.id);
    P.media.splice(i < 0 ? P.media.length : i + 1, 0, mr, vocals);
    hist.undo.push(before); hist.redo.length = 0;
    changed();
    toast('Đã tách xong beat (MR) và giọng hát', 3500);
    const res = { mr, vocals };
    if (after) after(res);
    showSepResult(res, true);
  } catch (e) { showErr(e.message); }
  finally { separating.delete(m.id); }
}
function showSepResult({ mr, vocals }, fresh) {
  modal('Tách beat (MR)', `<div>✅ ${fresh ? 'Đã tạo' : 'Đã có sẵn'} 2 file nằm cạnh bài gốc trong thư viện Media:</div>
    <div style="margin:10px 0;line-height:1.8">🎵 <b>${esc(mr.name)}</b><br>🎤 <b>${esc(vocals.name)}</b></div>
    <div style="display:flex;flex-wrap:wrap;gap:8px">
      <button class="primary" data-sep-add="${mr.id}">＋ Thêm MR vào timeline</button>
      ${mr.download ? `<a href="${mr.download}" download><button>Tải MR</button></a>` : ''}
      ${vocals.download ? `<a href="${vocals.download}" download><button>Tải giọng hát</button></a>` : ''}
    </div>
    ${mr.savedPath ? `<div class="dim" style="margin-top:10px;font-size:11px;word-break:break-all">Đã lưu: ${esc(mr.savedPath)}</div>` : ''}`);
}
$('#modalBody').addEventListener('click', e => {
  const b = e.target.closest('[data-sep-add]'); if (!b) return;
  addMediaToTimeline(mediaById(b.dataset.sepAdd), { track: 'audio' }); closeModal();
});
// Nút trong panel clip: clip âm thanh -> đổi sang MR; clip video -> tắt tiếng + thêm MR xuống track Âm thanh
function sepForClip(track, c) {
  askSeparate(mediaById(c.mediaId), ({ mr }) => {
    const cur = findClip(track, c.id); if (!cur) return;
    commit();
    if (track === 'audio') { cur.mediaId = mr.id; cur.out = Math.min(cur.out, mr.duration || cur.out); }
    else {
      const [start] = clipRange(track, cur);
      P.tracks.audio.push({ id: uid(), mediaId: mr.id, start, in: cur.in, out: Math.min(cur.out, mr.duration || cur.out),
        speed: cur.speed || 1, curve: cur.curve ? JSON.parse(JSON.stringify(cur.curve)) : undefined, keepPitch: cur.keepPitch,
        volume: cur.volume || 1, fadeIn: cur.fadeIn || 0, fadeOut: cur.fadeOut || 0, detachedFrom: cur.id });
      cur.volume = 0;
    }
    changed();
    toast(track === 'audio' ? 'Clip đã chuyển sang beat (MR)' : 'Đã thay tiếng video bằng beat (MR) ở track Âm thanh', 3500);
  });
}
function deleteSelected() {
  if (!ui.sel) return;
  commit();
  P.tracks[ui.sel.track] = P.tracks[ui.sel.track].filter(c => c.id !== ui.sel.id);
  ui.sel = null; changed();
}
function duplicateSelected() {
  if (!ui.sel) return;
  const c = findClip(ui.sel.track, ui.sel.id); if (!c) return;
  commit();
  const arr = P.tracks[ui.sel.track];
  const b = { ...c, id: uid() };
  if (ui.sel.track === 'text') b.start = c.start + c.duration;
  if (ui.sel.track === 'audio') b.start = c.start + audDur(c);
  if (ui.sel.track === 'overlay') b.start = c.start + ovDur(c);
  arr.splice(arr.indexOf(c) + 1, 0, b);
  ui.sel = { track: ui.sel.track, id: b.id }; changed();
}
function updateButtons() {
  $('#btnUndo').disabled = !hist.undo.length;
  $('#btnRedo').disabled = !hist.redo.length;
  $('#btnDel').disabled = $('#btnDup').disabled = !ui.sel;
}

// ------------------------------------------------------------------ properties panel
const field = (key, label, input, out = '') =>
  `<div class="field"><label>${label}${out !== '' ? `<output data-out="${key}">${out}</output>` : ''}</label>${input}</div>`;
const range = (key, min, max, step, v) => `<input type="range" data-k="${key}" min="${min}" max="${max}" step="${step}" value="${v}">`;
const num = (key, min, max, step, v) => `<input type="number" data-k="${key}" min="${min}" max="${max}" step="${step}" value="${+(+v).toFixed(2)}">`;

// ---- panel Tốc độ (giống CapCut: Bình thường / Đường cong)
const CV = { w: 260, h: 150, p: 16 };
const cvX = u => CV.p + u * (CV.w - 2 * CV.p);
const cvY = sp => CV.p + (1 - (Math.log10(sp) + 1) / 2) * (CV.h - 2 * CV.p);
const cvU = x => clamp((x - CV.p) / (CV.w - 2 * CV.p), 0, 1);
const cvS = y => clamp(10 ** ((1 - (y - CV.p) / (CV.h - 2 * CV.p)) * 2 - 1), SPEED_MIN, SPEED_MAX);
const fmtSp = sp => (sp >= 10 ? sp.toFixed(0) : sp >= 1 ? +sp.toFixed(2) : +sp.toFixed(2)) + 'x';
function curveSVG(c) {
  const pts = c.curve.pts;
  let d = '';
  for (let i = 0; i <= 96; i++) { const u = i / 96; d += (i ? 'L' : 'M') + cvX(u).toFixed(1) + ',' + cvY(curveSpeedAt(pts, u)).toFixed(1); }
  const grid = [[10, '10x'], [1, '1x'], [0.1, '0.1x']].map(([sp, l]) =>
    `<line x1="${CV.p}" x2="${CV.w - CV.p}" y1="${cvY(sp)}" y2="${cvY(sp)}" class="cv-grid${sp === 1 ? ' one' : ''}"/><text x="2" y="${cvY(sp) + 3}" class="cv-lbl">${l}</text>`).join('');
  const dots = pts.map(([u, sp], i) => `<circle data-pi="${i}" cx="${cvX(u)}" cy="${cvY(sp)}" r="6"><title>${fmtSp(sp)}</title></circle>`).join('');
  return `<svg id="curveEd" class="curve-ed" viewBox="0 0 ${CV.w} ${CV.h}">${grid}<path d="${d}" class="cv-line"/>${dots}</svg>`;
}
function speedInfo(c) {
  return `Thời lượng: <b>${fmt(clipLen(c))}</b> (gốc ${fmt(c.out - c.in)})`;
}
function speedSection(c, isVideo) {
  if (ui.spSel !== c.id) { ui.spSel = c.id; ui.spTab = null; }
  const tab = ui.spTab || (c.curve ? 'curve' : 'normal');
  const sp = clamp(c.speed || 1, SPEED_MIN, SPEED_MAX);
  const slowest = Math.min(...speedSegs(c).map(g => g.s));
  let body;
  if (tab === 'normal') {
    body = `${field('speedLog', 'Tốc độ', `<input type="range" data-k="speedLog" min="-1" max="1" step="0.005" value="${Math.log10(c.curve ? 1 : sp)}">`, c.curve ? '1x' : fmtSp(sp))}
      <div class="sp-presets">${[0.1, 0.25, 0.5, 1, 1.5, 2, 3, 5, 10].map(v => `<button data-sp="${v}" class="${!c.curve && Math.abs(sp - v) < 1e-3 ? 'on' : ''}">${v}x</button>`).join('')}</div>`;
  } else {
    body = `<div class="sp-presets curves"><button data-curve="none" class="${!c.curve ? 'on' : ''}">Không</button>${CURVES.map(cv => `<button data-curve="${cv.id}" class="${c.curve?.id === cv.id ? 'on' : ''}">${cv.name}</button>`).join('')}</div>
      ${c.curve ? `${curveSVG(c)}<div class="info">Kéo điểm để đổi tốc độ · nhấp đúp vào đường để thêm điểm · nhấp đúp vào điểm để xóa</div>` : '<div class="info">Chọn một kiểu đường cong để tăng/giảm tốc độ trong clip (speed ramp).</div>'}`;
  }
  return `<div class="group-title">Tốc độ</div>
    <div class="seg" style="margin-bottom:10px"><button data-sptab="normal" class="${tab === 'normal' ? 'on' : ''}">Bình thường</button><button data-sptab="curve" class="${tab === 'curve' ? 'on' : ''}">Đường cong</button></div>
    ${body}
    <div class="info" id="spdInfo" style="margin:8px 0">${speedInfo(c)}</div>
    <div class="seg" style="margin-bottom:8px"><button data-act="pitch" class="${c.keepPitch !== false ? 'on' : ''}" title="Giữ giọng nói không bị méo khi tua nhanh/chậm">${c.keepPitch !== false ? '✓ ' : ''}Giữ cao độ giọng</button></div>
    ${isVideo ? `<div class="field"><label>Slow motion mượt (khi xuất)</label><div class="seg">
      <button data-smooth="none" class="${!c.smooth || c.smooth === 'none' ? 'on' : ''}">Tắt</button>
      <button data-smooth="blend" class="${c.smooth === 'blend' ? 'on' : ''}" title="Trộn các khung hình liền kề — nhanh">Trộn khung</button>
      <button data-smooth="flow" class="${c.smooth === 'flow' ? 'on' : ''}" title="Nội suy chuyển động tạo khung hình mới — mượt nhất, xuất chậm">Nội suy</button></div>
      <div class="info" style="margin-top:4px">${slowest < 0.999 ? 'Áp dụng cho đoạn chạy chậm hơn 1x. "Nội suy" mượt nhất nhưng xuất video lâu hơn nhiều.' : 'Chỉ có tác dụng khi clip chạy chậm hơn 1x.'}</div></div>` : ''}`;
}
function refreshSpeedUI(c) { // vẽ lại đồ thị + thời lượng khi đang kéo, không dựng lại cả panel
  const svg = $('#curveEd'); if (svg && c.curve) svg.outerHTML = curveSVG(c);
  const inf = $('#spdInfo'); if (inf) inf.innerHTML = speedInfo(c);
  ui.dirty = true; renderTimeline(); autosave();
}
// kéo / thêm / xóa điểm trên đồ thị đường cong
$('#props').addEventListener('pointerdown', e => {
  const dot = e.target.closest('#curveEd circle'); if (!dot) return;
  const c = ui.sel && findClip(ui.sel.track, ui.sel.id); if (!c?.curve) return;
  e.preventDefault();
  const i = +dot.dataset.pi, before = JSON.stringify(P);
  c.curve = { ...c.curve, pts: c.curve.pts.map(p => [...p]) };
  const move = ev => {
    const r = $('#curveEd').getBoundingClientRect();
    const x = (ev.clientX - r.left) * CV.w / r.width, y = (ev.clientY - r.top) * CV.h / r.height;
    const pts = c.curve.pts, last = pts.length - 1;
    let sp = cvS(y); if (Math.abs(Math.log10(sp)) < 0.02) sp = 1; // hít vào 1x
    pts[i][1] = +sp.toFixed(3);
    if (i > 0 && i < last) pts[i][0] = clamp(cvU(x), pts[i - 1][0] + 0.02, pts[i + 1][0] - 0.02);
    c.curve.id = 'custom'; c.curve.name = 'Tùy chỉnh';
    refreshSpeedUI(c);
    const inf = $('#spdInfo'); if (inf) inf.innerHTML = `Điểm: <b>${fmtSp(sp)}</b> · ` + speedInfo(c);
  };
  const up = () => {
    window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up);
    if (JSON.stringify(P) !== before) { hist.undo.push(before); hist.redo.length = 0; }
    changed();
  };
  window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
});
$('#props').addEventListener('dblclick', e => {
  const svg = e.target.closest('#curveEd'); if (!svg) return;
  const c = ui.sel && findClip(ui.sel.track, ui.sel.id); if (!c?.curve) return;
  commit();
  const pts = c.curve.pts.map(p => [...p]);
  const dot = e.target.closest('circle');
  if (dot) { const i = +dot.dataset.pi; if (i === 0 || i === pts.length - 1) { hist.undo.pop(); return; } pts.splice(i, 1); }
  else {
    const r = svg.getBoundingClientRect(), u = cvU((e.clientX - r.left) * CV.w / r.width);
    const sp = +cvS((e.clientY - r.top) * CV.h / r.height).toFixed(3);
    const at = pts.findIndex(p => p[0] > u); if (at <= 0) { hist.undo.pop(); return; }
    pts.splice(at, 0, [u, sp]);
  }
  c.curve = { ...c.curve, id: 'custom', name: 'Tùy chỉnh', pts };
  changed();
});

function renderProps() {
  const box = $('#props');
  if (!ui.sel) {
    $('#propTitle').textContent = 'Dự án';
    box.innerHTML = `
      ${field('ratio', 'Tỉ lệ khung hình', `<div class="seg">${Object.keys(RATIOS).map(k => `<button data-ratio="${k}" class="${P.ratio === k ? 'on' : ''}">${k}</button>`).join('')}</div>`)}
      ${field('fps', 'FPS', `<select data-k="fps">${[24, 25, 30, 60].map(f => `<option ${P.fps === f ? 'selected' : ''}>${f}</option>`).join('')}</select>`)}
      <div class="info">Kích thước xuất: ${P.width}×${P.height}<br>Thời lượng: ${fmt(totalDuration())}<br>Bộ lọc: ${activeFilter() ? `${esc(activeFilter().name)} (${Math.round(P.filter.intensity * 100)}%)` : 'không'}</div>
      <div class="group-title">Phím tắt</div>
      <div class="info">Space phát/dừng · S tách · Delete xóa · Ctrl+D nhân bản · Ctrl+Z/Y hoàn tác · ←/→ lùi/tiến 1 frame (Shift: 1 giây) · Ctrl+cuộn: zoom timeline · Kéo chữ / lớp phủ trực tiếp trên khung preview (kéo ô góc để đổi cỡ PiP)</div>`;
    return;
  }
  const { track } = ui.sel; const c = findClip(track, ui.sel.id);
  if (track === 'main') {
    const m = mediaById(c.mediaId); const img = m.type === 'image';
    $('#propTitle').textContent = img ? 'Ảnh' : 'Video';
    box.innerHTML = `
      <div class="info">${esc(m.name)}<br>${m.width}×${m.height}${img ? '' : ' · gốc ' + fmt(m.duration)}</div>
      <div class="group-title">Thời lượng</div>
      ${img ? field('dur', 'Thời lượng (giây)', num('dur', 0.1, 600, 0.1, c.out - c.in))
        : `<div class="row">${field('in', 'Bắt đầu (giây)', num('in', 0, m.duration, 0.01, c.in))}${field('out', 'Kết thúc (giây)', num('out', 0, m.duration, 0.01, c.out))}</div>
           ${field('volume', 'Âm lượng', range('volume', 0, 2, 0.05, c.volume), Math.round(c.volume * 100) + '%')}
           ${speedSection(c, true)}`}
      ${field('fit', 'Khung hình', `<div class="seg"><button data-fit="contain" class="${c.fit !== 'cover' ? 'on' : ''}">Vừa khung</button><button data-fit="cover" class="${c.fit === 'cover' ? 'on' : ''}">Lấp đầy</button></div>`)}
      <div class="group-title">Điều chỉnh màu</div>
      ${field('brightness', 'Độ sáng', range('brightness', -100, 100, 1, c.brightness), c.brightness)}
      ${field('contrast', 'Tương phản', range('contrast', -100, 100, 1, c.contrast), c.contrast)}
      ${field('saturation', 'Bão hòa', range('saturation', -100, 100, 1, c.saturation), c.saturation)}
      <div class="group-title">Hiệu ứng</div>
      <div class="row">${field('fadeIn', 'Mờ vào (s)', num('fadeIn', 0, 5, 0.1, c.fadeIn))}${field('fadeOut', 'Mờ ra (s)', num('fadeOut', 0, 5, 0.1, c.fadeOut))}</div>
      <button data-act="reset">Đặt lại màu & hiệu ứng</button>
      ${!img && m.hasAudio ? `<div class="group-title">Âm thanh</div>
        <button data-act="detach" class="primary" style="width:100%">♪ Tách âm thanh</button>
        <div class="info" style="margin-top:6px">Tiếng sẽ chuyển xuống track Âm thanh để chỉnh riêng; clip video bị tắt tiếng.</div>
        <button data-act="mp3" style="width:100%;margin-top:8px">Tải riêng tiếng (MP3)</button>
        <button data-act="sep" style="width:100%;margin-top:8px">🎤 Tách beat (MR) – bỏ giọng hát</button>` : ''}`;
  } else if (track === 'overlay') {
    const m = mediaById(c.mediaId); const img = m.type === 'image';
    $('#propTitle').textContent = 'Lớp phủ (PiP)';
    box.innerHTML = `
      <div class="info">${esc(m.name)} · ${m.width}×${m.height}<br>Kéo trên khung xem trước để di chuyển, kéo ô vuông ở góc để đổi cỡ.</div>
      <div class="group-title">Vị trí & kích thước</div>
      ${field('scale', 'Kích thước', range('scale', 0.05, 2, 0.01, c.scale), Math.round(c.scale * 100) + '%')}
      ${field('x', 'Ngang', range('x', -0.5, 1.5, 0.005, c.x), Math.round(c.x * 100) + '%')}
      ${field('y', 'Dọc', range('y', -0.5, 1.5, 0.005, c.y), Math.round(c.y * 100) + '%')}
      ${field('rotation', 'Xoay', range('rotation', -180, 180, 1, c.rotation || 0), (c.rotation || 0) + '°')}
      ${field('opacity', 'Độ trong suốt', range('opacity', 0, 1, 0.01, c.opacity ?? 1), Math.round((c.opacity ?? 1) * 100) + '%')}
      <div class="seg" style="margin-bottom:8px"><button data-act="ovFull">Toàn khung</button><button data-act="ovReset">Góc phải trên</button></div>
      <div class="seg" style="margin-bottom:12px"><button data-act="ovUp">⬆ Lớp trên</button><button data-act="ovDown">⬇ Lớp dưới</button></div>
      <div class="group-title">Thời gian</div>
      ${field('start', 'Bắt đầu trên timeline (s)', num('start', 0, 36000, 0.1, c.start))}
      ${img ? field('dur', 'Thời lượng (giây)', num('dur', 0.1, 600, 0.1, c.out - c.in))
        : `<div class="row">${field('in', 'Cắt đầu (s)', num('in', 0, m.duration, 0.01, c.in))}${field('out', 'Cắt cuối (s)', num('out', 0, m.duration, 0.01, c.out))}</div>
           ${field('volume', 'Âm lượng', range('volume', 0, 2, 0.05, c.volume ?? 1), Math.round((c.volume ?? 1) * 100) + '%')}
           ${speedSection(c, true)}`}
      <div class="group-title">Điều chỉnh màu</div>
      ${field('brightness', 'Độ sáng', range('brightness', -100, 100, 1, c.brightness || 0), c.brightness || 0)}
      ${field('contrast', 'Tương phản', range('contrast', -100, 100, 1, c.contrast || 0), c.contrast || 0)}
      ${field('saturation', 'Bão hòa', range('saturation', -100, 100, 1, c.saturation || 0), c.saturation || 0)}
      <div class="row">${field('fadeIn', 'Mờ vào (s)', num('fadeIn', 0, 5, 0.1, c.fadeIn || 0))}${field('fadeOut', 'Mờ ra (s)', num('fadeOut', 0, 5, 0.1, c.fadeOut || 0))}</div>
      <button data-act="reset">Đặt lại màu & hiệu ứng</button>
      ${!img && m.hasAudio ? `<div class="group-title">Âm thanh</div>
        <button data-act="detach" class="primary" style="width:100%">♪ Tách âm thanh</button>
        <button data-act="sep" style="width:100%;margin-top:8px">🎤 Tách beat (MR) – bỏ giọng hát</button>` : ''}`;
  } else if (track === 'text') {
    $('#propTitle').textContent = 'Văn bản';
    box.innerHTML = `
      ${field('text', 'Nội dung', `<textarea data-k="text">${esc(c.text)}</textarea>`)}
      <div class="row">${field('font', 'Phông', `<select data-k="font">${FONTS.map(f => `<option ${c.font === f ? 'selected' : ''}>${f}</option>`).join('')}</select>`)}
        ${field('color', 'Màu', `<input type="color" data-k="color" value="${c.color}">`)}</div>
      ${field('fontSize', 'Cỡ chữ', range('fontSize', 16, 300, 1, c.fontSize), c.fontSize)}
      <div class="seg" style="margin-bottom:12px"><button data-toggle="bold" class="${c.bold ? 'on' : ''}"><b>B</b> Đậm</button><button data-toggle="bg" class="${c.bg ? 'on' : ''}">▇ Nền</button></div>
      <div class="row">${field('strokeWidth', 'Viền', range('strokeWidth', 0, 20, 1, c.strokeWidth), c.strokeWidth)}
        ${field('strokeColor', 'Màu viền', `<input type="color" data-k="strokeColor" value="${c.strokeColor}">`)}</div>
      ${c.bg ? field('bgColor', 'Màu nền', `<input type="color" data-k="bgColor" value="${c.bgColor.slice(0, 7)}">`) : ''}
      <div class="group-title">Vị trí & thời gian</div>
      ${field('x', 'Ngang', range('x', 0, 1, 0.005, c.x), Math.round(c.x * 100) + '%')}
      ${field('y', 'Dọc', range('y', 0, 1, 0.005, c.y), Math.round(c.y * 100) + '%')}
      <div class="row">${field('start', 'Bắt đầu (s)', num('start', 0, 36000, 0.1, c.start))}${field('duration', 'Thời lượng (s)', num('duration', 0.1, 36000, 0.1, c.duration))}</div>`;
  } else {
    const m = mediaById(c.mediaId);
    $('#propTitle').textContent = 'Âm thanh';
    box.innerHTML = `
      <div class="info">${esc(m.name)} · gốc ${fmt(m.duration)}${m.type === 'video' ? '<br>(chỉ lấy tiếng từ video)' : ''}</div>
      ${field('volume', 'Âm lượng', range('volume', 0, 2, 0.05, c.volume), Math.round(c.volume * 100) + '%')}
      ${speedSection(c, false)}
      <div class="row">${field('start', 'Vị trí (s)', num('start', 0, 36000, 0.1, c.start))}${field('in', 'Cắt đầu (s)', num('in', 0, m.duration, 0.1, c.in))}</div>
      <div class="row">${field('fadeIn', 'Mờ vào (s)', num('fadeIn', 0, 10, 0.1, c.fadeIn))}${field('fadeOut', 'Mờ ra (s)', num('fadeOut', 0, 10, 0.1, c.fadeOut))}</div>
      <div class="info">Âm lượng trên 100% chỉ có tác dụng khi xuất video.</div>
      ${m.mrOf || m.vocalsOf ? '' : `<div class="group-title">Beat / MR</div>
        <button data-act="sep" class="primary" style="width:100%">🎤 Tách beat (MR) – bỏ giọng hát</button>
        <div class="info" style="margin-top:6px">AI tách giọng hát ra; clip này sẽ chuyển sang bản beat (MR). File giọng hát riêng cũng được lưu trong thư viện.</div>`}`;
  }
}

function applyProp(k, raw) {
  if (!ui.sel) {
    if (k === 'fps') P.fps = +raw;
    return;
  }
  const { track } = ui.sel; const c = findClip(track, ui.sel.id); if (!c) return;
  const m = c.mediaId ? mediaById(c.mediaId) : null;
  const v = typeof c[k] === 'string' || ['text', 'font', 'color', 'strokeColor', 'bgColor'].includes(k) ? raw : +raw;
  if (typeof v === 'number' && !Number.isFinite(v)) return;
  switch (k) {
    case 'dur': c.out = c.in + Math.max(MIN_CLIP, v); break;
    case 'in':
      if (track === 'main') c.in = clamp(v, 0, c.out - MIN_CLIP);
      else { const d = clamp(v, 0, c.out - MIN_CLIP) - c.in; c.in += d; }
      break;
    case 'out': c.out = clamp(v, c.in + MIN_CLIP, m.duration); break;
    case 'duration': c.duration = Math.max(MIN_CLIP, v); break;
    case 'start': c.start = Math.max(0, v); break;
    case 'fadeIn': case 'fadeOut': c[k] = Math.max(0, v); break;
    case 'bgColor': c.bgColor = raw + 'cc'; break;
    case 'speedLog': { const sp = 10 ** v; c.speed = Math.abs(Math.log10(sp)) < 0.015 ? 1 : +sp.toFixed(2); delete c.curve; break; }
    default: c[k] = v;
  }
}
$('#props').addEventListener('input', e => {
  const k = e.target.dataset.k; if (!k) return;
  if (!ui.editing) { commit(); ui.editing = true; }
  applyProp(k, e.target.value);
  const o = $(`output[data-out="${k}"]`);
  if (o) o.textContent = ['volume', 'x', 'y', 'scale', 'opacity'].includes(k) ? Math.round(e.target.value * 100) + '%'
    : k === 'speed' ? e.target.value + 'x' : k === 'rotation' ? e.target.value + '°'
    : k === 'speedLog' ? fmtSp(findClip(ui.sel.track, ui.sel.id).speed) : e.target.value;
  if (k === 'speedLog') { const inf = $('#spdInfo'); if (inf) inf.innerHTML = speedInfo(findClip(ui.sel.track, ui.sel.id)); }
  ui.dirty = true; renderTimeline(); autosave();
});
$('#props').addEventListener('change', e => {
  if (!e.target.dataset.k) return;
  if (!ui.editing) { commit(); applyProp(e.target.dataset.k, e.target.value); }
  ui.editing = false;
  if (e.target.type === 'number' || e.target.tagName === 'SELECT') renderProps();
  changed(false); updateButtons();
});
$('#props').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.ratio) { commit(); setRatio(b.dataset.ratio); return changed(); }
  const c = ui.sel && findClip(ui.sel.track, ui.sel.id); if (!c) return;
  if (b.dataset.act === 'detach') return detachAudio(c);
  if (b.dataset.act === 'mp3') return extractMp3(mediaById(c.mediaId));
  if (b.dataset.act === 'sep') return sepForClip(ui.sel.track, c);
  if (b.dataset.sptab) { ui.spTab = b.dataset.sptab; return renderProps(); }
  commit();
  if (b.dataset.sp) { c.speed = +b.dataset.sp; delete c.curve; }
  if (b.dataset.curve) {
    if (b.dataset.curve === 'none') delete c.curve;
    else { const cv = CURVES.find(x => x.id === b.dataset.curve); c.curve = { id: cv.id, name: cv.name, pts: cv.pts.map(p => [...p]) }; }
  }
  if (b.dataset.act === 'pitch') c.keepPitch = c.keepPitch === false;
  if (b.dataset.smooth) c.smooth = b.dataset.smooth;
  if (b.dataset.fit) c.fit = b.dataset.fit;
  if (b.dataset.toggle) c[b.dataset.toggle] = !c[b.dataset.toggle];
  if (b.dataset.act === 'reset') Object.assign(c, { brightness: 0, contrast: 0, saturation: 0, fadeIn: 0, fadeOut: 0 });
  if (b.dataset.act === 'ovFull') Object.assign(c, { x: 0.5, y: 0.5, scale: 1, rotation: 0 });
  if (b.dataset.act === 'ovReset') Object.assign(c, { x: 0.72, y: 0.28, scale: 0.4, rotation: 0 });
  if (b.dataset.act === 'ovUp' || b.dataset.act === 'ovDown') {
    const arr = P.tracks.overlay, i = arr.indexOf(c), j = clamp(i + (b.dataset.act === 'ovUp' ? 1 : -1), 0, arr.length - 1);
    arr.splice(i, 1); arr.splice(j, 0, c);
  }
  changed();
});

// ------------------------------------------------------------------ project / export
$('#projName').addEventListener('change', e => { commit(); P.name = e.target.value.trim() || 'Dự án mới'; changed(false); });

function modal(title, html) {
  $('#modalTitle').textContent = title; $('#modalBody').innerHTML = html; $('#modal').classList.remove('hidden');
}
const closeModal = () => { $('#modal').classList.add('hidden'); modal.onClose?.(); modal.onClose = null; };
$('#modalClose').addEventListener('click', closeModal);

async function saveProject() {
  try { const r = await api('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project: P }) }); toast(`Đã lưu "${r.name}"`); }
  catch (e) { toast('Lỗi lưu: ' + e.message, 4000); }
}
async function openProject() {
  try {
    const list = await api('/api/projects');
    modal('Mở dự án', list.length ? list.map(p => `<div class="proj-item" data-name="${esc(p.name)}"><span>${esc(p.name)}</span><span class="dim">${new Date(p.mtime * 1000).toLocaleString()}</span></div>`).join('') : '<div class="dim">Chưa có dự án nào được lưu.</div>');
  } catch (e) { toast('Lỗi: ' + e.message); }
}
$('#modalBody').addEventListener('click', async e => {
  const it = e.target.closest('.proj-item'); if (!it) return;
  try {
    const p = await api('/api/projects/' + encodeURIComponent(it.dataset.name));
    commit(); P = normalizeProject(p); ui.sel = null; ui.playhead = 0; closeModal(); loadProjectUI(); toast('Đã mở dự án');
    pruneMissingMedia();
  } catch (err) { toast('Lỗi: ' + err.message); }
});
function loadProjectUI() {
  if (ui.playing) setPlaying(false);
  $('#projName').value = P.name; resizeCanvas(); changed();
}

// Bản sao dự án đã áp nút 👁/🔊 của từng track (track tắt tiếng -> volume 0, track ẩn -> không vẽ hình)
function exportProject() {
  const q = JSON.parse(JSON.stringify(P));
  for (const t of ['main', 'overlay', 'audio']) if (trackMuted(t)) q.tracks[t].forEach(c => { c.volume = 0; });
  for (const t of ['main', 'overlay']) if (trackHidden(t)) q.tracks[t].forEach(c => { c.hidden = true; });
  if (trackHidden('text')) q.tracks.text = [];
  for (const t of ['main', 'overlay', 'audio']) q.tracks[t].forEach(c => {
    if (c.curve) c.segs = speedSegs(c).map(g => [g.a - c.in, g.b - c.in, g.s]);
  });
  const f = activeFilter();
  q.filterMatrix = f ? filterMatrix(f, P.filter.intensity) : null;
  return q;
}
async function exportVideo() {
  if (ui.playing) setPlaying(false);
  const total = totalDuration();
  if (total <= 0.05) return toast('Timeline đang trống');
  // render từng lớp chữ thành PNG trong suốt -> ffmpeg overlay (giữ đúng phông/hiệu ứng như preview)
  const overlays = (trackHidden('text') ? [] : P.tracks.text).filter(c => c.text.trim()).map(c => {
    const cv = document.createElement('canvas'); cv.width = P.width; cv.height = P.height;
    drawText(cv.getContext('2d'), c, P.width, P.height);
    return { png: cv.toDataURL('image/png'), start: c.start, end: c.start + c.duration };
  });
  modal('Xuất video', `<div>Đang xuất ${P.width}×${P.height} · ${P.fps}fps · ${fmt(total)}</div>
    <div class="progress"><div id="expBar"></div></div><div id="expMsg" class="dim">Đang chuẩn bị…</div>
    <div style="margin-top:12px;text-align:right"><button id="expCancel">Hủy</button></div>`);
  let job;
  try {
    job = await api('/api/export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project: exportProject(), overlays }) });
  } catch (e) { $('#expMsg').innerHTML = `<div class="err">${esc(e.message)}</div>`; return; }
  let stop = false;
  modal.onClose = () => { stop = true; };
  $('#expCancel').onclick = async () => { await api(`/api/export/${job.jobId}/cancel`, { method: 'POST' }).catch(() => {}); };
  while (!stop) {
    await new Promise(r => setTimeout(r, 500));
    let s; try { s = await api('/api/export/' + job.jobId); } catch { continue; }
    const bar = $('#expBar'); if (!bar) break;
    bar.style.width = (s.progress * 100).toFixed(1) + '%';
    if (s.status === 'running') $('#expMsg').textContent = `Đang xuất… ${(s.progress * 100).toFixed(0)}%`;
    else if (s.status === 'done') {
      $('#expMsg').innerHTML = `✅ Xong!<br><span class="dim" style="word-break:break-all">${esc(s.path)}</span>
        <div style="margin-top:10px"><a href="${s.url}" download><button class="primary">Tải xuống</button></a></div>`;
      $('#expCancel').remove(); break;
    } else if (s.status === 'cancelled') { $('#expMsg').textContent = 'Đã hủy.'; $('#expCancel').remove(); break; }
    else if (s.status === 'error') { $('#expMsg').innerHTML = `<div class="err">${esc(s.error)}</div>`; $('#expCancel').remove(); break; }
  }
}

// ------------------------------------------------------------------ buttons / keyboard / drop
$('#btnPlay').onclick = () => setPlaying(!ui.playing);
$('#btnStart').onclick = () => seek(0);
$('#btnEnd').onclick = () => seek(totalDuration());
$('#btnSplit').onclick = splitAtPlayhead;
$('#btnDel').onclick = deleteSelected;
$('#btnDup').onclick = duplicateSelected;
$('#btnUndo').onclick = undo;
$('#btnRedo').onclick = redo;
$('#btnSave').onclick = saveProject;
$('#btnOpen').onclick = openProject;
$('#btnExport').onclick = exportVideo;
$('#btnNew').onclick = () => {
  if (!confirm('Tạo dự án mới? (Dự án hiện tại nên được Lưu trước)')) return;
  commit(); P = newProject(); ui.sel = null; ui.playhead = 0; loadProjectUI();
};

document.addEventListener('keydown', e => {
  const tag = e.target.tagName;
  const typing = tag === 'TEXTAREA' || (tag === 'INPUT' && !['range', 'color'].includes(e.target.type)) || tag === 'SELECT';
  const k = e.key.toLowerCase(), mod = e.ctrlKey || e.metaKey;
  if (mod && k === 's') { e.preventDefault(); return saveProject(); }
  if (typing) return;
  if (mod && k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
  else if (mod && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); redo(); }
  else if (mod && k === 'd') { e.preventDefault(); duplicateSelected(); }
  else if (k === ' ') { e.preventDefault(); setPlaying(!ui.playing); }
  else if (k === 's') splitAtPlayhead();
  else if (k === 'delete' || k === 'backspace') { e.preventDefault(); deleteSelected(); }
  else if (k === 'arrowleft') { e.preventDefault(); seek(ui.playhead - (e.shiftKey ? 1 : 1 / P.fps)); }
  else if (k === 'arrowright') { e.preventDefault(); seek(ui.playhead + (e.shiftKey ? 1 : 1 / P.fps)); }
  else if (k === 'home') seek(0);
  else if (k === 'end') seek(totalDuration());
  else if (k === 'escape') { if (!$('#modal').classList.contains('hidden')) closeModal(); else if (ui.sel) { ui.sel = null; changed(); } }
});

let dragDepth = 0;
const hasFiles = e => [...(e.dataTransfer?.types || [])].includes('Files');
window.addEventListener('dragenter', e => { if (hasFiles(e)) { dragDepth++; $('#dropOverlay').classList.remove('hidden'); } });
window.addEventListener('dragleave', e => { if (hasFiles(e) && --dragDepth <= 0) { dragDepth = 0; $('#dropOverlay').classList.add('hidden'); } });
window.addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });
window.addEventListener('drop', e => {
  if (!hasFiles(e)) return;
  e.preventDefault(); dragDepth = 0; $('#dropOverlay').classList.add('hidden');
  uploadFiles([...e.dataTransfer.files]);
});
window.addEventListener('beforeunload', () => { try { if (autosaveKey) localStorage.setItem(autosaveKey, JSON.stringify(P)); } catch { /* bỏ qua */ } });

// ------------------------------------------------------------------ giao diện điện thoại / màn hình nhỏ
const isMobile = () => matchMedia('(max-width: 768px)').matches;
function openSheet(which) { // 'left' (Media/Văn bản/Bộ lọc) | 'right' (Chỉnh sửa) | null
  document.body.classList.toggle('sheet-left', which === 'left');
  document.body.classList.toggle('sheet-right', which === 'right');
  document.querySelectorAll('#mnav button').forEach(b => {
    const tab = document.querySelector('.tab.active')?.dataset.tab;
    b.classList.toggle('on', (which === 'right' && b.dataset.m === 'props') || (which === 'left' && b.dataset.m === tab));
  });
}
$('#mnav').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  const m = b.dataset.m;
  if (m === 'props') return openSheet(document.body.classList.contains('sheet-right') ? null : 'right');
  const curTab = document.querySelector('.tab.active')?.dataset.tab;
  if (document.body.classList.contains('sheet-left') && curTab === m) return openSheet(null);
  document.querySelector(`.tab[data-tab="${m}"]`).click();
  openSheet('left');
});
document.querySelectorAll('.sheet-close').forEach(b => b.addEventListener('click', () => openSheet(null)));
$('#btnMore').addEventListener('click', e => { e.stopPropagation(); document.body.classList.toggle('more-open'); });
document.addEventListener('click', e => {
  if (document.body.classList.contains('more-open') && !e.target.closest('#btnMore')) document.body.classList.remove('more-open');
});
matchMedia('(max-width: 768px)').addEventListener('change', ev => { if (!ev.matches) openSheet(null); resizeCanvas(); renderTimeline(); });

// ------------------------------------------------------------------ boot
async function boot() {
  try {
    const account = await api('/api/account');
    autosaveKey = `vedit.autosave.${account.id}`;
    loadAutosave();
    renderTextPresets();
    loadProjectUI();
    pruneMissingMedia();
    requestAnimationFrame(loop);
  } catch {
    toast('Đăng nhập Google để sử dụng Vedit miễn phí.', 10000);
  }
}
boot();
