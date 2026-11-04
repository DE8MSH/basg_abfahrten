import {
  DEFAULT_STOP, REFRESH_MS, cleanStation, departureUrl, normalizeDepartures,
  minutesUntilJS, colorCodeJS, berlinClock,
} from './core.mjs';

const $ = (id) => document.getElementById(id);
const state = {
  stop: DEFAULT_STOP, departures: [], lastAttempt: 0, lastSuccess: 0,
  loading: false, mode: 'native', wasm: null, favorites: [], generation: 0, abortController: null,
};
const nodes = {
  stationInput: $('stationInput'), headingStation: $('headingStation'),
  displayStation: $('displayStation'), stationForm: $('stationForm'),
  departureRows: $('departureRows'), board: $('board'), boardFooter: $('boardFooter'),
  topClock: $('topClock'), boardTime: $('boardTime'), messageBar: $('messageBar'),
  connectionLabel: $('connectionLabel'), sourceDot: $('sourceDot'),
  infoStatus: $('infoStatus'), wasmStatus: $('wasmStatus'),
  refreshButton: $('refreshButton'), nativePanel: $('nativePanel'),
  embedPanel: $('embedPanel'), nativeButton: $('nativeButton'),
  embedButton: $('embedButton'), dbfFrame: $('dbfFrame'), openDBF: $('openDBF'),
  starButton: $('starButton'), favoritesSelect: $('favoritesSelect'),
};

function loadSettings() {
  try {
    const stored = JSON.parse(localStorage.getItem('bsag-favorites-v1') || '[]');
    if (Array.isArray(stored)) state.favorites = stored.filter(s => typeof s === 'string').map(cleanStation).filter(Boolean).slice(0, 25);
  } catch { /* privater Browsermodus */ }
  const params = new URLSearchParams(location.search);
  const fromUrl = cleanStation(params.get('stop'));
  let fromStorage = '';
  try { fromStorage = cleanStation(localStorage.getItem('bsag-last-stop')); } catch { /* optional */ }
  return fromUrl || fromStorage || DEFAULT_STOP;
}

function setMessage(message, type = '') {
  nodes.messageBar.textContent = message;
  nodes.messageBar.className = 'message' + (type ? ` is-${type}` : '');
}

function setConnection(label, type = '') {
  nodes.connectionLabel.textContent = label;
  nodes.sourceDot.className = 'source-dot' + (type ? ` ${type}` : '');
}

function minutesUntil(epoch, now, cancelled) {
  if (state.wasm) return state.wasm.minutes_until(epoch || 0, now, cancelled ? 1 : 0);
  return minutesUntilJS(epoch, now, cancelled);
}
function colorCode(epoch, now, cancelled) {
  if (state.wasm) return state.wasm.color_code(epoch || 0, now, cancelled ? 1 : 0);
  return colorCodeJS(epoch, now, cancelled);
}

async function loadWasm() {
  try {
    const response = await fetch(new URL('./departures.wasm', import.meta.url));
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const bytes = await response.arrayBuffer();
    const { instance } = await WebAssembly.instantiate(bytes, {});
    if (typeof instance.exports.minutes_until !== 'function' ||
        typeof instance.exports.color_code !== 'function') throw new Error('WASM-Exports fehlen');
    state.wasm = instance.exports;
    nodes.wasmStatus.textContent = '● WebAssembly aktiv · echter C-Kern';
    renderDepartures();
  } catch (error) {
    nodes.wasmStatus.textContent = 'JavaScript-Ersatzlogik aktiv (WASM nicht geladen)';
    console.warn('WASM konnte nicht geladen werden:', error);
  }
}

function updateFavoriteUI() {
  const isFavorite = state.favorites.includes(state.stop);
  nodes.starButton.innerHTML = isFavorite ? '★ <span>Gespeichert</span>' : '☆ <span>Favorit</span>';
  nodes.starButton.setAttribute('aria-pressed', String(isFavorite));
  nodes.starButton.title = isFavorite ? 'Favorit entfernen' : 'Haltestelle als Favorit speichern';
  nodes.favoritesSelect.replaceChildren();
  nodes.favoritesSelect.add(new Option('Favoriten wählen', ''));
  for (const favorite of state.favorites) nodes.favoritesSelect.add(new Option(favorite, favorite));
  nodes.favoritesSelect.value = '';
}

function toggleFavorite() {
  const index = state.favorites.indexOf(state.stop);
  if (index === -1) state.favorites.push(state.stop);
  else state.favorites.splice(index, 1);
  try { localStorage.setItem('bsag-favorites-v1', JSON.stringify(state.favorites)); } catch { /* optional */ }
  updateFavoriteUI();
}

