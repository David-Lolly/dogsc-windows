'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {ExportJobs}=require('../src/main/export-jobs');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {RecordingHealth}=require('../src/main/recording-health');
const {startTrack,stopTracks}=require('../src/renderer/recorder-track');
const {captureFilter}=require('../src/core/windows-capture');
test('capture elapsed time and stop timestamp ignore wall-clock jumps',()=>{
  const {CaptureClock}=require('../src/core/capture-clock');let wall=1000.1,mono=10.1;const clock=new CaptureClock({wall:()=>wall,monotonic:()=>mono});clock.start(1000);assert.ok(Math.abs(clock.firstMonotonic-10)<1e-6);
  wall+=3600;mono+=60;assert.ok(Math.abs(clock.elapsed-60.1)<1e-6);clock.stop();assert.ok(Math.abs(clock.endWall-1060.1)<1e-6);wall-=7200;mono+=100;assert.ok(Math.abs(clock.elapsed-60.1)<1e-6);clock.start(9999);assert.equal(clock.firstWall,1000);
});
test('six built-in Windows scenes are valid and do not share mutable state',()=>{
  const {builtinPresets}=require('../src/core/scene-presets'),{makeProject,normalizeProject,validateProjectContract}=require('../src/core/model');
  for(const preset of builtinPresets()){
    const p=makeProject({media:{screen:{file:'screen.mp4',width:640,height:360,duration:3}}});Object.assign(p,preset.style);validateProjectContract(normalizeProject(p));
  }
  const first=builtinPresets();first[0].style.camera.position.x=0;assert.notEqual(builtinPresets()[0].style.camera.position.x,0);assert.equal(first.length,6);
});
test('multi-display capture uses the Windows monitor handle and physical crop margins',()=>{
  const filter=captureFilter({kind:'area',backend:'wgc',hmonitor:'1844674407370955161',width:640,height:360,monitorWidth:2560,monitorHeight:1440,rect:{x:120,y:80,width:640,height:360}},60);
  assert.match(filter,/hmonitor=1844674407370955161/);assert.match(filter,/crop_left=120:crop_top=80:crop_right=1800:crop_bottom=1000/);
  assert.ok(!filter.includes('output_idx'));assert.match(filter,/width=640:height=360/);
  assert.throws(()=>captureFilter({kind:'window',hwnd:'0'},30),/句柄/);
});

test('window/display interruptions fire once and subscriptions are removed',()=>{
  const screen=new EventEmitter(),reasons=[];let exists=true;
  const windowHealth=new RecordingHealth({screen,selection:{kind:'window',hwnd:'42'},windowExists:()=>exists,onInterrupted:r=>reasons.push(r)});
  windowHealth.check();assert.equal(reasons.length,0);exists=false;windowHealth.check();windowHealth.check();assert.equal(reasons.length,1);windowHealth.dispose();
  const displayHealth=new RecordingHealth({screen,selection:{kind:'display',displayId:5},onInterrupted:r=>reasons.push(r)});
  screen.emit('display-removed',{}, {id:4});screen.emit('display-metrics-changed',{}, {id:5},['workArea']);assert.equal(reasons.length,1);
  screen.emit('display-metrics-changed',{}, {id:5},['scaleFactor']);screen.emit('display-removed',{}, {id:5});assert.equal(reasons.length,2);
  displayHealth.dispose();assert.equal(screen.listenerCount('display-removed'),0);assert.equal(screen.listenerCount('display-metrics-changed'),0);
});

class FakeRecorder {
  static isTypeSupported(){return true;}
  constructor(stream){this.stream=stream;this.state='inactive';}
  start(){this.state='recording';queueMicrotask(()=>this.onstart?.());}
  stop(){this.state='inactive';queueMicrotask(()=>this.onstop?.());}
}
function fakeStream(){const input=Object.assign(new EventTarget(),{readyState:'live',stop(){this.readyState='ended';}});return{input,getTracks:()=>[input]};}
test('device removal keeps partial media; disk errors are reported and do not reject unhandled writes',async()=>{
  const stream=fakeStream(),warnings=[],chunks=[];
  const track=startTrack('microphone',stream,'synthetic',false,(kind,message)=>warnings.push(message),{Recorder:FakeRecorder,append:async(file,data)=>chunks.push(data.toString())});
  await track.started;track.recorder.ondataavailable({data:new Blob(['first'])});stream.input.readyState='ended';stream.input.dispatchEvent(new Event('ended'));
  const result=await stopTracks([track]);assert.deepEqual(chunks,['first']);assert.ok(result[0].stoppedAt>=result[0].startedAt);assert.ok(warnings.some(s=>s.includes('断开')));
  const failing=startTrack('camera',fakeStream(),'synthetic',false,()=>{},{Recorder:FakeRecorder,append:async()=>{throw Error('disk full');}});
  await failing.started;failing.recorder.ondataavailable({data:new Blob(['frame'])});await new Promise(r=>setTimeout(r,5));await stopTracks([failing]);assert.ok(failing.problems.some(s=>s.includes('disk full')));
});
test('broken device stop has a deadline and releases its media inputs',async()=>{
  class StuckRecorder extends FakeRecorder {stop(){this.state='inactive';}}
  const stream=fakeStream(),track=startTrack('system',stream,'synthetic',false,()=>{},{Recorder:StuckRecorder});await track.started;
  await stopTracks([track],{timeout:10});assert.equal(stream.input.readyState,'ended');assert.ok(track.problems.some(s=>s.includes('超时')));
});

