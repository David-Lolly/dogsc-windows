'use strict';
const { easedProgress, ADJACENCY_TOLERANCE } = require('./zoom');
const clamp01 = (n) => Math.min(Math.max(n, 0), 1);
const orderedEffects = (clips = []) => [...clips].sort((a, b) => a.timing.startTime - b.timing.startTime || a.id.localeCompare(b.id));
function timingProgress(timing, time, motion, holds = false) {
  const t = timing, end = t.startTime + t.duration;
  if (time < t.startTime) return 0;
  const lead = Math.min(t.leadInDuration, t.duration);
  if (lead > 0 && time < t.startTime + lead) return easedProgress((t.leadInProgressOffset || 0)
    + (1 - (t.leadInProgressOffset || 0)) * clamp01((time-t.startTime)/lead), t.easing, motion,t.customCurve);
  if (time < end) return 1;
  if (t.returnDuration > 0) return 1 - easedProgress((t.returnProgressOffset || 0)
    + (1 - (t.returnProgressOffset || 0)) * clamp01((time-end)/t.returnDuration), t.easing, motion,t.customCurve);
  return holds ? 1 : 0;
}
function activeEffect(clips, time) {
  const list = orderedEffects(clips);
  let active = null;
  for (const clip of list) {
    if (clip.timing.startTime > time) break;
    active = clip;
  }
  if (active && active.timing.returnDuration > 0 && time >= active.timing.startTime + active.timing.duration + active.timing.returnDuration) return null;
  return active;
}
function targetTransition(clips, time, base, motion) {
  const list = orderedEffects(clips);
  let inherited = base;
  for (let i = 0; i < list.length; i++) {
    const clip = list[i], t = clip.timing, end = t.startTime + t.duration;
    if (time < t.startTime) break;
    if (time < end) {
      const lead = Math.min(t.duration, t.leadInDuration);
      const linear = lead > 0 ? clamp01((time-t.startTime)/lead) : 1;
      return { from: inherited, to: clip.target,
        progress: easedProgress((t.leadInProgressOffset || 0) + (1-(t.leadInProgressOffset || 0))*linear, t.easing, motion,t.customCurve) };
    }
    const next = list[i+1];
    if (next && Math.abs(next.timing.startTime-end) <= ADJACENCY_TOLERANCE) { inherited = clip.target; continue; }
    if (t.returnDuration > 0) {
      if (time < end+t.returnDuration) return { from: clip.target, to: base, progress: 1-timingProgress(t,time,motion) };
      inherited = base;
    } else inherited = clip.target;
  }
  return { from: inherited, to: inherited, progress: 1 };
}
module.exports = { timingProgress, activeEffect, targetTransition, orderedEffects };
