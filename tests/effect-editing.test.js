'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {makeProject,validateProjectContract}=require('../src/core/model');
const {makeClip}=require('../src/core/zoom'),{makeSticker,makeMosaic}=require('../src/core/overlays');
const {copyEffects,planPaste,validatePayload}=require('../src/core/effect-clipboard');
const {selectionTab,isTextEditing,compactNumber}=require('../src/core/editor-selection');
const {decorationGeometry}=require('../src/core/screen-decoration');
const {EffectClipboard,PREFIX}=require('../src/main/effect-clipboard');
test('production clipboard bridge works with text-only async APIs, without buffer methods',async()=>{
  const p=make();p.timeline.screenMotionClips=[screen()];const payload=copyEffects(p,{type:'screenMotion',id:'s'},'synthetic');let text='';
  const clipboard={writeText:async value=>{await Promise.resolve();text=value;},readText:async()=>text},bridge=new EffectClipboard(clipboard);
  await bridge.copy(payload);assert.ok(text.startsWith(PREFIX));assert.deepEqual(await bridge.paste(),payload);
  text='ordinary text';await assert.rejects(bridge.paste(),/没有可粘贴/);
  text=PREFIX+'{broken';await assert.rejects(bridge.paste(),/已损坏/);
});
test('clipboard failure is reported instead of silently claiming copy success',async()=>{
  const p=make();p.timeline.screenMotionClips=[screen()];const payload=copyEffects(p,{type:'screenMotion',id:'s'},'synthetic');
  const bridge=new EffectClipboard({writeText:async()=>{throw Error('clipboard busy');},readText:async()=>''});await assert.rejects(bridge.copy(payload),/clipboard busy/);
});
test('visible chrome and shadow share one outer rectangle and radius',()=>{
  const screen={finalRect:{x:100,y:100,width:400,height:220},cornerRadius:18,borderWidth:0,decoration:{style:'browserLight',left:6,right:6,top:38,bottom:6}};
  assert.deepEqual(decorationGeometry(screen),{rect:{x:94,y:62,width:412,height:264},radius:24});
  screen.decoration.style='none';screen.borderWidth=3;assert.deepEqual(decorationGeometry(screen),{rect:{x:97,y:97,width:406,height:226},radius:21});
});
test('authored frame corners and opacity enter the shared scene with schema validation',()=>{
  const p=make();Object.assign(p.canvas,{screenFrame:'browserLight',screenFrameOuterCornerRadius:60,screenFrameContentCornerRadius:12,screenFrameInsetOpacity:0.4});
  const scene=require('../src/core/scene').evaluateScene(p,{time:0,width:1920,height:1080,sourceAspect:16/9,cameraAspect:null,zoomClips:[],pointerTrack:null});
  assert.equal(scene.screen.decoration.outerCornerRadius,60);assert.equal(scene.screen.cornerRadius,12);assert.equal(scene.screen.decoration.insetOpacity,0.4);validateProjectContract(p);
  p.canvas.screenFrameOuterCornerRadius=201;assert.throws(()=>validateProjectContract(p),/圆角/);p.canvas.screenFrameOuterCornerRadius=null;p.canvas.screenFrameInsetOpacity=-0.1;assert.throws(()=>validateProjectContract(p),/透明度/);
});
const make=()=>makeProject({media:{screen:{file:'screen.mp4',width:640,height:360,duration:20},camera:{file:'camera.mp4',width:640,height:480,duration:20}}});
const timing=()=>({startTime:1,duration:2,leadInDuration:0.5,returnDuration:0.5,easing:'linear'});
const screen=()=>({id:'s',timing:timing(),target:{position:{x:0.4,y:0.6},scale:0.9393313663236641,rotationX:15,rotationY:-20,rotationZ:5,perspective:0.8}});
const camera=()=>({id:'c',timing:timing(),target:{position:{x:0.2,y:0.3},size:0.3,roundness:0.5,opacity:0.6,layout:{kind:'fullscreen'}}});
function storeFor(project){
  const file=path.resolve(__dirname,'../src/renderer/editor/store.js'),module={exports:{}};
  vm.runInNewContext(fs.readFileSync(file,'utf8'),{module,require:id=>id==='electron'?{ipcRenderer:{invoke:async()=>{}}}:id==='./export'?{loadPointerTrack:()=>null}:require(path.resolve(path.dirname(file),id)),setTimeout:()=>0,clearTimeout:()=>{},console});
  return new module.exports.Store('synthetic',project);
}
test('all five effect types preserve settings, get new IDs, and move to the playhead',()=>{
  for(const type of ['zoom','screenMotion','cameraMotion','sticker','mosaic']){
    const p=make(),clip=type==='zoom'?makeClip({startTime:1,endTime:3,scale:1.7,enterDuration:0.5,exitDuration:0.5}):type==='screenMotion'?screen():type==='cameraMotion'?camera():type==='sticker'?makeSticker('media/sticker.png',1,2):makeMosaic(1,2);
    const pool=type==='zoom'?p.zoomAnimations:p.timeline[`${type}Clips`];pool.push(clip);
    const payload=copyEffects(p,{type,id:clip.id},'synthetic'),original=JSON.stringify(p),entries=planPaste(p,payload,8,'synthetic'),copy=entries[0].clip;
    assert.notEqual(copy.id,clip.id);assert.equal(type==='zoom'?copy.startTime:copy.timing.startTime,8);
    assert.equal(type==='zoom'?copy.endTime-copy.startTime:copy.timing.duration,2);
    if(clip.target)assert.deepEqual(copy.target,clip.target);
    assert.equal(JSON.stringify(p),original);assert.equal(type==='zoom'?payload.entries[0].clip.startTime:payload.entries[0].clip.timing.startTime,1);
    pool.push(copy);validateProjectContract(p);
  }
});
test('paired layout clipboard duplicates partners atomically with a new shared group',()=>{
  const p=make();p.timeline.screenMotionClips=[{...screen(),groupID:'group'}];p.timeline.cameraMotionClips=[{...camera(),groupID:'group'}];
  const store=storeFor(p);store.select({type:'screenMotion',id:'s'});const payload=store.copyEffects();assert.equal(payload.entries.length,2);
  store.pasteEffects(payload,8);assert.equal(store.project.timeline.screenMotionClips.length,2);assert.equal(store.project.timeline.cameraMotionClips.length,2);
  const a=store.project.timeline.screenMotionClips[1],b=store.project.timeline.cameraMotionClips[1];assert.equal(a.groupID,b.groupID);assert.notEqual(a.groupID,'group');
  assert.equal(store.selection.id,a.id);store.undo();assert.equal(store.project.timeline.screenMotionClips.length,1);assert.equal(store.project.timeline.cameraMotionClips.length,1);
  store.redo();assert.equal(store.project.timeline.screenMotionClips.length,2);assert.equal(store.project.timeline.cameraMotionClips.length,2);
});
test('paste rejects overlaps, short tails, missing camera and foreign sticker assets without changing the project',()=>{
  const p=make();p.zoomAnimations=[makeClip({startTime:1,endTime:3,exitDuration:1})];
  const payload=copyEffects(p,{type:'zoom',id:p.zoomAnimations[0].id},'synthetic'),before=JSON.stringify(p);
  assert.throws(()=>planPaste(p,payload,2,'synthetic'),/重叠/);assert.throws(()=>planPaste(p,payload,3.5,'synthetic'),/重叠/);assert.throws(()=>planPaste(p,payload,19,'synthetic'),/时长不足/);
  assert.equal(JSON.stringify(p),before);
  p.timeline.cameraMotionClips=[camera()];const cameraPayload=copyEffects(p,{type:'cameraMotion',id:'c'},'synthetic');p.media.camera=null;assert.throws(()=>planPaste(p,cameraPayload,8,'synthetic'),/没有摄像头/);
  const sticker=makeSticker('media/owned.png',1,2);p.timeline.stickerClips=[sticker];assert.throws(()=>planPaste(p,copyEffects(p,{type:'sticker',id:sticker.id},'synthetic'),8,'other-project'),/跨工程/);
  assert.throws(()=>validatePayload({version:1,sourceDirectory:'x',anchor:0,entries:[{type:'__proto__',clip:{}}]}),/无效/);
});
test('selection maps to the proper inspector and typing keeps native clipboard shortcuts',()=>{
  assert.equal(selectionTab({type:'zoom'}),'motion');assert.equal(selectionTab({type:'screenMotion'}),'screenMotion');assert.equal(selectionTab({type:'cameraMotion'}),'cameraMotion');assert.equal(selectionTab(null),null);
  assert.equal(isTextEditing({tagName:'INPUT',type:'text'}),true);assert.equal(isTextEditing({tagName:'INPUT',type:'range'}),false);assert.equal(isTextEditing({isContentEditable:true}),true);
  assert.equal(compactNumber(0.9393313663236641),'0.9393');assert.equal(compactNumber(1),'1');assert.equal(compactNumber(NaN),'—');
});