function setMode(mode) {
  state.mode = mode;
  nodes.nativePanel.hidden = mode !== 'native';
  nodes.embedPanel.hidden = mode !== 'embed';
  nodes.nativeButton.classList.toggle('is-active', mode === 'native');
  nodes.embedButton.classList.toggle('is-active', mode === 'embed');
  nodes.nativeButton.setAttribute('aria-pressed', String(mode === 'native'));
  nodes.embedButton.setAttribute('aria-pressed', String(mode === 'embed'));
  if (mode === 'embed') updateEmbed();
}

function updateEmbed() {
  const url = departureUrl(state.stop, 'html');
  if (nodes.dbfFrame.dataset.url !== url) {
    nodes.dbfFrame.src = url;
    nodes.dbfFrame.dataset.url = url;
  }
  nodes.openDBF.href = url;
}

function syncStation(station, updateUrl = true) {
  const cleaned = cleanStation(station);
  if (!cleaned) { setMessage('Bitte einen gültigen Haltestellennamen eingeben.', 'warning'); return; }
  const changed = cleaned !== state.stop;
  state.stop = cleaned;
  nodes.stationInput.value = cleaned;
  nodes.headingStation.textContent = cleaned;
  nodes.displayStation.textContent = cleaned;
  document.title = `${cleaned} – BSAG Abfahrten`;
  try { localStorage.setItem('bsag-last-stop', cleaned); } catch { /* optional */ }
  if (updateUrl) {
    const url = new URL(location.href);
    url.searchParams.set('stop', cleaned);
    history.replaceState(null, '', url);
  }
  updateFavoriteUI();
  updateEmbed();
  if (changed) {
    state.abortController?.abort();
    state.abortController = null;
    setLoading(false);
    state.generation++;
    state.departures = [];
    state.lastSuccess = 0;
    state.lastAttempt = 0;
    setMode('native');
    renderDepartures();
  }
  void fetchDepartures();
}

function setLoading(loading) {
  state.loading = loading;
  nodes.refreshButton.disabled = loading;
}

