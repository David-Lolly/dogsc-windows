'use strict';

const SEEK_TOLERANCE = 0.005;

// Keep at most one seek in flight. A scrub replaces the pending destination.
function seekTrack(track, time) {
  if (!Number.isFinite(time)) return;
  const node = track.node;
  if (Math.abs(node.currentTime - time) <= SEEK_TOLERANCE) {
    track.pendingTime = null;
    return;
  }
  if (node.seeking) {
    track.pendingTime = time;
    return;
  }
  track.pendingTime = null;
  node.currentTime = time;
}

function finishSeek(track) {
  const time = track.pendingTime;
  track.pendingTime = null;
  if (time !== null && time !== undefined) seekTrack(track, time);
}

// Cache source pixels, rather than the composited preview: geometry can change
// while decoding is pending without repeatedly scaling already-scaled pixels.
class PreviewFrameCache {
  constructor(createCanvas = (width, height) => new OffscreenCanvas(width, height)) {
    this.createCanvas = createCanvas;
    this.canvas = null;
    this.hasFrame = false;
  }

  frame(node) {
    if (node && !node.seeking && node.readyState >= 2 && node.videoWidth > 0 && node.videoHeight > 0) {
      if (!this.canvas) this.canvas = this.createCanvas(node.videoWidth, node.videoHeight);
      if (this.canvas.width !== node.videoWidth || this.canvas.height !== node.videoHeight) {
        this.canvas.width = node.videoWidth;
        this.canvas.height = node.videoHeight;
        this.hasFrame = false;
      }
      this.canvas.getContext('2d', { alpha: false }).drawImage(node, 0, 0);
      this.hasFrame = true;
    }
    return this.hasFrame ? this.canvas : null;
  }
}

module.exports = { seekTrack, finishSeek, PreviewFrameCache };
