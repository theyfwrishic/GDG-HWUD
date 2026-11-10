/* Phone camera -> YOLOv8 (ONNX, runs in the browser) -> people waiting in the area -> status. */
const CFG = {
  modelUrl: 'models/yolov8n.onnx',
  inputSize: +(new URLSearchParams(location.search).get('size') || 640), // use ?size=416 if you exported at 416
  iou: 0.5,
  logEverySec: 30,
};
const $ = id => document.getElementById(id);
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};
const DEFAULT_ZONE = [[0.05, 0.35], [0.95, 0.35], [0.95, 0.98], [0.05, 0.98]];
const S = Object.assign({ stop: 'Shuttle stop', cap: 30, busy: 50, dispatch: 70, smooth: 20, conf: 35,
                          report: '', facing: 'environment', zone: DEFAULT_ZONE }, store.get('settings', {}));
const save = () => store.set('settings', S);

const video = $('video'), ovl = $('ovl'), octx = ovl.getContext('2d');
const work = document.createElement('canvas'); work.width = work.height = CFG.inputSize;
const wctx = work.getContext('2d', { willReadFrequently: true });
const smoother = new Core.Smoother();
let session = null, stream = null, running = false, editing = false, drag = -1, wake = null;
let dets = [], raw = 0, smooth = 0, fps = 0, lastLog = 0, logRows = store.get('log', []);

const MSG = {
  calm: ['Calm', 'Current shuttles can handle the crowd.'],
  busy: ['Getting busy', 'Keep an eye on the stop.'],
  dispatch: ['Send an extra shuttle', 'The waiting crowd is more than one shuttle can comfortably take.'],
};
const setMsg = t => { $('msg').textContent = t || ''; $('msg').style.display = t ? 'flex' : 'none'; };

// ---------- drawing ----------
function draw() {
  const w = ovl.width, h = ovl.height;
  octx.clearRect(0, 0, w, h);
  if (!w) return;
  const k = Math.max(2, w / 260), z = S.zone.map(([x, y]) => [x * w, y * h]);
  octx.beginPath(); z.forEach(([x, y], i) => i ? octx.lineTo(x, y) : octx.moveTo(x, y)); octx.closePath();
  octx.fillStyle = 'rgba(255,199,44,.22)'; octx.fill();
  octx.strokeStyle = '#FFC72C'; octx.lineWidth = k * 1.5; octx.stroke();
  for (const d of dets) {
    const inside = Core.inPolygon((d.x1 + d.x2) / 2 / w, d.y2 / h, S.zone);
    octx.strokeStyle = inside ? '#E8A900' : '#FFF6DC'; octx.lineWidth = inside ? k * 1.5 : k * .6;
    octx.strokeRect(d.x1, d.y1, d.x2 - d.x1, d.y2 - d.y1);
  }
  if (editing) for (const [x, y] of z) {
    octx.beginPath(); octx.arc(x, y, k * 6, 0, 7); octx.fillStyle = '#3A2D05'; octx.fill();
    octx.strokeStyle = '#FFC72C'; octx.lineWidth = k * 1.5; octx.stroke();
  }
}

function render() {
  const st = Core.statusFor(smooth, S.cap, S.busy / 100, S.dispatch / 100), ratio = smooth / Math.max(S.cap, 1);
  $('num').textContent = smooth;
  $('status').className = 'status ' + (st === 'calm' ? '' : st);
  $('status').innerHTML = MSG[st][0] + '<small>' + MSG[st][1] + '</small>';
  $('shareK').textContent = 'Share of one shuttle (' + S.cap + ' seats)';
  $('share').textContent = Math.round(ratio * 100) + '%';
  $('bar').style.width = Math.min(ratio, 1) * 100 + '%';
  $('raw').textContent = raw;
  $('fps').textContent = fps ? fps.toFixed(1) + ' checks per second' : '';
  return st;
}

// ---------- logging / reporting ----------
async function logAndReport(st, now) {
  if (now - lastLog < CFG.logEverySec * 1000) return;
  lastLog = now;
  const row = [new Date().toISOString(), raw, smooth, st];
  logRows.push(row); logRows = logRows.slice(-5000); store.set('log', logRows);
  $('logCount').textContent = logRows.length + ' saved rows';
  if (S.report) {
    try {
      const r = await fetch(S.report, { method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: true,
        body: JSON.stringify({ stop: S.stop, timestamp: row[0], raw_count: raw, smoothed_count: smooth, status: st }) });
      $('reportState').textContent = r.ok ? 'Last report sent.' : 'Last report failed (' + r.status + ').';
    } catch { $('reportState').textContent = 'Last report failed. Check the address and that it allows requests from this page.'; }
  }
}

