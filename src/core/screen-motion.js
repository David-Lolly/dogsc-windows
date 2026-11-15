'use strict';
const { easedProgress, ADJACENCY_TOLERANCE } = require('./zoom');
const mix = (a, b, t) => a + (b - a) * t;
const baseState = (canvas) => ({ position: { ...canvas.contentPosition }, scale: canvas.contentScale,
  rotationX: 0, rotationY: 0, rotationZ: 0, perspective: 0.65 });

function orderedScreenClips(clips = []) {
  return [...clips].sort((a, b) => a.timing.startTime - b.timing.startTime || a.id.localeCompare(b.id));
}

function directOffset(state, viewport, focus) {
  const w = viewport.fittedWidth * state.scale, h = viewport.fittedHeight * state.scale;
  const border = viewport.borderWidth * state.scale;
  const d=viewport.decoration||{left:0,right:0,top:0,bottom:0},left=border+d.left*state.scale,right=border+d.right*state.scale,top=border+d.top*state.scale,bottom=border+d.bottom*state.scale;
  if (!focus) return { x: state.position.x*(viewport.width-w-left-right)+w/2+left-viewport.width/2,
    y: state.position.y*(viewport.height-h-top-bottom)+h/2+top-viewport.height/2 };
  const recenter = Math.min(Math.max((state.scale - 1) / 2, 0), 1) * 0.62;
  return { x: mix(left + state.position.x * Math.max(viewport.width - left-right, 0), (viewport.width+left-right)/2, recenter)
      + (0.5 - state.position.x) * w - viewport.width / 2,
    y: mix(top + state.position.y * Math.max(viewport.height - top-bottom, 0), (viewport.height+top-bottom)/2, recenter)
      + (0.5 - state.position.y) * h - viewport.height / 2 };
}

function interpolate(from, to, progress, viewport, fromFocus, toFocus, anchor) {
  const t = Math.min(Math.max(progress, 0), 1), state = { position: {
    x: mix(from.position.x, to.position.x, t), y: mix(from.position.y, to.position.y, t) } };
  for (const key of ['scale', 'perspective']) state[key] = mix(from[key], to[key], t);
  for (const key of ['rotationX', 'rotationY', 'rotationZ']) {
    let delta = (to[key] - from[key]) % 360;
    if (delta > 180) delta -= 360;
    if (delta < -180) delta += 360;
    state[key] = from[key] + delta * t;
  }
  const a = directOffset(from, viewport, fromFocus), b = directOffset(to, viewport, toFocus);
  return { state, offset: { x: mix(a.x, b.x, t), y: mix(a.y, b.y, t) }, anchor };
}

// Source-time evaluation. Touching targets inherit directly; a separated clip
// with returnDuration returns to base. Pixel offsets avoid division by a card
// size crossing the canvas size during magnification (Mac ScreenMotionTrack).
function sampleScreenMotion(clips, time, canvas, motion, viewport) {
  const base = baseState(canvas), ordered = orderedScreenClips(clips);
  let previous = base, previousFocus = false;
  for (let i = 0; i < ordered.length; i++) {
    const clip = ordered[i], timing = clip.timing, end = timing.startTime + timing.duration;
    if (time < timing.startTime) break;
    const next = ordered[i + 1];
    const touches = next && Math.abs(next.timing.startTime - end) <= ADJACENCY_TOLERANCE;
    const ease = (value, offset = 0) => easedProgress(offset + (1 - offset) * Math.min(Math.max(value, 0), 1), timing.easing, motion,timing.customCurve);
    if (time < end) {
      const lead = Math.min(timing.leadInDuration, timing.duration);
      const t = lead <= 0.0001 ? 1 : ease((time - timing.startTime) / lead, timing.leadInProgressOffset || 0);
      return interpolate(previous, clip.target, t, viewport, previousFocus, true, clip.target.position);
    }
    if (touches) { previous = clip.target; previousFocus = true; continue; }
    if (timing.returnDuration > 0.0001) {
      if (time < end + timing.returnDuration) {
        return interpolate(clip.target, base, ease((time - end) / timing.returnDuration, timing.returnProgressOffset || 0),
          viewport, true, false, clip.target.position);
      }
      previous = base; previousFocus = false;
    } else { previous = clip.target; previousFocus = true; }
  }
  return interpolate(previous, previous, 1, viewport, previousFocus, previousFocus, previous.position);
}

module.exports = { orderedScreenClips, sampleScreenMotion };
