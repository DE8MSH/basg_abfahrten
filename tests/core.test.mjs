import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  departureUrl, cleanStation, epochFromHHMM, normalizeDepartures, berlinClock,
  minutesUntilJS, colorCodeJS, parseEpoch, MAX_VISIBLE_DEPARTURES, selectVisibleDepartures,
} from '../assets/core.mjs';

const NOW = Date.parse('2026-11-04T08:30:00Z') / 1000;

test('API-URL entspricht dem Original-Sketch, inklusive Umlaut und Provider VBN', () => {
  const url = new URL(departureUrl('Bremen Marschstraße'));
  assert.equal(decodeURIComponent(url.pathname), '/Bremen Marschstraße.json');
  assert.equal(url.searchParams.get('hafas'), 'VBN');
  assert.equal(url.searchParams.get('version'), '3');
  assert.equal(url.searchParams.get('rt'), '1');
  assert.equal(url.searchParams.get('admode'), 'dep');
  assert.equal(url.searchParams.get('limit'), '40');
  assert.equal(new URL(departureUrl('Bremen Domsheide','html')).searchParams.get('mode'), 'infoscreen');
  assert.equal(new URL(departureUrl('Bremen Domsheide','html')).searchParams.get('limit'), '12');
  assert.equal(cleanStation('  Bremen  Am  Brill   '), 'Bremen Am Brill');
});

test('Die Abfahrtstafel zeigt höchstens 20 echte Abfahrten, keine 20 Platzhalter', () => {
  assert.equal(MAX_VISIBLE_DEPARTURES, 20);
  const trips = Array.from({length: 26}, (_, i) => ({
    eventEpoch: NOW + (i + 1) * 60, cancelled: false, line: String(i + 1),
  }));
  const result = selectVisibleDepartures([
    {eventEpoch: NOW - 120, cancelled: false, line: 'ALT'}, ...trips,
  ], NOW);
  assert.equal(result.length, 20);
  assert.equal(result[0].line, '1');
  assert.equal(result[19].line, '20');
  assert.equal(selectVisibleDepartures(trips.slice(0, 3), NOW).length, 3);
});

test('Countdown ist aufgerundet; JETZT bleibt 60 Sekunden sichtbar', () => {
  assert.equal(minutesUntilJS(NOW + 301, NOW, false), 6);
  assert.equal(minutesUntilJS(NOW + 300, NOW, false), 5);
  assert.equal(minutesUntilJS(NOW + 1, NOW, false), 1);
  assert.equal(minutesUntilJS(NOW, NOW, false), 0);
  assert.equal(minutesUntilJS(NOW - 60, NOW, false), 0);
  assert.equal(minutesUntilJS(NOW - 61, NOW, false), -1);
  assert.equal(minutesUntilJS(NOW + 1, NOW, true), -999);
});

test('Ampelfarben entsprechen dem Display', () => {
  assert.equal(colorCodeJS(NOW + 10 * 60, NOW, false), 1);
  assert.equal(colorCodeJS(NOW + 9 * 60, NOW, false), 2);
  assert.equal(colorCodeJS(NOW + 6 * 60, NOW, false), 2);
  assert.equal(colorCodeJS(NOW + 5 * 60, NOW, false), 3);
  assert.equal(colorCodeJS(NOW, NOW, true), 3);
});

test('JSON-v3: Echtzeitzeit bevorzugen, geplante Zeit + Minuten, Sortierung, Ausfall', () => {
  const d = normalizeDepartures({departures:[
    {line:'41', direction:'Bremen Weserpark', scheduledTime:NOW + 120, delay:3},
    {train:'N10', destination:'Hauptbahnhof', scheduledTime:NOW + 40, time:NOW + 60, delayDeparture:1},
    {line:'40', direction:'Mahndorf', scheduledTime:NOW + 600, isCancelled:true},
    {line:'42', direction:'ALT', scheduledTime:NOW - 120},
  ]}, NOW);
  assert.equal(d.length, 3);
  assert.equal(d[0].line, 'N10');
  assert.equal(d[0].eventEpoch, NOW + 60);
  assert.equal(d[1].eventEpoch, NOW + 300);
  assert.equal(d[1].delay, 3);
  assert.equal(d[2].cancelled, true);
});

test('HH:MM interpretiert 09:45 am November-Tag als Europe/Berlin UTC+1', () => {
  assert.equal(epochFromHHMM('09:45', 2, NOW), Date.parse('2026-11-04T08:47:00Z') / 1000);
  assert.equal(berlinClock(NOW), '09:30');
  assert.equal(epochFromHHMM('99:99', 0, NOW), null);
  assert.equal(parseEpoch(String(NOW * 1000)), NOW);
});

test('Der mitgelieferte WASM-Kern funktioniert ohne Imports und entspricht dem JS-Fallback', async () => {
  const bytes = readFileSync(new URL('../assets/departures.wasm', import.meta.url));
  const {instance} = await WebAssembly.instantiate(bytes, {});
  const wasm = instance.exports;
  for (const seconds of [-62, -61, -60, -1, 0, 1, 4, 60, 61, 300, 301, 601, 8000]) {
    assert.equal(wasm.minutes_until(NOW + seconds, NOW, 0), minutesUntilJS(NOW + seconds, NOW, false), `delta ${seconds}`);
    assert.equal(wasm.color_code(NOW + seconds, NOW, 0), colorCodeJS(NOW + seconds, NOW, false), `color ${seconds}`);
  }
  assert.equal(wasm.minutes_until(NOW + 300, NOW, 1), -999);
  assert.equal(wasm.delay_blink_on(200), 1);
  assert.equal(wasm.delay_blink_on(201), 0);
});

test('Fehlerhafte Antworten werden nicht als echte Live-Abfahrten ausgegeben', () => {
  assert.throws(() => normalizeDepartures({error:'Ungültiger Halt'}, NOW), /Ungültiger Halt/);
  assert.throws(() => normalizeDepartures({}, NOW), /departures fehlt/);
});
