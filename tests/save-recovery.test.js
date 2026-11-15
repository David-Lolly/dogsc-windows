'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {makeProject}=require('../src/core/model');
const {writeProject,readProject,restoreProjectBackup}=require('../src/main/project-files');
const {candidate,ownedDirectory}=require('../src/main/recording-recovery');
const {PacketIndexParser}=require('../src/core/video-packets');
const make=()=>makeProject({name:'saved',media:{screen:{file:'media/screen.mp4',width:640,height:360,duration:3}}});
function storeFor(invoke){const file=path.resolve(__dirname,'../src/renderer/editor/store.js'),module={exports:{}};vm.runInNewContext(fs.readFileSync(file,'utf8'),{module,require:id=>id==='electron'?{ipcRenderer:{invoke}}:id==='./export'?{loadPointerTrack:()=>null}:require(path.resolve(path.dirname(file),id)),setTimeout:()=>0,clearTimeout:()=>{},console:{error:()=>{}}});return new module.exports.Store('synthetic',make());}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function temporary(run){const root=path.resolve(__dirname,'../../analysis/results');fs.mkdirSync(root,{recursive:true});const dir=fs.mkdtempSync(path.join(root,'save-recovery-'));try{return run(dir);}finally{assert.ok(path.resolve(dir).startsWith(root+path.sep));fs.rmSync(dir,{recursive:true,force:true});}}

test('autosave serializes immutable snapshots and does not report an old revision as saved',async()=>{
  const writes=[],releases=[];let live=0,maximum=0;
  const store=storeFor(async(channel,payload)=>{writes.push(payload.project);maximum=Math.max(maximum,++live);await new Promise(resolve=>releases.push(resolve));live--;});
  store.mutate(p=>{p.name='first';});const first=store.save();store.mutate(p=>{p.name='latest';});const second=store.save();assert.equal(writes[0].name,'first');
  releases.shift()();await tick();assert.equal(writes.length,2);assert.equal(writes[1].name,'latest');assert.notEqual(store.saveState,'saved');
  releases.shift()();assert.equal(await first,true);assert.equal(await second,true);assert.equal(store.saveState,'saved');assert.equal(maximum,1);
});
test('save failure remains visible and retries the latest document',async()=>{
  let fail=true,last;
  const store=storeFor(async(channel,payload)=>{if(fail)throw Error('disk full');last=payload.project;});store.mutate(p=>{p.name='pending';});
  assert.equal(await store.save(),false);assert.equal(store.saveState,'failed');fail=false;store.mutate(p=>{p.name='retry';});assert.equal(await store.save(),true);assert.equal(last.name,'retry');
});
test('atomic project backups restore damaged JSON, retain the damaged original and reject future versions',()=>temporary(root=>{
  const directory=path.join(root,'case.dogscproject');fs.mkdirSync(directory);const project=make();writeProject(directory,project);project.name='second';writeProject(directory,project);
  assert.equal(readProject(path.join(directory,'project.json.bak')).name,'saved');fs.writeFileSync(path.join(directory,'project.json'),'{broken');assert.equal(candidate(directory).recovery,'backup');
  restoreProjectBackup(directory);assert.equal(readProject(path.join(directory,'project.json')).name,'saved');assert.equal(candidate(directory),null);assert.ok(fs.readdirSync(directory).some(name=>name.includes('.damaged-')));
  const future={...project,schema:999};fs.writeFileSync(path.join(directory,'project.json'),JSON.stringify(future));assert.equal(candidate(directory),null);assert.throws(()=>restoreProjectBackup(directory),/未来/);assert.throws(()=>writeProject(directory,project),/未来/);assert.equal(JSON.parse(fs.readFileSync(path.join(directory,'project.json'))).schema,999);
  assert.ok(!fs.readdirSync(directory).some(name=>name.endsWith('.tmp')));
}));
test('interrupted media appears in recovery and unrelated directories are rejected',()=>temporary(root=>{
  const directory=path.join(root,'partial.dogscproject');fs.mkdirSync(path.join(directory,'media'),{recursive:true});fs.writeFileSync(path.join(directory,'media/screen.mkv'),Buffer.alloc(1024));
  assert.equal(candidate(directory).recovery,'recording');assert.equal(ownedDirectory(root,directory),fs.realpathSync(directory));assert.throws(()=>ownedDirectory(root,root),/只能恢复/);
}));
test('packet index streams fragmented lines and keeps only one partial line',()=>{
  const parser=new PacketIndexParser(),text='pts_time=0.033,dts_time=0.000,size=42,pos=100,flags=K_\r\npts_time=0.000,dts_time=-0.033,size=40,pos=50,flags=__\npts_time=N/A,size=5,pos=200\n';
  for(let i=0;i<text.length;i+=7)parser.feed(Buffer.from(text.slice(i,i+7)));const packets=parser.finish();assert.deepEqual(packets,[[50,40,0,-0.033,0],[100,42,0.033,0,1]]);assert.equal(parser.pending,'');
  const long=new PacketIndexParser();for(let i=0;i<216000;i++){long.feed(`pts_time=${i/60},dts_time=${i/60},size=20,pos=${i*20},flags=${i%120?'__':'K_'}\n`);assert.ok(long.pending.length<100);}assert.equal(long.finish().length,216000);
});
