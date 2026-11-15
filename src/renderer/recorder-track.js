'use strict';
const fs=require('node:fs'),path=require('node:path');

function startTrack(kind,stream,directory,hasAudio,onProblem=()=>{},options={}) {
  const Recorder=options.Recorder||MediaRecorder;
  const candidates=kind==='camera'?['video/x-matroska;codecs=avc1,opus','video/webm;codecs=h264,opus','video/webm;codecs=vp9,opus','video/webm']:['audio/webm;codecs=opus','audio/webm'];
  const mimeType=candidates.find(type=>Recorder.isTypeSupported(type))||'';
  const file=path.join(directory,`${kind}-raw.${mimeType.includes('matroska')?'mkv':'webm'}`);
  const recorder=new Recorder(stream,{mimeType,videoBitsPerSecond:8_000_000,audioBitsPerSecond:192_000});
  const track={kind,file,startedAt:null,stoppedAt:null,hasAudio:Boolean(hasAudio),recorder,stream,problems:[]};
  const append=options.append||fs.promises.appendFile;
  const problem=message=>{if(!track.problems.includes(message)){track.problems.push(message);onProblem(kind,message);}};
  let writing=Promise.resolve(),settleStart,settleFinish,finished=false;
  track.started=new Promise(resolve=>{settleStart=resolve;});
  track.finished=new Promise(resolve=>{settleFinish=resolve;});
  const timeout=setTimeout(()=>{problem('设备未及时开始输出');settleStart();},options.startTimeout??2500);
  const finish=()=>{if(finished)return;finished=true;clearTimeout(timeout);settleStart();track.stoppedAt=Date.now()/1000;writing.then(settleFinish,settleFinish);};
  recorder.onstart=()=>{clearTimeout(timeout);track.startedAt=Date.now()/1000;settleStart();};
  recorder.ondataavailable=event=>{
    if(!event.data.size)return;
    writing=writing.then(async()=>{await append(file,Buffer.from(await event.data.arrayBuffer()));}).catch(error=>{
      problem(`素材写入失败：${error.message||error}`);
      if(recorder.state!=='inactive')try{recorder.stop();}catch{finish();}
    });
  };
  recorder.onerror=event=>{problem(`设备录制失败：${event.error?.message||'设备不可用'}`);if(recorder.state==='inactive')finish();};
  recorder.onstop=finish;
  const ended=()=>{problem('设备已断开，已保留此前素材');if(stream.getTracks().every(item=>item.readyState==='ended')&&recorder.state!=='inactive')try{recorder.stop();}catch{finish();}};
  stream.getTracks().forEach(item=>item.addEventListener('ended',ended));
  track.cleanup=()=>{clearTimeout(timeout);stream.getTracks().forEach(item=>{item.removeEventListener('ended',ended);item.stop();});};
  try{recorder.start(1000);}catch(error){track.cleanup();throw error;}
  return track;
}

async function stopTracks(tracks,{timeout=10000}={}) {
  for(const track of tracks)if(track.recorder.state!=='inactive')try{track.recorder.stop();}catch(error){track.problems.push(`设备停止失败：${error.message}`);}
  await Promise.all(tracks.map(async track=>{
    let timer;
    try{await Promise.race([track.finished,new Promise(resolve=>{timer=setTimeout(()=>{track.problems.push('设备停止超时，原始素材已保留');resolve();},timeout);})]);}
    finally{clearTimeout(timer);track.cleanup();}
  }));
  return tracks.filter(track=>track.startedAt!==null).map(({kind,file,startedAt,stoppedAt,hasAudio,problems})=>({kind,file,startedAt,stoppedAt,hasAudio,problems}));
}
module.exports={startTrack,stopTracks};
