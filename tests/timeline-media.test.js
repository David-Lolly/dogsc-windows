'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const timeline=require('../src/core/timeline'),{mediaTime,audioPieces}=require('../src/core/media-time'),{segmentVolume}=require('../src/core/segment-audio');
const {easedProgress}=require('../src/core/zoom');
const pieces=[{id:'a',sourceStart:0,sourceEnd:2,speed:1},{id:'b',sourceStart:2,sourceEnd:4,speed:1},{id:'c',sourceStart:4,sourceEnd:6,speed:1}];
test('reordering preserves source mapping and renders retained effect fragments separately',()=>{
  const reordered=timeline.reorderSegment(pieces,'b',2);assert.deepEqual(reordered.map(c=>c.id),['a','c','b']);
  assert.equal(timeline.sourceToOutput(reordered,3),5);assert.equal(timeline.locate(reordered,3).sourceTime,5);
  const spans=timeline.retainedSpans(reordered,1,5);assert.deepEqual(spans.map(s=>[s.outputStart,s.outputEnd]),[[1,2],[2,3],[4,6]]);
  assert.equal(timeline.restoreGap(reordered,'a','c'),null);
  assert.equal(timeline.restoreGap([pieces[0],pieces[2]],'a','c').length,3);
});
test('trim respects all retained source intervals after reordering and split copies audio settings',()=>{
  const reordered=timeline.reorderSegment(pieces,'b',2),trimmed=timeline.trimSegment(reordered,'c','start',1,6);
  assert.equal(trimmed[1].sourceStart,4);
  const split=timeline.splitAt([{...pieces[0],audio:{microphoneVolume:0.4}}],1);split[1].audio.microphoneVolume=0.9;assert.equal(split[0].audio.microphoneVolume,0.4);
  assert.equal(timeline.snapTime(0.98,[0,1,2],0.03),1);assert.equal(timeline.snapTime(0.8,[1],0.03),0.8);
});
test('auxiliary source trim, rate and sync anchors share a monotonic time map',()=>{
  const ref={duration:20,offset:0.5,sourceStartTime:1,sourceEndTime:12,sourceTimeScale:1.01,syncAnchors:[{id:'a',sourceTime:10,offset:0.2}]};
  const value=mediaTime(ref,5);assert.ok(Math.abs(value.time-(1+4.5*1.01+0.1))<1e-9);assert.ok(Math.abs(value.rate-1.03)<1e-9);assert.equal(mediaTime(ref,0).inRange,false);
  const split=audioPieces({...ref,volume:1},[{sourceStart:5,sourceEnd:15,speed:2}]);assert.equal(split.length,2);assert.equal(split.reduce((n,s)=>n+s.duration,0),5);
});
test('per-segment mute and volume override global defaults in preview/export',()=>{
  const p={audio:{isMicrophoneMuted:true,microphoneVolume:0.2,isSystemMuted:false,systemVolume:0.8}};
  assert.equal(segmentVolume(p,{audio:{isMicrophoneMuted:false,microphoneVolume:0.6}},'microphone'),0.6);
  assert.equal(segmentVolume(p,{audio:{isSystemMuted:true}},'system'),0);
  assert.equal(segmentVolume(p,{},'system'),0.8);
});
test('custom cubic curve is evaluated by its time coordinate',()=>{
  const motion={};const linear={x1:0.2,y1:0.2,x2:0.8,y2:0.8};
  assert.ok(Math.abs(easedProgress(0.3,'custom',motion,linear)-0.3)<0.0001);
  const ease={x1:0.1,y1:0.8,x2:0.2,y2:1};assert.ok(easedProgress(0.3,'custom',motion,ease)>0.7);
});
