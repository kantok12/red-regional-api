"use strict";

const REFRESH_MS = 10000;
const STALE_SECONDS = 180;  // la API ya entrega posiciones con 60–90 s de atraso
const STOPS_MIN_ZOOM = 15;

// Animación entre actualizaciones: cada bus avanza por el trazado de su línea
// a su velocidad promedio de avance en los últimos minutos.
const ANIM = {
  frameMs: 66,          // ~15 cuadros por segundo
  defaultSpeed: 5.5,    // m/s mientras no hay 2 posiciones
  maxSpeed: 20,         // m/s; más que esto es ruido de GPS
  speedBoost: 1.15,     // algo más rápido que el promedio: mejor alcanzar que retroceder
  historyS: 180,        // ventana para el promedio de avance
  historyMax: 8,        // posiciones guardadas por bus
  maxExtrapolateS: 45,  // el GPS de cada bus se renueva cada ~30 s
  blendMs: 7000,        // tiempo para corregir hacia la posición real
  holdAheadM: 250,      // si va adelantado menos que esto, espera en vez de retroceder
  snapM: 1500,          // diferencias mayores se corrigen de golpe
  offRouteM: 100,       // más lejos del trazado: no se anima
};

const state = {
  network: null,
  routeStyles: new Map(),  // línea -> { bg, fg }
  vehicles: [],
  fetchedAt: null,         // hora (ms) de la última consulta del servidor a la API
  focusRoute: null,        // nombre de línea filtrada (ej. "602") o null
  selectedId: null,
  search: "",
  timer: null,
  nextRefreshAt: 0,
};

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[c]));
const byRouteName = (a, b) => a.localeCompare(b, "es", { numeric: true });

// ---------- Mapa ----------
const map = L.map("map", { zoomControl: true, preferCanvas: true });
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  className: "base-tiles",
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
}).addTo(map);

// Si la red usa el mismo color para casi todas sus líneas, se asigna uno de
// esta paleta para poder distinguirlas en el mapa.
const PALETTE = ["#e6194b", "#3cb44b", "#4363d8", "#f58231", "#911eb4", "#0f9fa8", "#d6338a",
  "#7a8f00", "#9a6324", "#800000", "#2f4f8f", "#008060", "#c06000", "#5b2c83", "#b8860b", "#1e7b9c"];

const shapeLayer = L.layerGroup().addTo(map);
const stopLayer = L.layerGroup();
const busLayer = L.layerGroup().addTo(map);
const markers = new Map();  // id -> { marker, iconKey, arrowEl }
const shapeGeo = new Map(); // routeKey -> geometría del trazado en metros
const motion = new Map();   // id de vehículo -> estado de la animación

map.on("zoomend", () => {
  if (map.getZoom() >= STOPS_MIN_ZOOM) stopLayer.addTo(map);
  else stopLayer.remove();
});

