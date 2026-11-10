/* Driver phone: share GPS position to a Firebase Realtime Database every few seconds. */
const $ = id => document.getElementById(id);
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};
const D = Object.assign({ db: '', code: '' }, store.get('driver', {}));
const EVERY_MS = 3000;
let watchId = null, lastSent = 0, lastOk = 0, wake = null;

const dbUrl = () => D.db.replace(/\/+$/, '').replace(/\/bus(\.json)?$/, '') + '/bus.json';
const setErr = t => { $('err').textContent = t || ''; };

async function keepAwake() { try { if ('wakeLock' in navigator) wake = await navigator.wakeLock.request('screen'); } catch { /* not allowed */ } }
document.addEventListener('visibilitychange', () => { if (watchId !== null && document.visibilityState === 'visible') keepAwake(); });

async function send(c) {
  const pos = { lat: c.latitude, lng: c.longitude, ts: Date.now() };
  if (c.speed != null && !isNaN(c.speed)) pos.speed_kmh = Math.round(c.speed * 3.6 * 10) / 10;
  if (c.heading != null && !isNaN(c.heading)) pos.heading = Math.round(c.heading);
  try {
    const r = await fetch(dbUrl(), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: D.code, pos }) });
    if (r.ok) { lastOk = Date.now(); setErr(''); }
    else if (r.status === 401 || r.status === 403) setErr('Firebase refused the position. Check that the share code matches the one in your Firebase rules.');
    else if (r.status === 404) setErr('Database address not found. Check the address in Settings.');
    else setErr('Could not send the position (error ' + r.status + ').');
  } catch { setErr('No internet connection. Will keep trying.'); }
}

function onPos(p) {
  const c = p.coords;
  $('gps').textContent = '±' + Math.round(c.accuracy) + ' m, ' + (c.speed != null ? Math.round(c.speed * 3.6) + ' km/h' : 'speed unknown');
  if (Date.now() - lastSent < EVERY_MS) return;
  lastSent = Date.now(); send(c);
}
function onGeoErr(e) {
  setErr(e.code === 1 ? 'Location is blocked. Allow location for this site in the browser settings, then tap Start again.'
                      : 'Could not get a GPS position yet. Go outside or near a window and wait a moment.');
}

function start() {
  if (!window.isSecureContext) { setErr('Location only works on https pages. Open the hosted https address.'); return; }
  if (!D.db || !D.code) { setErr('Add the Firebase address and share code in Settings first.'); $('settings').open = true; return; }
  setErr(''); watchId = navigator.geolocation.watchPosition(onPos, onGeoErr, { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 });
  keepAwake(); $('go').textContent = 'Stop sharing'; $('go').className = 'on'; $('state').textContent = 'Sharing location';
}
function stop() {
  navigator.geolocation.clearWatch(watchId); watchId = null;
  if (wake) { wake.release().catch(() => {}); wake = null; }
  $('go').textContent = 'Start sharing'; $('go').className = ''; $('state').textContent = 'Not sharing';
}
$('go').onclick = () => watchId === null ? start() : stop();

setInterval(() => { $('sent').textContent = lastOk ? Math.round((Date.now() - lastOk) / 1000) + ' s ago' : '–'; }, 1000);
$('db').value = D.db; $('code').value = D.code;
$('save').onclick = () => { D.db = $('db').value.trim(); D.code = $('code').value.trim(); store.set('driver', D); setErr(''); $('settings').open = false; };
if (!D.db || !D.code) $('settings').open = true;