const owner=id=>Object.assign(new EventEmitter(),{id});
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return{promise,resolve};};
test('export cancellation belongs to one editor and rejects a stale job ID',async()=>{
  const jobs=new ExportJobs(),a=owner(1),b=owner(2),doneA=deferred(),doneB=deferred();let killsA=0,killsB=0;
  const first=jobs.run(a,'a',async({onSpawn})=>{onSpawn({kill:()=>{killsA++;doneA.resolve();}});await doneA.promise;});
  const second=jobs.run(b,'b',async({onSpawn})=>{onSpawn({kill:()=>{killsB++;}});await doneB.promise;return 'b-output';});
  assert.equal(jobs.cancel(1,'old'),false);assert.equal(killsA,0);
  assert.equal(jobs.cancel(1,'a'),true);await assert.rejects(first,/已取消/);assert.equal(killsA,1);assert.equal(killsB,0);
  doneB.resolve();assert.equal(await second,'b-output');assert.equal(jobs.jobs.size,0);
  assert.equal(a.listenerCount('destroyed'),0);assert.equal(b.listenerCount('destroyed'),0);
});
test('editor close cancels its process even before process startup; failures release the job',async()=>{
  const jobs=new ExportJobs(),a=owner(3),ready=deferred();let kills=0;
  const pending=jobs.run(a,'closed',async({onSpawn})=>{await ready.promise;onSpawn({kill:()=>kills++});});
  await assert.rejects(jobs.run(a,'duplicate',async()=>{}),/已有导出/);
  a.emit('destroyed');ready.resolve();await assert.rejects(pending,/已取消/);assert.equal(kills,1);
  await assert.rejects(jobs.run(a,'failure',async()=>{throw new Error('disk full');}),/disk full/);
  assert.equal(await jobs.run(a,'retry',async()=>42),42);
});

test('stationary cursor shape changes and hidden state are recorded without creating clicks',()=>{
  const file=path.resolve(__dirname,'../src/main/pointer-recorder.js'),module={exports:{}};
  vm.runInNewContext(fs.readFileSync(file,'utf8'),{module,require:id=>id==='electron'?{screen:{}}:{load:()=>{throw Error('test native disabled');}},setInterval,clearInterval});
  const recorder=new module.exports.PointerRecorder(()=>({x:-100,y:50,width:200,height:100}));
  assert.equal(module.exports.windowHandle('12345'),12345);assert.equal(module.exports.windowHandle('bad'),null);assert.equal(module.exports.windowHandle(0),null);assert.equal(module.exports.windowHandle('18446744073709551615'),18446744073709551615n);assert.equal(module.exports.windowHandle(Number.MAX_SAFE_INTEGER+1),null);
  let wall=1000,monotonic=10;const stable=new module.exports.PointerRecorder(()=>null,{wall:()=>wall,monotonic:()=>monotonic});stable.events.push({time:1000});wall+=3600;monotonic+=20;assert.equal(stable.now(),1020);stable.alignClock(2000,10);assert.equal(stable.events[0].time,2000);assert.equal(stable.now(),2020);
  let cursor='arrow';recorder.read=()=>({x:0,y:100,cursor,left:false,right:false});recorder.now=()=>1;
  recorder.tick();recorder.tick();cursor='ibeam';recorder.tick();cursor='hidden';recorder.tick();
  assert.equal(recorder.events.length,3);assert.deepEqual(Array.from(recorder.events,e=>e.cursor),['arrow','ibeam','hidden']);
  assert.ok(recorder.events.every(e=>e.x===0.5&&e.y===0.5&&e.kind==='move'));
});
