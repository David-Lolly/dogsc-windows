'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {makeProject,normalizeProject,validateProjectContract}=require('../src/core/model');
const {splitEffects}=require('../src/core/effect-slices'),{evaluateScene}=require('../src/core/scene');
const {copyEffects,planPaste}=require('../src/core/effect-clipboard');
const make=()=>{
  const p=makeProject({name:'split',media:{screen:{file:'screen.mp4',width:1920,height:1080,duration:20},camera:{file:'camera.mp4',width:640,height:480,duration:20}}});
  p.zoomAnimations=[{id:'z',startTime:1,endTime:4,enterDuration:2,exitDuration:1,scale:1.6,easing:'gentle',focus:{x:0.4,y:0.6},origin:'manual'}];
  p.timeline.screenMotionClips=[{id:'s',groupID:'pair',timing:{startTime:1,duration:3,leadInDuration:2,returnDuration:1,easing:'linear'},target:{position:{x:0.5,y:0.5},scale:1,rotationX:20,rotationY:-30,rotationZ:8,perspective:0.65}}];
  p.timeline.cameraMotionClips=[{id:'c',groupID:'pair',timing:{startTime:1,duration:3,leadInDuration:2,returnDuration:1,easing:'linear'},target:{layout:{kind:'fullscreen'},position:{x:0.2,y:0.3},size:0.7,roundness:0,opacity:1}}];return p;
};
const close=(a,b)=>{if(typeof a==='number'&&typeof b==='number')return assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);if(a&&b&&typeof a==='object'&&typeof b==='object'){assert.deepEqual(Object.keys(a),Object.keys(b));for(const key of Object.keys(a))close(a[key],b[key]);}else assert.deepEqual(a,b);};
const scene=(p,time)=>evaluateScene(p,{time,width:960,height:540,sourceAspect:16/9,cameraAspect:4/3,zoomClips:p.zoomAnimations,pointerTrack:null});
test('split zoom and paired motion retain every sampled scene across entrance, body and return',()=>{
  for(const cut of [1.4,2.5,3.8]){
    const p=make(),before=Array.from({length:151},(_,i)=>scene(p,i/25));
    const result=splitEffects(p,[{type:'zoom',id:'z'},{type:'screenMotion',id:'s'}],cut,'.');
    assert.equal(result.project.schema,3);assert.equal(result.selections.length,3);assert.equal(p.schema,2);
    const q=normalizeProject(JSON.parse(JSON.stringify(result.project)));
    for(let i=0;i<before.length;i++)close(scene(q,i/25),before[i]);
    const second=splitEffects(q,result.selections,3.9,'.').project;
    for(let i=0;i<before.length;i++)close(scene(second,i/25),before[i]);
  }
});
test('slice copy and movement preserve phase and reject malformed sampling sources',()=>{
  const p=make(),r=splitEffects(p,[{type:'zoom',id:'z'}],2.5,'.'),q=r.project;
  const payload=copyEffects(q,r.selections,'.');assert.equal(payload.version,2);
  const [entry]=planPaste(q,payload,8,'.');q.zoomAnimations.push(entry.clip);
  for(const delta of [0,0.1,0.5,1.4])close(scene(q,8+delta).screen.zoom,scene(p,2.5+delta).screen.zoom);
  entry.clip.animationSlice.track[0].animationSlice={};assert.throws(()=>validateProjectContract(q),/数据无效/);
});
test('schema upgrade preserves the original schema 2 file once and future formats remain protected',()=>{
  const dir=fs.mkdtempSync(path.join(path.resolve(__dirname,'../../analysis/results'),'dogsc-slice-'));
  try{
    const {writeProject,readProject}=require('../src/main/project-files'),p=make();writeProject(dir,p);
    const original=fs.readFileSync(path.join(dir,'project.json'));
    const q=splitEffects(p,[{type:'zoom',id:'z'}],2.5,dir).project;writeProject(dir,q);writeProject(dir,q);
    assert.deepEqual(fs.readFileSync(path.join(dir,'project.json.schema2.bak')),original);assert.equal(readProject(path.join(dir,'project.json')).schema,3);
    q.schema=2;assert.throws(()=>validateProjectContract(q),/版本过旧/);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