// ---------- API ----------
async function api(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

// ---------- Utilidades ----------
function ageSeconds(ts) {
  return ts ? Math.max(0, (Date.now() - Date.parse(ts)) / 1000) : Infinity;
}

function formatAge(sec) {
  if (!isFinite(sec)) return "—";
  if (sec < 60) return `${Math.round(sec)} s`;
  if (sec < 3600) return `${Math.floor(sec / 60)} min`;
  return `${Math.floor(sec / 3600)} h`;
}

function cardinal(deg) {
  if (deg == null) return "—";
  const dirs = ["N", "NE", "E", "SE", "S", "SO", "O", "NO"];
  return `${dirs[Math.round(deg / 45) % 8]} (${Math.round(deg)}°)`;
}

const directionLabel = (d) => (d === "I" ? "Ida" : d === "R" ? "Regreso" : d);

function routeStyle(name) {
  return state.routeStyles.get(name) || { bg: "#555", fg: "#fff" };
}

function matchesSearch(v) {
  const q = state.search.trim().toLowerCase();
  return !q || v.plate.toLowerCase().includes(q) || v.route.toLowerCase().includes(q);
}

function visibleVehicles() {
  return state.vehicles.filter((v) =>
    (!state.focusRoute || v.route === state.focusRoute) && matchesSearch(v));
}

// ---------- Red ----------
async function init() {
  setStatus("Descargando red de transporte (GTFS)…");
  try {
    state.network = await api("/api/network");
  } catch (err) {
    setStatus(`No se pudo cargar la red: ${err.message}`, true);
    return;
  }
  const { zone, routes, stops } = state.network;
  $("zoneName").textContent = zone.name;
  document.title = `${zone.name} en vivo`;

  assignColors(routes);
  for (const r of routes) {
    if (r.shape.length >= 2) shapeGeo.set(r.key, buildGeo(r.shape));
  }
  drawStops(stops);
  // Se parte en el centro de la ciudad: en Valparaíso la red llega hasta Quintero y Limache.
  map.setView(zone.center, 13);
  await refresh();
}

function assignColors(routes) {
  const names = [...new Set(routes.map((r) => r.route))].sort(byRouteName);
  const distinct = new Set(routes.map((r) => r.color.toLowerCase())).size;
  if (distinct < Math.min(names.length, 4)) {
    for (const r of routes) {
      r.color = PALETTE[names.indexOf(r.route) % PALETTE.length];
      r.textColor = "#ffffff";
    }
  }
  for (const r of routes) {
    if (!state.routeStyles.has(r.route)) state.routeStyles.set(r.route, { bg: r.color, fg: r.textColor });
  }
}

function drawStops(stops) {
  for (const s of stops) {
    L.circleMarker([s.lat, s.lon], {
      radius: 4, weight: 2, color: "#555", fillColor: "#fff", fillOpacity: 1,
    })
      .bindTooltip(esc(s.name))
      .on("click", (e) => openStop(s, e.latlng))
      .addTo(stopLayer);
  }
}

async function openStop(stop, latlng) {
  const popup = L.popup({ maxWidth: 320 })
    .setLatLng(latlng)
    .setContent(`<div class="stop-popup"><h3>${esc(stop.name)}</h3><span class="muted">Consultando llegadas…</span></div>`)
    .openOn(map);
  try {
    const info = await api(`/api/stops/${encodeURIComponent(stop.code)}`);
    const rows = info.predictions.map((p) => {
      const st = routeStyle(p.route);
      return `<tr>
        <td><span class="vehicle__badge" style="background:${esc(st.bg)};color:${esc(st.fg)}">${esc(p.route)}</span></td>
        <td>${esc(p.timeLabel)}</td>
        <td class="muted">${esc(p.distanceLabel || "")}</td>
        <td class="muted">${esc(p.plate || "")}</td></tr>`;
    }).join("");
    popup.setContent(`<div class="stop-popup">
      <h3>${esc(stop.name)} <span class="muted">· ${esc(stop.code)}</span></h3>
      ${rows ? `<table>${rows}</table>` : '<span class="muted">Sin buses próximos</span>'}
      ${info.events.length ? `<p class="muted">Reportes: ${info.events.map(esc).join(", ")}</p>` : ""}
    </div>`);
  } catch (err) {
    popup.setContent(`<div class="stop-popup"><h3>${esc(stop.name)}</h3><span class="muted">Error: ${esc(err.message)}</span></div>`);
  }
}

// ---------- Movimiento sobre el trazado ----------
// Los trazados se pasan a metros con una proyección equirectangular local, que
// a escala de ciudad es suficientemente precisa y muy barata de calcular.
function buildGeo(shape) {
  const kx = Math.cos(shape[0][0] * Math.PI / 180) * 111320;
  const ky = 110540;
  const xs = shape.map((p) => p[1] * kx);
  const ys = shape.map((p) => p[0] * ky);
  const cum = [0];
  for (let i = 1; i < shape.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]));
  }
  return { kx, ky, xs, ys, cum, total: cum[cum.length - 1] };
}

