'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {makeProject,normalizeProject,validateProjectContract}=require('../src/core/model');
const {defaultFocus,evaluateFocus}=require('../src/core/focus-effect');
const {sampleCameraMotion}=require('../src/core/camera-motion');
const {defaultOpening,normalizeOpening,openingSample}=require('../src/core/opening-sequence');
const {evaluateScene}=require('../src/core/scene');
const make=()=>makeProject({name:'effects',media:{screen:{file:'screen.mp4',width:1920,height:1080,duration:10},camera:{file:'camera.mp4',width:640,height:480,duration:10}}});
const timing=(start=1)=>({startTime:start,duration:2,leadInDuration:1,returnDuration:1,easing:'linear'});
const camera=(id,start,layout={kind:'fullscreen'},opacity=1)=>({id,timing:timing(start),target:{layout,position:{x:0.2,y:0.3},size:0.7,roundness:0,opacity}});
const scene=(p,time)=>evaluateScene(p,{time,width:1920,height:1080,sourceAspect:16/9,cameraAspect:4/3,zoomClips:p.zoomAnimations,pointerTrack:null});

test('camera layout interpolates continuously to fullscreen and returns',()=>{
  const p=make();p.timeline.cameraMotionClips=[camera('a',1)];
  assert.equal(sampleCameraMotion(p,1.5,4/3,16/9).fullscreenProgress,0.5);
  const full=scene(p,2.5).camera;
  assert.deepEqual(full.rect,{x:0,y:0,width:1920,height:1080});assert.equal(full.cornerRadius,0);assert.equal(full.borderWidth,0);
  assert.equal(sampleCameraMotion(p,3.5,4/3,16/9).fullscreenProgress,0.5);
  assert.equal(sampleCameraMotion(p,4,4/3,16/9).fullscreenProgress,0);
});
test('hidden camera target fades at the inherited geometry instead of flying away',()=>{
  const p=make();p.timeline.cameraMotionClips=[camera('a',1,{kind:'fullscreen'},0)];
  const base=sampleCameraMotion(p,0,4/3,16/9),fade=sampleCameraMotion(p,1.5,4/3,16/9);
  assert.deepEqual(fade.position,base.position);assert.equal(fade.fullscreenProgress,0);assert.equal(fade.opacity,0.5);
});
test('camera track rejects overlap and roundtrips authored targets',()=>{
  const p=make();p.timeline.cameraMotionClips=[camera('a',1)];
  assert.deepEqual(normalizeProject(JSON.parse(JSON.stringify(p))).timeline.cameraMotionClips,p.timeline.cameraMotionClips);
  p.timeline.cameraMotionClips.push(camera('b',2));assert.throws(()=>validateProjectContract(p),/重叠/);
});
test('3D focus takes precedence over zoom focus and follows entrance/exit',()=>{
  const p=make();p.zoomAnimations=[{id:'z',startTime:1,endTime:3,enterDuration:1,exitDuration:1,scale:1.6,easing:'linear',focus:{x:0.5,y:0.5},origin:'manual',focusEffect:defaultFocus()}];
  p.timeline.screenMotionClips=[{id:'s',timing:timing(),target:{position:{x:0.5,y:0.5},scale:1,rotationX:0,rotationY:0,rotationZ:0,perspective:0.65},focusEffect:defaultFocus(true)}];
  assert.equal(scene(p,1.5).screen.focusEffect.effect.shape,'linear');
  assert.equal(scene(p,1.5).screen.focusEffect.progress,0.5);
  assert.equal(scene(p,3.5).screen.focusEffect.progress,0.5);
  assert.equal(scene(p,4).screen.focusEffect,null);
});
test('fixed focus outside the source crop disables the effect',()=>{
  const p=make();p.canvas.crop={x:0.5,y:0,width:0.5,height:1};
  p.zoomAnimations=[{id:'z',startTime:0,endTime:3,enterDuration:0,exitDuration:0,scale:1.6,easing:'linear',focus:{x:0.75,y:0.5},origin:'manual',focusEffect:{...defaultFocus(),target:'fixed',center:{x:0.1,y:0.5}}}];
  assert.equal(scene(p,1).screen.focusEffect,null);
});
test('opening staggers participants inside its total duration and settles exactly',()=>{
  const s=normalizeOpening({...defaultOpening(),isEnabled:true,duration:0.4,stagger:1.2});
  assert.ok(s.stagger<=0.11+1e-9);
  assert.equal(openingSample(s,'screen',0,1920,1080,['screen','camera']).opacity,0);
  assert.equal(openingSample(s,'camera',0.1,1920,1080,['screen','camera']).opacity,0);
  const settled=openingSample(s,'camera',0.4,1920,1080,['screen','camera']);
  assert.equal(settled.opacity,1);assert.equal(settled.scale,1);assert.deepEqual(settled.offset,{x:0,y:0});
});
test('all opening presets reach identity with and without camera availability',()=>{
  const p=make();p.openingSequence.isEnabled=true;
  for (const preset of ['converge','sideSlide','light3D']) {
    p.openingSequence.preset=preset;
    assert.equal(scene(p,0).screen.opacity,0);assert.equal(scene(p,0).camera.opacity,0);
    assert.equal(scene(p,3).screen.opacity,1);assert.equal(scene(p,3).camera.opacity,1);
  }
  p.camera.isHidden=true;assert.equal(scene(p,0).camera,null);
});
test('invalid focus and opening values cannot be saved',()=>{
  const p=make();p.openingSequence.duration=NaN;assert.throws(()=>validateProjectContract(p),/开场/);
  p.openingSequence=defaultOpening();p.zoomAnimations=[{focusEffect:{...defaultFocus(),blur:NaN}}];
  assert.throws(()=>validateProjectContract(p),/聚焦/);
});
