/* Browserunabhängige BSAG/VBN-Daten- und URL-Logik, aus dem Arduino-Sketch übertragen. */
export const API_BASE = 'https://dbf.finalrewind.org';
export const PROVIDER = 'VBN';
export const DEFAULT_STOP = 'Bremen Marschstraße';
export const REFRESH_MS = 60_000; // Vorgabe des Dienstes: eine Anfrage je Station und Minute.
export const MAX_VISIBLE_DEPARTURES = 20; // Neue Obergrenze der Abfahrtstafel.
export const BERLIN_TZ = 'Europe/Berlin';

export function cleanStation(value) {
  return String(value ?? '').replace(/[\r\n\t]+/g, ' ').trim().replace(/\s+/g, ' ').slice(0, 100);
}

export function departureUrl(station, format = 'json') {
  const stop = cleanStation(station);
  if (!stop) throw new Error('Bitte eine Haltestelle eingeben.');
  const suffix = format === 'html' ? '' : '.json';
  const url = new URL(`${API_BASE}/${encodeURIComponent(stop)}${suffix}`);
  url.searchParams.set('hafas', PROVIDER);
  url.searchParams.set('admode', 'dep');
  url.searchParams.set('rt', '1');
  if (format === 'json') {
    url.searchParams.set('version', '3');
    url.searchParams.set('limit', '40'); // Reserve, falls vergangene Fahrten herausgefiltert werden.
  } else {
    url.searchParams.set('mode', 'infoscreen');
    url.searchParams.set('hide_opts', '1');
    url.searchParams.set('hide_navbar', '1');
  }
  return url.toString();
}

export function berlinParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: BERLIN_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
  const parts = Object.fromEntries(formatter.formatToParts(date)
    .filter(p => p.type !== 'literal').map(p => [p.type, Number(p.value)]));
  return parts;
}

// Ermittelt die UTC-Epoche eines lokalen HH:MM in Europe/Berlin, auch bei Sommerzeit.
function zonedToEpoch(y, m, d, hh, mm) {
  const desired = Date.UTC(y, m - 1, d, hh, mm, 0);
  let candidate = desired;
  for (let i = 0; i < 3; i++) {
    const actual = berlinParts(new Date(candidate));
    const actualUtcLike = Date.UTC(actual.year, actual.month - 1, actual.day,
      actual.hour, actual.minute, actual.second);
    const difference = desired - actualUtcLike;
    if (Math.abs(difference) < 1000) break;
    candidate += difference;
  }
  return Math.floor(candidate / 1000);
}

export function epochFromHHMM(hhmm, delay = 0, nowEpoch = Date.now() / 1000) {
  const match = /^(\d\d):(\d\d)$/.exec(String(hhmm ?? '').trim());
  if (!match) return null;
  const h = Number(match[1]), m = Number(match[2]);
  if (h > 23 || m > 59) return null;
  const now = Math.floor(nowEpoch);
  const date = berlinParts(new Date(now * 1000));
  const base = zonedToEpoch(date.year, date.month, date.day, h, m);
  let event = base;
  if (event < now - 6 * 3600) {
    const next = new Date(Date.UTC(date.year, date.month - 1, date.day + 1));
    event = zonedToEpoch(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), h, m);
  } else if (event > now + 18 * 3600) {
    const prev = new Date(Date.UTC(date.year, date.month - 1, date.day - 1));
    event = zonedToEpoch(prev.getUTCFullYear(), prev.getUTCMonth() + 1, prev.getUTCDate(), h, m);
  }
  return event + Math.trunc(Number(delay) || 0) * 60;
}

export function parseEpoch(value) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.floor(value > 1e11 ? value / 1000 : value);
  }
  if (typeof value === 'string') {
    if (/^\d{10,13}$/.test(value)) return parseEpoch(Number(value));
    if (/^\d{4}-\d\d-\d\d[T ]/.test(value)) {
      const time = Date.parse(value);
      return Number.isFinite(time) ? Math.floor(time / 1000) : null;
    }
  }
  return null;
}

function asText(value, fallback = '-') {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return fallback;
}

// Akzeptiert das JSON v3-Schema der Original-Firmware, gibt KEINE Testdaten zurück.
export function normalizeDepartures(json, nowEpoch = Date.now() / 1000) {
  if (json?.error) throw new Error(String(json.error));
  if (!Array.isArray(json?.departures)) {
    throw new Error('Ungültige API-Antwort: departures fehlt.');
  }
  const now = Math.floor(nowEpoch);
  const rows = [];
  for (const row of json.departures) {
    if (!row || typeof row !== 'object') continue;
    const rawDelay = row.delay ?? row.delayDeparture ?? row.delayArrival ?? 0;
    const delay = Number.isFinite(Number(rawDelay)) ? Math.trunc(Number(rawDelay)) : 0;
    const realtime = parseEpoch(row.time);
    const planned = parseEpoch(row.scheduledTime);
    let eventEpoch = realtime ?? (planned == null ? null : planned + delay * 60);
    if (eventEpoch == null) {
      eventEpoch = epochFromHHMM(row.scheduledDeparture || row.scheduledArrival, delay, now);
    }
    if (eventEpoch != null && eventEpoch < now - 60) continue;
    const cancelled = row.isCancelled === true || row.cancelled === true;
    rows.push({
      eventEpoch,
      delay: Math.max(0, delay),
      cancelled,
      line: asText(row.train || row.line || row.trainNumber),
      destination: asText(row.direction || row.destination, 'Unbekannt'),
      platform: asText(row.platform || row.scheduledPlatform),
    });
  }
  rows.sort((a, b) => (a.eventEpoch ?? Infinity) - (b.eventEpoch ?? Infinity));
  return rows;
}

// Bis zu 20 tatsächlich kommende Fahrten anzeigen; die API kann mehr liefern.
export function selectVisibleDepartures(departures, nowEpoch = Date.now() / 1000) {
  return departures
    .filter(dep => minutesUntilJS(dep.eventEpoch, nowEpoch, dep.cancelled) !== -1)
    .slice(0, MAX_VISIBLE_DEPARTURES);
}

export function minutesUntilJS(eventEpoch, nowEpoch, cancelled) {
  if (cancelled || !eventEpoch || !nowEpoch) return -999;
  const diff = Math.floor(eventEpoch) - Math.floor(nowEpoch);
  if (diff > 0) return Math.ceil(diff / 60);
  return diff >= -60 ? 0 : -1;
}

export function colorCodeJS(eventEpoch, nowEpoch, cancelled) {
  if (cancelled) return 3;
  const minutes = minutesUntilJS(eventEpoch, nowEpoch, false);
  if (minutes === -999) return 0;
  if (minutes >= 10) return 1;
  if (minutes >= 6) return 2;
  return 3;
}

export function berlinClock(epoch = Date.now() / 1000) {
  if (!epoch) return '--:--';
  return new Intl.DateTimeFormat('de-DE', {timeZone: BERLIN_TZ,
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'}).format(new Date(epoch * 1000));
}
