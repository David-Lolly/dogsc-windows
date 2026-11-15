'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { seekTrack, finishSeek, PreviewFrameCache } = require('../src/renderer/editor/media-preview-state');

function trackAt(time = 1) {
  let current = time;
  const writes = [];
  const node = {
    seeking: false,
    get currentTime() { return current; },
    set currentTime(value) { current = value; writes.push(value); this.seeking = true; },
  };
  return { node, writes, pendingTime: null };
}

test('appearance updates do not seek a paused frame at the same time', () => {
  const track = trackAt();
  for (let i = 0; i < 1000; i++) seekTrack(track, 1);
  assert.deepEqual(track.writes, []);
});

test('rapid scrubbing completes the in-flight seek then seeks only the latest destination', () => {
  const track = trackAt();
  for (let i = 2; i <= 100; i++) seekTrack(track, i);
  assert.deepEqual(track.writes, [2]);
  track.node.seeking = false;
  finishSeek(track);
  assert.deepEqual(track.writes, [2, 100]);
  track.node.seeking = false;
  finishSeek(track);
  assert.deepEqual(track.writes, [2, 100]);
});

test('returning to the in-flight target cancels an obsolete queued seek', () => {
  const track = trackAt();
  seekTrack(track, 2); seekTrack(track, 3); seekTrack(track, 2);
  track.node.seeking = false; finishSeek(track);
  assert.deepEqual(track.writes, [2]);
});

test('cache retains source pixels during seeking and low readiness, then refreshes', () => {
  let copies = 0;
  const cache = new PreviewFrameCache((width, height) => ({ width, height,
    getContext: () => ({ drawImage: () => { copies++; } }) }));
  const video = { seeking: false, readyState: 1, videoWidth: 1920, videoHeight: 1080 };
  assert.equal(cache.frame(video), null);
  video.readyState = 4;
  const first = cache.frame(video);
  assert.equal(copies, 1);
  video.seeking = true; video.readyState = 1;
  assert.equal(cache.frame(video), first);
  assert.equal(copies, 1);
  video.seeking = false; video.readyState = 4;
  assert.equal(cache.frame(video), first);
  assert.equal(copies, 2);
});