// Distancia recorrida (s) del punto más cercano del trazado y qué tan lejos está.
// Con `hint` se prefiere el tramo cercano a la posición anterior, para no saltar
// a otra pasada del trazado cuando este vuelve por la misma calle.
function project(geo, lat, lon, hint) {
  const px = lon * geo.kx, py = lat * geo.ky;
  let best = { s: 0, d: Infinity }, near = { s: 0, d: Infinity };
  for (let i = 0; i < geo.xs.length - 1; i++) {
    const ax = geo.xs[i], ay = geo.ys[i];
    const dx = geo.xs[i + 1] - ax, dy = geo.ys[i + 1] - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
    const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
    const s = geo.cum[i] + t * Math.sqrt(len2);
    if (d < best.d) best = { s, d };
    if (hint != null && s > hint - 300 && s < hint + 3000 && d < near.d) near = { s, d };
  }
  return near.d < 60 ? near : best;
}

function pointAt(geo, s) {
  let lo = 0, hi = geo.cum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (geo.cum[mid] <= s) lo = mid; else hi = mid;
  }
  const seg = geo.cum[hi] - geo.cum[lo];
  const t = seg ? (s - geo.cum[lo]) / seg : 0;
  const dx = geo.xs[hi] - geo.xs[lo], dy = geo.ys[hi] - geo.ys[lo];
  return {
    lat: (geo.ys[lo] + t * dy) / geo.ky,
    lon: (geo.xs[lo] + t * dx) / geo.kx,
    bearing: (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360,
  };
}

function displayS(m, now) {
  const elapsed = now - m.recvAt;
  const travel = m.speed * Math.min(elapsed / 1000, ANIM.maxExtrapolateS);
  const blend = m.offset * Math.max(0, 1 - elapsed / ANIM.blendMs);
  return Math.min(m.geo.total, Math.max(m.floorS, m.obsS + travel + blend));
}

// Se llama con cada foto nueva de la flota. Solo se reancla un bus cuando
// cambia su posición GPS (timestamp) o su recorrido.
function updateMotion(vehicles) {
  const now = performance.now();
  const seen = new Set();
  for (const v of vehicles) {
    seen.add(v.id);
    const geo = shapeGeo.get(v.routeKey);
    const prev = motion.get(v.id);
    const sameRoute = prev && prev.routeKey === v.routeKey;
    if (sameRoute && prev.obsTs === v.timestamp) continue;
    if (!geo || v.lat == null) { motion.delete(v.id); continue; }

    const p = project(geo, v.lat, v.lon, sameRoute ? prev.obsS : null);
    if (p.d > ANIM.offRouteM) { motion.delete(v.id); continue; }

    // Promedio de avance: distancia recorrida sobre el trazado entre la posición
    // más antigua de la ventana y la actual. Incluye detenciones en paraderos y
    // semáforos, así el bus no corre y frena a cada actualización.
    const t = Date.parse(v.timestamp);
    let hist = sameRoute ? prev.hist.filter((h) => t - h.t <= ANIM.historyS * 1000) : [];
    if (hist.length && p.s < hist[hist.length - 1].s - ANIM.holdAheadM) hist = [];  // cambió de pasada
    hist.push({ t, s: p.s });
    if (hist.length > ANIM.historyMax) hist = hist.slice(-ANIM.historyMax);
    let speed = ANIM.defaultSpeed;
    const dt = (t - hist[0].t) / 1000;
    if (dt > 0) speed = Math.max(0, Math.min(ANIM.maxSpeed, (p.s - hist[0].s) / dt)) * ANIM.speedBoost;
    if (ageSeconds(v.timestamp) > STALE_SECONDS) speed = 0;

    // Transición desde donde se ve el bus ahora hacia la nueva posición real.
    let offset = 0, floorS = -Infinity;
    if (sameRoute) {
      const diff = displayS(prev, now) - p.s;
      if (Math.abs(diff) > ANIM.snapM) {
        // salto grande (dato raro o cambio de pasada): se corrige de golpe
      } else if (diff > 0 && diff <= ANIM.holdAheadM && speed > 0.5) {
        floorS = p.s + diff;  // va adelantado: espera a que la posición real lo alcance
      } else {
        offset = diff;        // va atrasado (o muy adelantado): se desliza hasta alcanzarla
      }
    }
    motion.set(v.id, {
      routeKey: v.routeKey, geo, obsS: p.s, obsTs: v.timestamp,
      recvAt: now, speed, hist, offset, floorS,
    });
  }
  for (const id of motion.keys()) if (!seen.has(id)) motion.delete(id);
}

