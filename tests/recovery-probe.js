'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const {candidate,recover}=require('../src/main/recording-recovery');
exports.run=async(output,media)=>{
  const root=path.join(output,'recovery-suite');fs.mkdirSync(root,{recursive:true});const source=fs.mkdtempSync(path.join(root,'interrupted-'))+'.dogscproject';fs.mkdirSync(path.join(source,'media'),{recursive:true});
  const file=path.join(source,'media/screen.mkv'),microphone=path.join(source,'media/microphone-raw.webm');
  await media.ffmpeg(['-loglevel','error','-f','lavfi','-i','testsrc2=size=320x180:rate=30:duration=3','-c:v','libx264','-preset','ultrafast','-bf','0',file]);
  await media.ffmpeg(['-loglevel','error','-f','lavfi','-i','sine=frequency=440:duration=3.25','-c:a','libopus',microphone]);
  fs.writeFileSync(path.join(source,'recording-session.json'),JSON.stringify({status:'recording',name:'恢复验收',firstFrameTime:1000,recordedDuration:3,frameRate:30,backend:'wgc',tracks:[{kind:'microphone',file:'microphone-raw.webm',startedAt:999.75}],markers:[{id:'marker',time:1}]}));
  fs.writeFileSync(path.join(source,'media/pointer-events.ndjson'),JSON.stringify({time:1000,x:0.2,y:0.3,kind:'move',cursor:'arrow'})+'\n'+JSON.stringify({time:1001,x:0.5,y:0.5,kind:'leftClick',cursor:'hand'})+'\n{"partial');
  const digest=directory=>Object.fromEntries(['recording-session.json','media/screen.mkv','media/microphone-raw.webm','media/pointer-events.ndjson'].map(file=>[file,createHash('sha256').update(fs.readFileSync(path.join(directory,file))).digest('hex')]));
  const before=digest(source);assert.equal(candidate(source).recovery,'recording');const result=await recover(root,source,media);
  assert.notEqual(result.directory,source);assert.deepEqual(digest(source),before);assert.ok(fs.existsSync(path.join(source,'media/screen.mkv')));
  assert.ok(Math.abs(result.project.media.screen.duration-3)<0.05);assert.equal(result.project.media.microphone.offset,-0.25);assert.equal(result.project.markers.length,1);
  const pointer=JSON.parse(fs.readFileSync(path.join(result.directory,result.project.media.pointer)));assert.equal(pointer.events.length,2);assert.equal(pointer.events[0].time,0);assert.equal(pointer.events[1].time,1);
  assert.equal(candidate(result.directory),null);assert.equal(JSON.parse(fs.readFileSync(path.join(result.directory,'recording-session.json'))).status,'complete');
  const report={passed:true,syntheticMediaOnly:true,sourceUnchanged:true,newProjectCreated:true,partialPointerLineHandled:true,microphoneOffsetPreserved:true,markersPreserved:true,project:result.directory,duration:result.project.media.screen.duration};
  fs.writeFileSync(path.join(output,'recovery-report.json'),JSON.stringify(report,null,2));return report;
};
