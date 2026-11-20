'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createFileStore } = require('../src/storage');

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'checker-bot-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('starts empty when the file does not exist and creates parent directories', async t => {
  const file = path.join(tempDir(t), 'nested', 'state.json');
  const store = createFileStore(file);
  assert.equal(await store.get('shop'), undefined);
  await store.set('shop', { value: 'a' });
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { shop: { value: 'a' } });
});

test('state survives a restart', async t => {
  const file = path.join(tempDir(t), 'state.json');
  await createFileStore(file).set('shop', { value: 'a', lastChangeAt: 'x' });
  const reloaded = createFileStore(file);
  assert.deepEqual(await reloaded.get('shop'), { value: 'a', lastChangeAt: 'x' });
  assert.deepEqual(await reloaded.getAll(), { shop: { value: 'a', lastChangeAt: 'x' } });
});

test('concurrent writes are serialized and the last one wins', async t => {
  const dir = tempDir(t);
  const file = path.join(dir, 'state.json');
  const store = createFileStore(file);
  await Promise.all([
    store.set('a', { value: 1 }),
    store.set('b', { value: 2 }),
    store.set('a', { value: 3 })
  ]);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { a: { value: 3 }, b: { value: 2 } });
  assert.deepEqual(fs.readdirSync(dir), ['state.json'], 'no temp files left behind');
});

test('a failed write rejects but does not block later writes', async t => {
  const dir = tempDir(t);
  const parent = path.join(dir, 'sub');
  const file = path.join(parent, 'state.json');
  const store = createFileStore(file);
  // The parent "directory" is a regular file, so mkdir fails.
  fs.writeFileSync(parent, '');
  await assert.rejects(store.set('a', { value: 1 }));
  fs.rmSync(parent);
  await store.set('b', { value: 2 });
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { a: { value: 1 }, b: { value: 2 } });
});

test('refuses to load a corrupted or non-object file', t => {
  const dir = tempDir(t);
  const corrupted = path.join(dir, 'corrupted.json');
  fs.writeFileSync(corrupted, '{"shop": ');
  assert.throws(() => createFileStore(corrupted), /Cannot load state file/);
  const array = path.join(dir, 'array.json');
  fs.writeFileSync(array, '[]');
  assert.throws(() => createFileStore(array), /expected a JSON object/);
});
