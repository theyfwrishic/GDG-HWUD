/* Live map: Google Maps + bus marker. Demo bus by default; real bus when a feed address is set. */
const $ = id => document.getElementById(id);
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};
const M = Object.assign({ key: '', name: 'Shuttle stop', lat: 25.2048, lng: 55.2708, feed: '' }, store.get('map', {}));
const SPEED_MS = 20 / 3.6, STALE_S = 30, T0 = Date.now();
const STYLE = [
  { elementType: 'geometry', stylers: [{ color: '#FFF6DC' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#3A2D05' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#FFF6DC' }] },
  { featureType: 'poi.business', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'landscape.man_made', elementType: 'geometry', stylers: [{ color: '#FBEBB8' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#FFFDF5' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#F0D27A' }] },
  { featureType: 'road.arterial', elementType: 'geometry', stylers: [{ color: '#FFE9A3' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#FFC72C' }] },
  { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#E8A900' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#CFE3E8' }] },
];
const BUS_SVG = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="46" height="46" viewBox="0 0 46 46">' +
  '<circle cx="23" cy="23" r="21" fill="#FFC72C" stroke="#3A2D05" stroke-width="3"/>' +
  '<rect x="10" y="12" width="26" height="19" rx="4" fill="#3A2D05"/>' +
  '<rect x="13" y="15" width="8" height="7" rx="1" fill="#FFF6DC"/><rect x="25" y="15" width="8" height="7" rx="1" fill="#FFF6DC"/>' +
  '<circle cx="16" cy="33" r="3" fill="#3A2D05"/><circle cx="30" cy="33" r="3" fill="#3A2D05"/></svg>');

// ---------- geometry (demo bus) ----------
const hav = (a, b, c, d) => {
  const r = 6371000, p1 = a * Math.PI / 180, p2 = c * Math.PI / 180, dp = p2 - p1, dl = (d - b) * Math.PI / 180;
  const x = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(x));
};
let routePts = [];
function buildRoute() {
  routePts = [[0, -.004], [.006, -.004], [.006, .004], [0, .004], [0, -.004]].map(([a, b]) => [M.lat + a, M.lng + b]);
}
function along(dist) {
  const segs = routePts.slice(1).map((p, i) => hav(...routePts[i], ...p)), total = segs.reduce((a, b) => a + b);
  dist %= total;
  for (let i = 0; i < segs.length; i++) {
    if (dist <= segs[i]) {
      const f = dist / segs[i], a = routePts[i], b = routePts[i + 1];
      return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
    }
    dist -= segs[i];
  }
  return routePts[0];
}

// ---------- bus source ----------
async function getBus() {
  if (!M.feed) { const [lat, lng] = along((Date.now() - T0) / 1000 * SPEED_MS); return { lat, lng, speed: 20, age: 0, demo: true }; }
  const url = /\.json/.test(M.feed) ? M.feed : M.feed.replace(/\/+$/, '') + '/bus/pos.json';  // a Firebase database address is enough
  const d = await (await fetch(url, { cache: 'no-store' })).json();
  if (!d || d.lat == null || d.lng == null) return null;
  return { lat: +d.lat, lng: +d.lng, speed: d.speed_kmh ?? null, age: d.ts ? Math.max(0, (Date.now() - d.ts) / 1000) : 0, demo: false };
}

// ---------- map ----------
let map, bus, anim, first = true, last = null;
const chip = (t, c) => { $('chip').textContent = t; $('chip').className = c || ''; };
const msg = t => { $('mapMsg').textContent = t || ''; $('mapMsg').style.display = t ? 'flex' : 'none'; };
window.gm_authFailure = () => { msg('Google rejected the API key. Check that “Maps JavaScript API” is enabled for it.'); chip('Map key problem', 'err'); };

window.initMap = () => {
  msg('');
  const stop = { lat: M.lat, lng: M.lng };
  map = new google.maps.Map($('map'), { center: stop, zoom: 15, styles: STYLE, disableDefaultUI: true, zoomControl: true, gestureHandling: 'greedy' });
  new google.maps.Marker({ position: stop, map, title: M.name,
    icon: { path: google.maps.SymbolPath.CIRCLE, scale: 13, fillColor: '#3A2D05', fillOpacity: 1, strokeColor: '#FFC72C', strokeWeight: 4 },
    label: { text: 'S', color: '#FFC72C', fontWeight: '800' } });
  if (!M.feed) new google.maps.Polyline({ map, strokeColor: '#E8A900', strokeOpacity: .9, strokeWeight: 5,
    path: routePts.map(p => ({ lat: p[0], lng: p[1] })) });
  bus = new google.maps.Marker({ map, title: 'Shuttle bus', zIndex: 10, visible: false,
    icon: { url: BUS_SVG, scaledSize: new google.maps.Size(46, 46), anchor: new google.maps.Point(23, 23) } });
  $('center').onclick = () => { if (bus.getPosition()) map.panTo(bus.getPosition()); };
  tick(); setInterval(tick, M.feed ? 4000 : 2000);
};

function moveTo(lat, lng) {
  bus.setVisible(true);
  const from = bus.getPosition();
  if (!from) { bus.setPosition({ lat, lng }); return; }
  const a = [from.lat(), from.lng()], t0 = performance.now(), dur = 1800;
  cancelAnimationFrame(anim);
  (function step(t) {
    const k = Math.min((t - t0) / dur, 1);
    bus.setPosition({ lat: a[0] + (lat - a[0]) * k, lng: a[1] + (lng - a[1]) * k });
    if (k < 1) anim = requestAnimationFrame(step);
  })(t0);
}

async function tick() {
  try {
    const b = await getBus();
    if (!b) { chip('Waiting for the first bus signal…'); $('dist').textContent = '–'; $('eta').textContent = ''; return; }
    last = b; moveTo(b.lat, b.lng);
    if (first) { const bd = new google.maps.LatLngBounds({ lat: M.lat, lng: M.lng }); bd.extend({ lat: b.lat, lng: b.lng }); map.fitBounds(bd, 70); first = false; }
    const stale = b.age > STALE_S;
    chip(b.demo ? 'Demo bus (simulated)' : stale ? 'No signal for ' + Math.round(b.age) + ' s' : 'Bus live, updated ' + Math.round(b.age) + ' s ago', b.demo ? 'live' : stale ? 'stale' : 'live');
    const d = hav(b.lat, b.lng, M.lat, M.lng), sp = (b.speed || 0) >= 5 ? b.speed : 20, mins = Math.max(1, Math.ceil(d / (sp / 3.6) / 60));
    $('dist').textContent = d < 1000 ? Math.round(d) + ' m' : (d / 1000).toFixed(1) + ' km';
    $('eta').textContent = stale ? 'Last known position.' : d < 60 ? 'At the stop' : 'About ' + mins + ' min away (straight-line estimate)';
  } catch { chip('Can’t reach the bus feed. Check the address in Settings.', 'err'); }
}

// ---------- settings ----------
for (const f of ['key', 'name', 'lat', 'lng', 'feed']) $(f).value = M[f];
$('source').textContent = M.feed ? 'Live bus feed (a phone sharing its location): ' + M.feed : 'Demo bus. It drives a loop around the stop. Add a live feed address in Settings to track a real bus.';
$('here').onclick = () => {
  $('hereMsg').textContent = 'Finding your location…';
  navigator.geolocation.getCurrentPosition(
    p => { $('lat').value = p.coords.latitude.toFixed(6); $('lng').value = p.coords.longitude.toFixed(6);
           $('hereMsg').textContent = 'Location filled in (accurate to about ' + Math.round(p.coords.accuracy) + ' m). Tap Save.'; },
    () => { $('hereMsg').textContent = 'Could not get your location. Allow location access, or type the coordinates.'; },
    { enableHighAccuracy: true, timeout: 15000 });
};
$('save').onclick = () => {
  const lat = parseFloat($('lat').value), lng = parseFloat($('lng').value);
  if (!(lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180)) { $('hereMsg').textContent = 'Latitude and longitude must be numbers.'; return; }
  store.set('map', { key: $('key').value.trim(), name: $('name').value.trim() || 'Shuttle stop', lat, lng, feed: $('feed').value.trim() });
  location.reload();
};

buildRoute();
if (M.key) {
  const s = document.createElement('script');
  s.src = 'https://maps.googleapis.com/maps/api/js?key=' + encodeURIComponent(M.key) + '&callback=initMap';
  s.async = true; s.onerror = () => msg('Could not load Google Maps. Check your internet connection.');
  document.head.appendChild(s);
} else { chip('Needs an API key'); $('settings').open = true; }