function setArrow(entry, bearing) {
  if (entry.arrowEl && bearing != null) entry.arrowEl.style.transform = `rotate(${Math.round(bearing)}deg)`;
}

let lastFrame = 0;
function animate(ts) {
  requestAnimationFrame(animate);
  if (ts - lastFrame < ANIM.frameMs || document.hidden || !motion.size) return;
  lastFrame = ts;
  const view = map.getBounds().pad(0.2);
  for (const [id, entry] of markers) {
    const m = motion.get(id);
    if (!m) continue;
    const pt = pointAt(m.geo, displayS(m, ts));
    if (!view.contains([pt.lat, pt.lon])) continue;
    entry.marker.setLatLng([pt.lat, pt.lon]);
    setArrow(entry, pt.bearing);
  }
}
requestAnimationFrame(animate);

// ---------- Vehículos ----------
async function refresh() {
  clearTimeout(state.timer);
  let delay = REFRESH_MS;
  try {
    const data = await api("/api/vehicles");
    if (!data.fetchedAt) {
      // El servidor recién empezó a consultar la API: se reintenta pronto.
      setStatus("Consultando la flota por primera vez (toma unos segundos)…");
      delay = 2000;
    } else {
      state.vehicles = data.vehicles.sort((a, b) =>
        byRouteName(a.route, b.route) || a.direction.localeCompare(b.direction) || a.plate.localeCompare(b.plate));
      state.fetchedAt = Date.parse(data.fetchedAt);
      updateMotion(state.vehicles);
      $("liveDot").className = "live-dot on";
      const s = data.stats;
      setStatus(data.errors.length
        ? `${data.errors.length} recorrido(s) no respondieron en la última consulta.`
        : `${s.routesQueried} de ${s.routesTotal} recorridos consultados en ${s.seconds} s · se actualiza cada ${REFRESH_MS / 1000} s`);
    }
  } catch (err) {
    $("liveDot").className = "live-dot err";
    setStatus(`Error al consultar vehículos: ${err.message}. Reintentando…`, true);
  }
  render();
  state.nextRefreshAt = Date.now() + delay;
  state.timer = setTimeout(refresh, delay);
}

function busIcon(v, st, stale, selected) {
  const arrow = v.bearing == null && !motion.has(v.id) ? "" :
    `<div class="arrow" style="transform:rotate(${v.bearing}deg);--arrow:${esc(st.bg)}"></div>`;
  return L.divIcon({
    className: `bus-icon${stale ? " stale" : ""}${selected ? " selected" : ""}`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
    html: `<div class="bus" style="background:${esc(st.bg)};color:${esc(st.fg)}">${arrow}${esc(v.route)}</div>`,
  });
}

