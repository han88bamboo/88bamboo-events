// core/utils/dateWindows.test.mjs — unit tests for the Explore date-window helper
// (EXPLORE-LAYER-PLAN.md §6, D4). Node's built-in runner, no new dependency:
//   cd frontend && node --test 'core/utils/**/*.test.mjs'
//
// A FIXED reference instant makes every window deterministic. 2026-07-09T12:00Z is a
// THURSDAY, so the current Monday-start week is Mon 2026-07-06 … Sun 2026-07-12.

import test from 'node:test';
import assert from 'node:assert/strict';

import { dateWindow, isDateWindowKey, DATE_WINDOWS } from './dateWindows.js';

const NOW = new Date('2026-07-09T12:00:00.000Z'); // Thursday
const dow = (isoStr) => new Date(isoStr).getUTCDay(); // 0=Sun … 6=Sat

test('today spans the whole reference UTC day', () => {
  assert.deepEqual(dateWindow('today', NOW), {
    date_from: '2026-07-09T00:00:00.000Z',
    date_to: '2026-07-09T23:59:59.999Z',
  });
});

test('tomorrow spans the next UTC day', () => {
  assert.deepEqual(dateWindow('tomorrow', NOW), {
    date_from: '2026-07-10T00:00:00.000Z',
    date_to: '2026-07-10T23:59:59.999Z',
  });
});

test('this-weekend is the current Saturday → Sunday', () => {
  const w = dateWindow('this-weekend', NOW);
  assert.equal(w.date_from, '2026-07-11T00:00:00.000Z'); // Sat
  assert.equal(w.date_to, '2026-07-12T23:59:59.999Z'); // Sun
  assert.equal(dow(w.date_from), 6);
  assert.equal(dow(w.date_to), 0);
});

test('this-week runs from today to the end of Sunday', () => {
  const w = dateWindow('this-week', NOW);
  assert.equal(w.date_from, '2026-07-09T00:00:00.000Z'); // today
  assert.equal(w.date_to, '2026-07-12T23:59:59.999Z'); // Sunday
  assert.equal(dow(w.date_to), 0);
});

test('next-week is the following Monday → Sunday', () => {
  const w = dateWindow('next-week', NOW);
  assert.equal(w.date_from, '2026-07-13T00:00:00.000Z'); // next Mon
  assert.equal(w.date_to, '2026-07-19T23:59:59.999Z'); // next Sun
  assert.equal(dow(w.date_from), 1);
  assert.equal(dow(w.date_to), 0);
});

test('this-month runs from today to the last day of the month', () => {
  const w = dateWindow('this-month', NOW);
  assert.equal(w.date_from, '2026-07-09T00:00:00.000Z');
  assert.equal(w.date_to, '2026-07-31T23:59:59.999Z');
});

test('3-months runs from today to the same day three months out', () => {
  const w = dateWindow('3-months', NOW);
  assert.equal(w.date_from, '2026-07-09T00:00:00.000Z');
  assert.equal(w.date_to, '2026-10-09T23:59:59.999Z');
});

test('an unknown window key returns null', () => {
  assert.equal(dateWindow('next-decade', NOW), null);
  assert.equal(dateWindow('', NOW), null);
  assert.equal(dateWindow(undefined, NOW), null);
});

test('isDateWindowKey recognises exactly the published keys', () => {
  for (const { key } of DATE_WINDOWS) assert.equal(isDateWindowKey(key), true);
  assert.equal(isDateWindowKey('nope'), false);
});

test('every window is a valid, ordered ISO range', () => {
  for (const { key } of DATE_WINDOWS) {
    const w = dateWindow(key, NOW);
    assert.ok(w, `${key} resolves`);
    assert.match(w.date_from, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    assert.match(w.date_to, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    assert.ok(new Date(w.date_from) <= new Date(w.date_to), `${key} from <= to`);
  }
});
