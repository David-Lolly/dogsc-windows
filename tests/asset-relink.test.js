'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {makeProject}=require('../src/core/model'),{replaceAsset}=require('../src/core/project-assets'),{relinkAsset}=require('../src/main/asset-relink');
test('relink rejects shorter or wrong-size videos before replacing any reference',async()=>{
  const project=makeProject({media:{screen:{file:'missing.mp4',width:640,height:360,duration:3}}}),before=JSON.stringify(project);
  await assert.rejects(relinkAsset('synthetic',project,'screen','replacement.mp4',{probe:async()=>({duration:2,video:{codec:'h264',width:640,height:360}})}),/短/);
  await assert.rejects(relinkAsset('synthetic',project,'screen','replacement.mp4',{probe:async()=>({duration:3,video:{codec:'h264',width:320,height:180}})}),/尺寸/);
  assert.equal(JSON.stringify(project),before);
});
test('shared source references and new video indexes change together without changing timings',()=>{
  const project=makeProject({media:{screen:{file:'same.mp4',index:'old.index',width:640,height:360,duration:3},camera:{file:'same.mp4',width:640,height:360,duration:3,offset:0.25}}}),segments=JSON.stringify(project.timeline.segments);
  assert.equal(replaceAsset(project,'synthetic','same.mp4','media/relinked/new.mp4','media/relinked/new.index'),2);assert.equal(project.media.camera.file,project.media.screen.file);assert.equal(project.media.camera.offset,0.25);assert.equal(JSON.stringify(project.timeline.segments),segments);assert.equal(project.media.screen.index,'media/relinked/new.index');
});