function renderMarkers(list) {
  const keep = new Set(list.map((v) => v.id));
  for (const [id, entry] of markers) {
    if (!keep.has(id)) { busLayer.removeLayer(entry.marker); markers.delete(id); }
  }
  const now = performance.now();
  for (const v of list) {
    if (v.lat == null || v.lon == null) continue;
    const selected = v.id === state.selectedId;
    const stale = ageSeconds(v.timestamp) > STALE_SECONDS;
    const tooltip = `${esc(v.plate)} · ${esc(v.route)} → ${esc(v.headsign)}`;
    // Con animación, la posición la pone el cuadro actual; si no, la del GPS.
    const m = motion.get(v.id);
    const pt = m ? pointAt(m.geo, displayS(m, now)) : { lat: v.lat, lon: v.lon, bearing: v.bearing };
    let entry = markers.get(v.id);
    if (!entry) {
      const marker = L.marker([pt.lat, pt.lon], { icon: busIcon(v, routeStyle(v.route), stale, selected) })
        .on("click", () => selectVehicle(v.id))
        .bindTooltip(tooltip, { direction: "top", offset: [0, -14] })
        .addTo(busLayer);
      entry = { marker, iconKey: null, arrowEl: null };
      markers.set(v.id, entry);
    } else {
      entry.marker.setLatLng([pt.lat, pt.lon]);
      entry.marker.setTooltipContent(tooltip);
    }
    // Recrear el ícono es lo caro: solo se hace si cambió algo visible.
    // El rumbo no forma parte de la clave: la flecha se gira directo en el DOM.
    const iconKey = `${v.route}|${stale}|${selected}`;
    if (iconKey !== entry.iconKey) {
      entry.marker.setIcon(busIcon(v, routeStyle(v.route), stale, selected));
      entry.marker.setZIndexOffset(selected ? 1000 : 0);
      entry.arrowEl = entry.marker.getElement()?.querySelector(".arrow") || null;
      entry.iconKey = iconKey;
    }
    setArrow(entry, pt.bearing);
  }
}

function renderShapes() {
  shapeLayer.clearLayers();
  if (!state.network) return;
  const sel = state.vehicles.find((v) => v.id === state.selectedId);
  const shown = state.network.routes.filter((r) =>
    sel ? r.key === sel.routeKey : r.route === state.focusRoute);
  for (const r of shown) {
    if (r.shape.length < 2) continue;
    L.polyline(r.shape, { color: r.color, weight: 5, opacity: .75 }).addTo(shapeLayer);
  }
}

function renderChips() {
  // Solo líneas con buses en servicio (la red completa supera las 140 líneas).
  const counts = new Map();
  for (const v of state.vehicles) {
    if (matchesSearch(v)) counts.set(v.route, (counts.get(v.route) || 0) + 1);
  }
  if (state.focusRoute && !counts.has(state.focusRoute)) counts.set(state.focusRoute, 0);
  const names = [...counts.keys()].sort(byRouteName);
  $("routeChips").innerHTML = names.map((n) => {
    const st = routeStyle(n);
    const active = !state.focusRoute || state.focusRoute === n;
    return `<button class="chip${active ? " active" : ""}${state.focusRoute === n ? " focus" : ""}"
      data-route="${esc(n)}" style="background:${esc(st.bg)};color:${esc(st.fg)}"
      title="${counts.get(n)} bus(es) en servicio">${esc(n)}<span class="count">${counts.get(n)}</span></button>`;
  }).join("");
}

function renderList(list) {
  if (state.fetchedAt && !list.length) {
    $("vehicleList").innerHTML = `<li class="status">${state.vehicles.length
      ? "Ningún bus coincide con el filtro." : "No hay buses transmitiendo ahora."}</li>`;
    return;
  }
  $("vehicleList").innerHTML = list.map((v) => {
    const st = routeStyle(v.route);
    const age = ageSeconds(v.timestamp);
    return `<li class="vehicle${v.id === state.selectedId ? " selected" : ""}${age > STALE_SECONDS ? " stale" : ""}" data-id="${esc(v.id)}">
      <span class="vehicle__badge" style="background:${esc(st.bg)};color:${esc(st.fg)}">${esc(v.route)}</span>
      <span><div class="vehicle__plate">${esc(v.plate)}</div>
        <div class="vehicle__dest">${directionLabel(v.direction)} → ${esc(v.headsign)}</div></span>
      <span class="vehicle__age" data-ts="${esc(v.timestamp)}">${formatAge(age)}</span>
    </li>`;
  }).join("");
}

