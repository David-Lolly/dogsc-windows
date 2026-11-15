'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeProject, normalizeProject } = require('../src/core/model');

test('foreign and future project formats are rejected without mutation', () => {
  for (const project of [{ schemaVersion: 27, timeline: { screenMotionClips: [{}] } },
    { app: 'dogsc-windows', schema: 999, extension: { opaque: 42 } }]) {
    const before = JSON.stringify(project);
    assert.throws(() => normalizeProject(project), /schema 1\/2/);
    assert.equal(JSON.stringify(project), before);
  }
});

test('schema 1 migrates to schema 2 with empty new tracks and retained legacy content', () => {
  const project = makeProject({ name: 'legacy', media: { screen: { width: 640, height: 360, duration: 4 } } });
  project.schema = 1;
  for (const key of ['screenMotionClips', 'cameraMotionClips', 'mosaicClips', 'stickerClips']) delete project.timeline[key];
  const segments = JSON.stringify(project.timeline.segments);
  normalizeProject(project);
  assert.equal(project.schema, 2);
  assert.deepEqual(project.timeline.screenMotionClips, []);
  assert.equal(JSON.stringify(project.timeline.segments), segments);
});
test('current projects retain unknown fields through normalization and serialization', () => {
  const project = makeProject({ name: 'fixture', media: { screen: { width: 640, height: 360, duration: 4 } } });
  project.extension = { opaque: 42 };
  project.canvas.extension = 'preserve';
  const roundtrip = JSON.parse(JSON.stringify(normalizeProject(project)));
  assert.deepEqual(roundtrip.extension, { opaque: 42 });
  assert.equal(roundtrip.canvas.extension, 'preserve');
});
