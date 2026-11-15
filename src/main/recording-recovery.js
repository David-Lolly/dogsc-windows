'use strict';
const fs=require('node:fs'),path=require('node:path');
const {readProject,restoreProjectBackup}=require('./project-files');
const EXT='.dogscproject';
function journal(directory){try{return JSON.parse(fs.readFileSync(path.join(directory,'recording-session.json'),'utf8'));}catch{return{};}}
function candidate(directory){
  const file=path.join(directory,'project.json');
  if(fs.existsSync(file)){
    try{readProject(file);return null;}catch{}
    try{const p=JSON.parse(fs.readFileSync(file,'utf8'));if(p&&(p.app!=='dogsc-windows'||p.schema>3))return null;}catch{}
  }
  const info=journal(directory),name=info.name||path.basename(directory,EXT),createdAt=info.updatedAt||fs.statSync(directory).mtime.toISOString();
  try{readProject(`${file}.bak`);return{directory,name,createdAt,recovery:'backup',detail:'工程文件异常，可从上次保存备份恢复'};}catch{}
  for(const name of ['screen.mkv','screen.mp4']){
    const raw=path.join(directory,'media',name);
    if(fs.existsSync(raw)&&fs.statSync(raw).size>512)return{directory,name:info.name||path.basename(directory,EXT),createdAt,recovery:'recording',detail:'录制未完成，可保留原目录并从素材恢复；未保存的剪辑无法还原'};
  }
  return null;
}
function ownedDirectory(root,directory){
  const base=fs.realpathSync(root),target=fs.realpathSync(directory);
  if(path.dirname(target).toLowerCase()!==base.toLowerCase()||!target.endsWith(EXT))throw new Error('只能恢复项目库中的工程目录。');
  return target;
}
function ownedFile(directory,file){
  const target=path.resolve(directory,'media',file),media=path.resolve(directory,'media');
  if(path.dirname(target)!==media||!fs.existsSync(target))return null;
  const physicalMedia=fs.realpathSync(media).toLowerCase(),physicalProject=fs.realpathSync(directory).toLowerCase();
  if(!physicalMedia.startsWith(physicalProject+path.sep)||!fs.realpathSync(target).toLowerCase().startsWith(physicalMedia+path.sep))throw new Error('恢复素材必须位于工程内部。');
  return target;
}
async function recover(root,directory,media,onStage=()=>{}){
  directory=ownedDirectory(root,directory);
  const item=candidate(directory);if(!item)throw new Error('该工程无需恢复，或没有可恢复的素材。');
  if(item.recovery==='backup'){restoreProjectBackup(directory);return{directory};}
  const metadata=journal(directory);let input,info;
  for(const name of ['screen.mp4','screen.mkv']){
    const file=ownedFile(directory,name);if(!file)continue;
    try{const result=await media.probe(file);if(result.video&&result.duration>0){input=file;info=result;break;}}catch{}
  }
  if(!input)throw new Error('现有屏幕素材无法解码，原始目录未改动。');
  onStage('正在复制可恢复素材');
  const {RecordingSession}=require('./recording');
  const session=new RecordingSession({projectsRoot:root,selection:metadata.selection||{kind:'recovered'},name:`${item.name} 恢复`,frameRate:[30,60].includes(metadata.frameRate)?metadata.frameRate:30});
  fs.mkdirSync(session.mediaDirectory,{recursive:true});
  // Recovery writes into a new project; the interrupted source is never edited.
  fs.copyFileSync(input,path.join(session.mediaDirectory,'screen.mkv'));
  session.firstFrameTime=Number.isFinite(metadata.firstFrameTime)?metadata.firstFrameTime:0;
  const checkpoint=Number.isFinite(metadata.recordedDuration)&&metadata.recordedDuration>=0&&metadata.recordedDuration<=86400?metadata.recordedDuration:0;
  const duration=path.extname(input)==='.mkv'?Math.max(info.duration,checkpoint):info.duration;
  session.capture={backend:path.extname(input)==='.mkv'&&metadata.backend==='wgc'?'wgc':'recovered',stoppedAt:session.firstFrameTime+duration,stop:async()=>{},stderr:''};
  session.source={description:{...(metadata.source||{}),recovered:true,recoveredFrom:directory}};
  session.recoveryWarnings=['此工程从中断素材重建；未保存的剪辑和效果无法恢复。'];
  let events=[],hasClicks=false;
  const pointer=ownedFile(directory,'pointer.json'),stream=ownedFile(directory,'pointer-events.ndjson');
  try{
    if(pointer){const track=JSON.parse(fs.readFileSync(pointer,'utf8'));events=(track.events||[]).map(e=>({...e,time:e.time+session.firstFrameTime}));hasClicks=Boolean(track.hasClicks);}
    else if(stream){for(const line of fs.readFileSync(stream,'utf8').split('\n')){try{const event=JSON.parse(line);if([event.time,event.x,event.y].every(Number.isFinite))events.push(event);}catch{}}hasClicks=events.some(e=>/Click$/.test(e.kind));}
    else session.recoveryWarnings.push('没有可恢复的光标轨迹。');
  }catch{session.recoveryWarnings.push('光标轨迹不完整，已保留可用画面。');}
  session.pointer={events,hasClickSupport:hasClicks,stop:()=>events};
  session.markers=(metadata.markers||[]).filter(m=>Number.isFinite(m.time)&&m.time>=0&&m.time<=duration);
  const tracks=[];
  for(const [kind,names]of Object.entries({camera:['camera-raw.mkv','camera-raw.webm','camera.mp4'],microphone:['microphone-raw.webm','microphone.m4a'],system:['system-raw.webm','system.m4a']})){
    for(const name of names){
      const source=ownedFile(directory,name);if(!source)continue;
      try{
        const data=await media.probe(source);if(kind==='camera'?!data.video:!data.hasAudio)continue;
        const original=(metadata.tracks||[]).find(t=>t.kind===kind),file=path.join(session.mediaDirectory,`recovered-${name}`);fs.copyFileSync(source,file);
        if(!original||!Number.isFinite(original.startedAt))session.recoveryWarnings.push(`${kind} 缺少启动时间，恢复后请检查同步。`);
        tracks.push({kind,file,startedAt:Number.isFinite(original?.startedAt)?original.startedAt:session.firstFrameTime,hasAudio:kind==='camera'&&data.hasAudio});break;
      }catch(error){session.recoveryWarnings.push(`${kind} 素材未恢复：${error.message}`);}
    }
  }
  return session.finish(tracks,onStage);
}
module.exports={candidate,recover,ownedDirectory};