// ---------- detection ----------
async function detectOnce() {
  const vw = video.videoWidth, vh = video.videoHeight, N = CFG.inputSize, lb = Core.letterbox(vw, vh, N);
  wctx.fillStyle = '#727272'; wctx.fillRect(0, 0, N, N);
  wctx.drawImage(video, lb.padX, lb.padY, lb.nw, lb.nh);
  const input = new ort.Tensor('float32', Core.preprocess(wctx.getImageData(0, 0, N, N).data, N), [1, 3, N, N]);
  const out = await session.run({ [session.inputNames[0]]: input });
  const o = out[session.outputNames[0]];
  dets = Core.decodePerson(o.data, o.dims, lb, vw, vh, S.conf / 100, CFG.iou);
  raw = dets.filter(d => Core.inPolygon((d.x1 + d.x2) / 2 / vw, d.y2 / vh, S.zone)).length;
  const now = performance.now();
  smooth = smoother.add(raw, now, S.smooth * 1000);
  draw(); logAndReport(render(), now);
}

async function loop() {
  let prev = performance.now();
  while (running) {
    if (video.readyState >= 2 && video.videoWidth) {
      try { await detectOnce(); } catch (e) { setMsg('Detection error: ' + e.message); running = false; break; }
      const t = performance.now(); fps = fps ? fps * .8 + (1000 / (t - prev)) * .2 : 1000 / (t - prev); prev = t;
    }
    await new Promise(r => requestAnimationFrame(r));
  }
}

// ---------- camera ----------
async function keepAwake() {
  try { if ('wakeLock' in navigator) wake = await navigator.wakeLock.request('screen'); } catch { /* not allowed */ }
}
document.addEventListener('visibilitychange', () => { if (running && document.visibilityState === 'visible') keepAwake(); });

async function start() {
  if (!window.isSecureContext) { setMsg('The camera only works on https pages. Open the hosted https address.'); return; }
  $('start').disabled = true;
  try {
    if (!session) {
      setMsg('Loading the detection model…');
      session = await ort.InferenceSession.create(CFG.modelUrl, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
    }
  } catch (e) { setMsg('Could not load models/yolov8n.onnx. Export it and put it in the models folder (see README).'); $('start').disabled = false; return; }
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: false,
      video: { facingMode: { ideal: S.facing }, width: { ideal: 1280 }, height: { ideal: 720 } } });
  } catch (e) { setMsg('Camera blocked. Allow camera access for this site in the browser settings, then tap Start again.'); $('start').disabled = false; return; }
  video.srcObject = stream; await video.play();
  ovl.width = video.videoWidth; ovl.height = video.videoHeight;
  setMsg(''); running = true; $('start').textContent = 'Stop camera'; $('start').disabled = false;
  keepAwake(); loop();
}

function stop() {
  running = false; stream && stream.getTracks().forEach(t => t.stop()); stream = null; video.srcObject = null;
  if (wake) { wake.release().catch(() => {}); wake = null; }
  dets = []; draw(); $('start').textContent = 'Start camera'; setMsg('Camera stopped.');
}
$('start').onclick = () => running ? stop() : start();

// ---------- waiting-area editing ----------
const norm = e => { const r = ovl.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height, r }; };
ovl.addEventListener('pointerdown', e => {
  if (!editing) return;
  const p = norm(e); let best = -1, bd = 40;
  S.zone.forEach(([x, y], i) => { const d = Math.hypot((p.x - x) * p.r.width, (p.y - y) * p.r.height); if (d < bd) { bd = d; best = i; } });
  drag = best; if (drag >= 0) ovl.setPointerCapture(e.pointerId);
});
ovl.addEventListener('pointermove', e => {
  if (drag < 0) return;
  const p = norm(e); S.zone[drag] = [Math.min(1, Math.max(0, p.x)), Math.min(1, Math.max(0, p.y))]; draw();
});
ovl.addEventListener('pointerup', () => { if (drag >= 0) { drag = -1; save(); } });
$('edit').onclick = () => {
  editing = !editing; $('edit').textContent = editing ? 'Done editing' : 'Edit waiting area';
  ovl.style.touchAction = editing ? 'none' : 'auto'; draw();
  if (editing && !running) setMsg('Start the camera, then drag the four corners onto the waiting area.');
};
$('reset').onclick = () => { S.zone = DEFAULT_ZONE.map(p => [...p]); save(); draw(); };
video.addEventListener('loadedmetadata', () => { ovl.width = video.videoWidth; ovl.height = video.videoHeight; draw(); });

// ---------- settings & log ----------
const FIELDS = { stop: 'stop', cap: 'cap', busy: 'busy', dispatch: 'dispatch', smooth: 'smooth', conf: 'conf', report: 'report', facing: 'facing' };
for (const [id, key] of Object.entries(FIELDS)) {
  const el = $(id); el.value = S[key];
  el.onchange = () => {
    S[key] = typeof S[key] === 'number' ? (+el.value || 0) : el.value.trim(); save(); render();
    if (key === 'facing' && running) { stop(); start(); }
  };
}
$('download').onclick = () => {
  const csv = 'timestamp,raw_count,smoothed_count,status\n' + logRows.map(r => r.join(',')).join('\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = 'shuttle_counts.csv'; a.click();
};
$('clearLog').onclick = () => { logRows = []; store.set('log', []); $('logCount').textContent = '0 saved rows'; };
$('logCount').textContent = logRows.length + ' saved rows';
render(); setMsg('Tap Start camera and allow camera access.');