function renderDetail() {
  const v = state.vehicles.find((x) => x.id === state.selectedId);
  const el = $("detail");
  if (!v) { el.hidden = true; return; }
  const st = routeStyle(v.route);
  el.hidden = false;
  el.style.borderLeftColor = st.bg;
  el.innerHTML = `
    <h2><span>Bus ${esc(v.plate)}</span><button id="closeDetail" title="Cerrar">×</button></h2>
    <dl>
      <dt>Línea</dt><dd>${esc(v.route)} · ${directionLabel(v.direction)}</dd>
      <dt>Destino</dt><dd>${esc(v.headsign)}</dd>
      <dt>Rumbo</dt><dd>${cardinal(v.bearing)}</dd>
      <dt>Última señal</dt><dd>hace <span data-ts="${esc(v.timestamp)}">${formatAge(ageSeconds(v.timestamp))}</span></dd>
      <dt>Posición</dt><dd>${v.lat?.toFixed(5)}, ${v.lon?.toFixed(5)}</dd>
    </dl>`;
  $("closeDetail").onclick = () => selectVehicle(null);
}

function render() {
  const list = visibleVehicles();
  const ready = state.fetchedAt != null;
  $("kpiBuses").textContent = ready ? state.vehicles.length : "–";
  $("kpiRoutes").textContent = ready ? new Set(state.vehicles.map((v) => v.route)).size : "–";
  renderChips();
  renderMarkers(list);
  renderShapes();
  renderList(list);
  renderDetail();

  const sel = state.vehicles.find((v) => v.id === state.selectedId);
  if (sel && !map.getBounds().contains([sel.lat, sel.lon])) map.panTo([sel.lat, sel.lon]);
}

function selectVehicle(id) {
  state.selectedId = state.selectedId === id ? null : id;
  render();
  const v = state.vehicles.find((x) => x.id === state.selectedId);
  if (v) {
    map.flyTo([v.lat, v.lon], Math.max(map.getZoom(), 15), { duration: .6 });
    document.querySelector(`.vehicle[data-id="${CSS.escape(v.id)}"]`)?.scrollIntoView({ block: "nearest" });
  }
}

function setStatus(msg, isError = false) {
  const el = $("status");
  el.textContent = msg;
  el.className = `status${isError ? " err" : ""}`;
}

// ---------- Eventos ----------
$("vehicleList").addEventListener("click", (e) => {
  const li = e.target.closest(".vehicle");
  if (li) selectVehicle(li.dataset.id);
});

$("routeChips").addEventListener("click", (e) => {
  const chip = e.target.closest(".chip");
  if (!chip) return;
  state.focusRoute = state.focusRoute === chip.dataset.route ? null : chip.dataset.route;
  state.selectedId = null;
  render();
  const bounds = shapeLayer.getLayers().map((l) => l.getBounds());
  if (bounds.length) map.fitBounds(bounds.reduce((a, b) => a.extend(b)), { padding: [30, 30] });
});

$("search").addEventListener("input", (e) => {
  state.search = e.target.value;
  render();
});

// Reloj de 1 s: edad de la última consulta, edad de cada señal y barra de refresco.
setInterval(() => {
  $("kpiAge").textContent = state.fetchedAt ? formatAge((Date.now() - state.fetchedAt) / 1000) : "–";
  for (const el of document.querySelectorAll("[data-ts]")) {
    el.textContent = formatAge(ageSeconds(el.dataset.ts));
  }
  const left = Math.max(0, state.nextRefreshAt - Date.now());
  $("refreshProgress").style.width = `${100 - (left / REFRESH_MS) * 100}%`;
}, 1000);

init();
