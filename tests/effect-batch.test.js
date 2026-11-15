'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {makeProject}=require('../src/core/model'),{makeClip}=require('../src/core/zoom'),{makeMosaic}=require('../src/core/overlays');
const {copyEffects,planPaste}=require('../src/core/effect-clipboard'),{moveEffects}=require('../src/core/effect-batch');
const make=()=>makeProject({media:{screen:{file:'screen.mp4',width:640,height:360,duration:20}}});
function storeFor(p){const file=path.resolve(__dirname,'../src/renderer/editor/store.js'),module={exports:{}};vm.runInNewContext(fs.readFileSync(file,'utf8'),{module,require:id=>id==='electron'?{ipcRenderer:{invoke:async()=>{}}}:id==='./export'?{loadPointerTrack:()=>null}:require(path.resolve(path.dirname(file),id)),setTimeout:()=>0,clearTimeout:()=>{},console});return new module.exports.Store('synthetic',p);}
test('multi-effect clipboard preserves relative offsets and gives every copy a new ID',()=>{
  const p=make(),a=makeClip({startTime:1,endTime:2,exitDuration:0.2}),b=makeMosaic(3,2);p.zoomAnimations=[a];p.timeline.mosaicClips=[b];
  const payload=copyEffects(p,[{type:'zoom',id:a.id},{type:'mosaic',id:b.id}],'synthetic'),copies=planPaste(p,payload,8,'synthetic');assert.equal(copies[0].clip.startTime,8);assert.equal(copies[1].clip.timing.startTime,10);assert.notEqual(copies[0].clip.id,a.id);assert.notEqual(copies[1].clip.id,b.id);
});
test('batch moves are atomic when another lane conflicts or a boundary is exceeded',()=>{
  const p=make(),a=makeClip({startTime:1,endTime:2,exitDuration:0.2}),b=makeMosaic(3,2);p.zoomAnimations=[a,makeClip({startTime:6,endTime:7})];p.timeline.mosaicClips=[b];
  const entries=copyEffects(p,[{type:'zoom',id:a.id},{type:'mosaic',id:b.id}],'synthetic').entries,before=JSON.stringify(p);
  const moved=moveEffects(p,entries,2);assert.equal(moved[0].clip.startTime,3);assert.equal(moved[1].clip.timing.startTime,5);assert.equal(JSON.stringify(p),before);
  assert.throws(()=>moveEffects(p,entries,5),/重叠/);assert.throws(()=>moveEffects(p,entries,-2),/范围/);assert.equal(JSON.stringify(p),before);
});
test('toggle, select all, batch deletion and undo keep the last main clip protected',()=>{
  const p=make(),a=makeClip({startTime:1,endTime:2}),b=makeMosaic(4,2);p.zoomAnimations=[a];p.timeline.mosaicClips=[b];const store=storeFor(p);
  store.select({type:'zoom',id:a.id});store.select({type:'mosaic',id:b.id},{toggle:true});assert.equal(store.selections.length,2);assert.ok(store.isSelected('zoom',a.id));store.deleteSelections();assert.equal(store.project.zoomAnimations.length,0);assert.equal(store.project.timeline.mosaicClips.length,0);store.undo();assert.equal(store.project.zoomAnimations.length,1);assert.equal(store.project.timeline.mosaicClips.length,1);
  store.selectAllEffects();assert.equal(store.selections.length,2);store.select({type:'segment',id:store.project.timeline.segments[0].id},{toggle:true});const before=JSON.stringify(store.project);assert.throws(()=>store.deleteSelections(),/至少保留/);assert.equal(JSON.stringify(store.project),before);
  store.select(null);assert.equal(store.selections.length,0);assert.equal(store.selection,null);
});
