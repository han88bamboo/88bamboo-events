// core/utils/imageFiles.test.mjs — unit tests for the shared client-side image
// rules used by the drop zones on the submit wizard and the edit form. Uses
// Node's built-in test runner (no new dependency): run with
// `node --test core/utils/*.test.mjs` from the frontend/ directory.
//
// The helpers only read .name/.type/.size, so plain objects stand in for File.

import test from 'node:test';
import assert from 'node:assert/strict';

import { MAX_IMAGE_MB, imageFileReason, pickImageFiles } from './imageFiles.js';

const file = (name, type, size = 1024) => ({ name, type, size });
const OVERSIZE = MAX_IMAGE_MB * 1024 * 1024 + 1;

test('imageFileReason accepts the three permitted types', () => {
  assert.equal(imageFileReason(file('a.jpg', 'image/jpeg')), '');
  assert.equal(imageFileReason(file('a.png', 'image/png')), '');
  assert.equal(imageFileReason(file('a.webp', 'image/webp')), '');
});

test('imageFileReason rejects wrong type, empty and oversize files', () => {
  assert.match(imageFileReason(file('a.gif', 'image/gif')), /JPEG, PNG, or WebP/);
  // A dropped folder arrives with no type at all.
  assert.match(imageFileReason(file('holiday-pics', '')), /JPEG, PNG, or WebP/);
  assert.match(imageFileReason(file('a.jpg', 'image/jpeg', 0)), /empty/);
  assert.match(
    imageFileReason(file('a.jpg', 'image/jpeg', OVERSIZE)),
    new RegExp(`too large \\(max ${MAX_IMAGE_MB} MB\\)`),
  );
});

test('pickImageFiles keeps good files and explains each skip', () => {
  const { accepted, notices } = pickImageFiles(
    [
      file('ok.jpg', 'image/jpeg'),
      file('bad.gif', 'image/gif'),
      file('huge.png', 'image/png', OVERSIZE),
    ],
    5,
    5,
  );
  assert.deepEqual(accepted.map((f) => f.name), ['ok.jpg']);
  assert.equal(notices.length, 2);
  assert.match(notices[0], /^bad\.gif — must be a JPEG/);
  assert.match(notices[1], /^huge\.png — is too large/);
});

test('pickImageFiles stops at the remaining slots and says why', () => {
  const three = ['a.jpg', 'b.jpg', 'c.jpg'].map((n) => file(n, 'image/jpeg'));
  const { accepted, notices } = pickImageFiles(three, 2, 5);
  assert.deepEqual(accepted.map((f) => f.name), ['a.jpg', 'b.jpg']);
  assert.deepEqual(notices, ['c.jpg — skipped (maximum of 5 images).']);
});

test('pickImageFiles at the cap accepts nothing and notices everything', () => {
  const { accepted, notices } = pickImageFiles([file('a.jpg', 'image/jpeg')], 0, 5);
  assert.deepEqual(accepted, []);
  assert.deepEqual(notices, ['a.jpg — skipped (maximum of 5 images).']);
});

test('pickImageFiles tolerates an empty or absent list', () => {
  assert.deepEqual(pickImageFiles(null, 5, 5), { accepted: [], notices: [] });
  assert.deepEqual(pickImageFiles([], 5, 5), { accepted: [], notices: [] });
});