async function fetchDepartures() {
  if (state.loading) return;
  const now = Date.now();
  const until = state.lastAttempt + REFRESH_MS - now;
  if (state.lastAttempt > 0 && until > 0) {
    setMessage(`Nächster Live-Abruf in ${Math.ceil(until / 1000)} Sekunden möglich. Die Uhr zählt weiter.`, 'warning');
    return;
  }
  const generation = state.generation;
  const stop = state.stop;
  state.lastAttempt = now;
  setLoading(true);
  setConnection('Lade Live-Daten …');
  setMessage(`Abfahrten für ${stop} werden geladen …`);
  const controller = new AbortController();
  state.abortController = controller;
  const watchdog = setTimeout(() => controller.abort(), 14000);
  try {
    // Absichtlich KEINE verbotenen Browser-Header wie User-Agent oder Origin setzen.
    // Ein fremder Server muss den CORS-Zugriff ausdrücklich gestatten.
    const response = await fetch(departureUrl(stop), {
      method: 'GET', mode: 'cors', credentials: 'omit',
      cache: 'no-store', signal: controller.signal,
      headers: { 'Accept': 'application/json' },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const departures = normalizeDepartures(data);
    if (generation !== state.generation || stop !== state.stop) return;
    state.departures = departures;
    state.lastSuccess = Date.now();
    setConnection('Direkt verbunden', 'connected');
    setMode('native');
    if (departures.length) {
      setMessage(`${departures.length} Abfahrten empfangen · VBN-Livedaten · Stand ${berlinClock(state.lastSuccess / 1000)}`, 'ok');
    } else {
      setMessage('Die Datenquelle meldet derzeit keine kommenden Abfahrten.', 'warning');
    }
    nodes.infoStatus.textContent = `Letzter erfolgreicher JSON-Abruf: ${berlinClock(state.lastSuccess / 1000)} Uhr · Datenquelle: ${new URL(departureUrl(stop)).host}.`;
  } catch (error) {
    if (generation !== state.generation || stop !== state.stop) return;
    // Bei fehlenden Access-Control-Allow-Origin-Headern scheitert fetch() im Browser.
    // Der Dienst erlaubt die Einbettung seiner HTML-Abfahrtstafel (siehe README).
    console.warn('JSON-Direktabruf nicht möglich:', error);
    setConnection('DBF-Einbettung aktiv', 'error');
    setMessage('Direkter JSON-Abruf nicht möglich (API, Netzwerk oder CORS). Die offizielle DBF-Liveansicht wird eingebettet.', 'warning');
    nodes.infoStatus.textContent = 'JSON-Direktzugriff fehlgeschlagen. GitHub Pages kann fremde CORS-Sperren nicht umgehen. Alternativ ist die externe DBF-Tafel eingebettet.';
    setMode('embed');
  } finally {
    clearTimeout(watchdog);
    if (generation === state.generation) { state.abortController = null; setLoading(false); }
  }
}

function makeCell(className, content) {
  const el = document.createElement('div');
  if (className) el.className = className;
  if (content != null) el.textContent = String(content);
  return el;
}
function renderDepartures() {
  const now = Math.floor(Date.now() / 1000);
  const visible = state.departures.filter(dep => minutesUntil(dep.eventEpoch, now, dep.cancelled) !== -1).slice(0, 6);
  const fragment = document.createDocumentFragment();
  for (const dep of visible) {
    const mins = minutesUntil(dep.eventEpoch, now, dep.cancelled);
    const color = colorCode(dep.eventEpoch, now, dep.cancelled);
    const row = document.createElement('div');
    row.className = 'departure-row' + (dep.cancelled ? ' cancelled-row' : '');
    row.setAttribute('role', 'row');
    const count = makeCell(`countdown color-${color}` + (dep.cancelled ? ' cancel' : mins === 0 ? ' now' : ''),
      dep.cancelled ? 'AUS' : mins === -999 ? '--' : mins === 0 ? 'JETZT' : String(mins));
    row.append(count);
    row.append(makeCell('line-value', dep.line));
    const dest = makeCell('destination');
    if (dep.delay > 0 && !dep.cancelled) {
      const delay = document.createElement('span');
      delay.className = 'delay';
      delay.textContent = `+${dep.delay}`;
      delay.title = `${dep.delay} Minuten Verspätung`;
      dest.append(delay);
    }
    const target = document.createElement('span');
    target.className = 'target';
    target.textContent = dep.cancelled ? `${dep.destination} · fällt aus` : dep.destination;
    target.title = dep.destination;
    dest.append(target);
    row.append(dest);
    row.append(makeCell('scheduled', dep.eventEpoch ? berlinClock(dep.eventEpoch) : '--:--'));
    fragment.append(row);
  }
  if (!visible.length) {
    const empty = makeCell('blank-state', state.lastSuccess
      ? 'Keine weiteren Abfahrten gefunden.'
      : 'Noch keine Live-Daten verfügbar.');
    empty.setAttribute('role', 'row');
    fragment.append(empty);
  } else {
    // Feste Display-Höhe (6 Zeilen wie auf dem ESP32); CSS macht die Darstellung responsiv.
    for (let j = visible.length; j < 6; j++) {
      const blank = document.createElement('div');
      blank.className = 'departure-row';
      blank.setAttribute('aria-hidden', 'true');
      fragment.append(blank);
    }
  }
  nodes.departureRows.replaceChildren(fragment);
  nodes.boardFooter.textContent = state.lastSuccess
    ? `Stand ${berlinClock(state.lastSuccess / 1000)} · Antippen = aktualisieren`
    : 'BSAG Abfahrten · Echtzeitdaten VBN / DBF';
}

let lastRenderedSecond = -1;
function tick() {
  const now = Math.floor(Date.now() / 1000);
  nodes.topClock.textContent = berlinClock(now);
  nodes.boardTime.textContent = berlinClock(now);
  // Verspätungsblinken läuft in CSS; Countdown spätestens jede Sekunde aktualisieren.
  if (now !== lastRenderedSecond && state.mode === 'native') {
    lastRenderedSecond = now;
    if (state.departures.length) renderDepartures();
  }
  if (!state.loading && state.lastAttempt && Date.now() - state.lastAttempt >= REFRESH_MS) {
    void fetchDepartures();
  }
}

nodes.stationForm.addEventListener('submit', (ev) => { ev.preventDefault(); syncStation(nodes.stationInput.value); });
nodes.starButton.addEventListener('click', toggleFavorite);
nodes.favoritesSelect.addEventListener('change', (ev) => { if (ev.target.value) syncStation(ev.target.value); });
nodes.refreshButton.addEventListener('click', () => void fetchDepartures());
nodes.nativeButton.addEventListener('click', () => setMode('native'));
nodes.embedButton.addEventListener('click', () => setMode('embed'));
nodes.board.addEventListener('click', () => void fetchDepartures());
$('fullscreenButton').addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await (state.mode === 'embed' ? nodes.embedPanel : nodes.board).requestFullscreen();
  } catch (error) { setMessage(`Vollbild nicht verfügbar: ${error.message}`, 'warning'); }
});
for (const button of document.querySelectorAll('[data-stop]')) {
  button.addEventListener('click', () => syncStation(button.dataset.stop));
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });

const initialStop = loadSettings();
// Bei Erststart initialen Zustand synchronisieren, auch wenn dieselbe Station gesetzt ist.
nodes.stationInput.value = initialStop;
syncStation(initialStop, false);
void loadWasm();
tick();
setInterval(tick, 1000);
