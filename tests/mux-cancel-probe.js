'use strict';
// Real FFmpeg child processes, synthetic audio only, workspace-owned outputs.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const media=require('../src/main/ffmpeg'),{ExportJobs}=require('../src/main/export-jobs'),{beginExport}=require('../src/core/export-transaction'),{makeProject}=require('../src/core/model');
(async()=>{
  media.resolveBinaries(null);
  const directory=path.resolve(__dirname,'../../analysis/results'),outputFile=path.join(directory,'mux-cancel.m4a'),otherFile=path.join(directory,'mux-concurrent.m4a');
  fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(outputFile,'existing-output');
  const project=makeProject({media:{screen:{file:'unused-screen.mp4',width:640,height:360,duration:3}}}),transaction=beginExport(project,directory,outputFile),jobs=new ExportJobs();
  const a=Object.assign(new EventEmitter(),{id:101}),b=Object.assign(new EventEmitter(),{id:102});let spawnReady;const spawned=new Promise(r=>{spawnReady=r;});
  const first=jobs.run(a,'cancel-me',async({onSpawn})=>media.ffmpeg(['-loglevel','error','-re','-f','lavfi','-i','sine=frequency=440:duration=30','-c:a','aac',transaction.temporary],{onSpawn:child=>{onSpawn(child);spawnReady();}}));
  const rejected=assert.rejects(first);
  const second=jobs.run(b,'keep-me',async({onSpawn})=>media.ffmpeg(['-loglevel','error','-re','-f','lavfi','-i','sine=frequency=880:duration=1','-c:a','aac',otherFile],{onSpawn}));
  try{await spawned;await new Promise(r=>setTimeout(r,150));assert.equal(jobs.cancel(a.id,'cancel-me'),true);await rejected;await second;}
  finally{transaction.rollback();}
  assert.equal(fs.readFileSync(outputFile,'utf8'),'existing-output');assert.equal(fs.existsSync(transaction.temporary),false);assert.equal(jobs.jobs.size,0);
  const audio=await media.probe(otherFile);assert.ok(audio.hasAudio&&Math.abs(audio.duration-1)<0.1);
  const report={passed:true,syntheticAudioOnly:true,cancelledOwnFFmpeg:true,otherEditorExportCompleted:true,existingOutputPreserved:true,noTemporaryOutputLeak:true,duration:audio.duration};
  fs.writeFileSync(path.join(directory,'mux-cancel-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});
