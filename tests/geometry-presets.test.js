'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {projectScreen,mapPlanePoint}=require('../src/core/screen-projection');
const {makeProject}=require('../src/core/model'),{ScenePresets}=require('../src/main/scene-presets');
const {PointerTrack}=require('../src/core/pointer');
function storeFor(project){
  const vm=require('node:vm'),file=path.resolve(__dirname,'../src/renderer/editor/store.js'),module={exports:{}};
  vm.runInNewContext(fs.readFileSync(file,'utf8'),{module,require:id=>id==='electron'?{ipcRenderer:{invoke:async()=>{}}}:id==='./export'?{loadPointerTrack:()=>null}:require(path.resolve(path.dirname(file),id)),setTimeout:()=>0,clearTimeout:()=>{},console});
  return new module.exports.Store('synthetic',project);
}
test('paired layout timing and deletion undo as one edit; media calibration also undoes',()=>{
  const project=makeProject({media:{screen:{width:640,height:360,duration:3},camera:{file:'camera.mp4',duration:3,offset:0}}});
  const timing={startTime:0,duration:1,leadInDuration:0.2,returnDuration:0.2};
  project.timeline.screenMotionClips=[{id:'screen',groupID:'paired',timing:{...timing}}];
  project.timeline.cameraMotionClips=[{id:'camera',groupID:'paired',timing:{...timing}}];
  const store=storeFor(project);store.mutate(p=>{p.timeline.screenMotionClips[0].timing.startTime=0.5;});
  assert.equal(store.project.timeline.cameraMotionClips[0].timing.startTime,0.5);
  store.undo();assert.equal(store.project.timeline.cameraMotionClips[0].timing.startTime,0);
  store.redo();assert.equal(store.project.timeline.screenMotionClips[0].timing.startTime,0.5);
  store.deleteEffect('cameraMotion','camera');assert.equal(store.project.timeline.screenMotionClips.length,0);assert.equal(store.project.timeline.cameraMotionClips.length,0);
  store.undo();assert.equal(store.project.timeline.screenMotionClips.length,1);assert.equal(store.project.timeline.cameraMotionClips.length,1);
  store.mutate(p=>{p.media.camera.offset=0.3;});store.undo();assert.equal(store.project.media.camera.offset,0);store.redo();assert.equal(store.project.media.camera.offset,0.3);
});
test('cursor tilt follows direction, anchors at rest, and respects disabled motion',()=>{
  const project=makeProject({media:{screen:{width:640,height:360,duration:3}}});
  const events=Array.from({length:121},(_,i)=>({time:i/120,x:0.1+i/150,y:0.4,kind:'move'})),track=new PointerTrack(events);
  const a=track.evaluation(0.5,project.motion,project.cursorStyle).cursor.rotationRadians;
  assert.ok(a<0&&Number.isFinite(a));
  const strong=track.evaluation(0.5,project.motion,{...project.cursorStyle,motionTiltStrength:4}).cursor.rotationRadians;
  assert.ok(Math.abs(strong)>Math.abs(a));
  assert.equal(track.evaluation(0.5,{...project.motion,cursor:'none'},project.cursorStyle).cursor.rotationRadians,0);
  assert.equal(track.evaluation(1.5,project.motion,project.cursorStyle).cursor.rotationRadians,0);
  assert.equal(track.evaluation(-1,project.motion,project.cursorStyle).cursor,null);
});
test('projected canvas editing inverts the same homography used by the GPU',()=>{
  const rect={x:100,y:80,width:640,height:360};
  for(const rotationY of [-60,-20,0,40,75]){
    const quad=projectScreen(rect,{rotationX:20,rotationY,rotationZ:15,perspective:0.65});
    for(const [u,v]of[[0,0],[0.2,0.7],[0.5,0.5],[1,1]]){const p={x:rect.x+u*rect.width,y:rect.y+v*rect.height},q=mapPlanePoint(quad,rect,p),back=mapPlanePoint(quad,rect,q,true);assert.ok(Math.abs(p.x-back.x)<1e-7&&Math.abs(p.y-back.y)<1e-7);}
  }
});
test('scene preset stores an owned background copy and applies it into another project',()=>{
  const root=path.resolve(__dirname,'../../analysis/results');fs.mkdirSync(root,{recursive:true});const dir=fs.mkdtempSync(path.join(root,'presets-'));
  try{const a=path.join(dir,'a'),b=path.join(dir,'b');fs.mkdirSync(a);fs.mkdirSync(b);fs.writeFileSync(path.join(a,'background.png'),'owned pixels');
    const project=makeProject({name:'preset',media:{screen:{width:640,height:360,duration:3}}});project.canvas.background={kind:'image',file:'background.png'};
    const library=new ScenePresets(path.join(dir,'library')),id=library.save('测试场景',project,a);fs.writeFileSync(path.join(a,'background.png'),'changed');
    const style=library.apply(id,b);assert.equal(fs.readFileSync(path.join(b,style.canvas.background.file),'utf8'),'owned pixels');assert.equal(library.read().length,1);library.remove(id);assert.equal(library.read().length,0);assert.equal(library.list().length,6);
  }finally{assert.ok(path.resolve(dir).startsWith(root+path.sep));fs.rmSync(dir,{recursive:true,force:true});}
});
