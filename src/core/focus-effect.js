'use strict';
const { activeEffect, timingProgress } = require('./effect-timing');
function defaultFocus(linear = false) {
  return { shape: linear ? 'linear' : 'radial', angleDegrees: 0, target: linear ? 'fixed' : 'animation',
    center: { x: 0.5, y: 0.5 }, size: linear ? 0.32 : 0.45, blur: 0.35, softness: 0.5, dimming: linear ? 0 : 0.18 };
}
function evaluateFocus(project, time, screen, zoomClips, pointerTrack) {
  const motionClip = activeEffect(project.timeline.screenMotionClips, time);
  const zoom = [...zoomClips].reverse().find((c) => c.startTime <= time && time < c.endTime + c.exitDuration);
  let effect, timing, anchor, holds = false;
  if (motionClip?.focusEffect) {
    effect = { ...defaultFocus(true), ...motionClip.focusEffect };
    timing = motionClip.timing; holds = timing.returnDuration === 0;
    anchor = { x: screen.crop.x + motionClip.target.position.x * screen.crop.width,
      y: screen.crop.y + motionClip.target.position.y * screen.crop.height };
  } else if (zoom?.focusEffect) {
    effect = { ...defaultFocus(), ...zoom.focusEffect };
    timing = { startTime: zoom.startTime, duration: zoom.endTime-zoom.startTime, leadInDuration: zoom.enterDuration,
      returnDuration: zoom.exitDuration, easing: zoom.easing,customCurve:zoom.customCurve, leadInProgressOffset: zoom.enterProgressOffset, returnProgressOffset: zoom.exitProgressOffset };
    anchor = { x: screen.crop.x+screen.zoom.focus.x*screen.crop.width, y: screen.crop.y+screen.zoom.focus.y*screen.crop.height };
  } else return null;
  if (effect.blur <= 0 && effect.dimming <= 0) return null;
  const progress = timingProgress(timing, time, project.motion, holds);
  if (progress <= 0) return null;
  const pointer = effect.target === 'pointer' && pointerTrack
    ? pointerTrack.evaluation(time, project.motion, project.cursorStyle).position : null;
  const point = effect.target === 'fixed' ? effect.center : pointer || anchor;
  const center = { x: (point.x-screen.crop.x)/screen.crop.width, y: (point.y-screen.crop.y)/screen.crop.height };
  if (center.x < 0 || center.x > 1 || center.y < 0 || center.y > 1) return null;
  return { effect, center, progress };
}
module.exports = { defaultFocus, evaluateFocus };
