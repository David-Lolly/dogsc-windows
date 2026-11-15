'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{BrowserWindow}=require('electron');
exports.run=async output=>{
  const target=new BrowserWindow({show:false,frame:false,width:640,height:360,webPreferences:{backgroundThrottling:false}});
  const root=path.join(output,'session-lifecycle');fs.mkdirSync(root,{recursive:true});let session;
  try{
    await target.loadURL('data:text/html,<body style="margin:0;background:%231d8b96;color:white;font-size:30px">DogSC owned capture test</body>');target.showInactive();await new Promise(r=>setTimeout(r,300));
    const handle=target.getNativeWindowHandle(),hwnd=(handle.length>=8?handle.readBigUInt64LE():BigInt(handle.readUInt32LE())).toString();
    session=new(require('../src/main/recording').RecordingSession)({projectsRoot:root,selection:{kind:'window',hwnd,title:'Owned lifecycle fixture'},frameRate:30,name:'窗口关闭恢复验收'});
    let resolveInterrupted,interruptions=0;const interrupted=new Promise(resolve=>{resolveInterrupted=resolve;});
    await session.start(reason=>{interruptions++;resolveInterrupted(reason);});session.addMarker();await new Promise(r=>setTimeout(r,2300));
    const checkpoint=JSON.parse(fs.readFileSync(path.join(session.directory,'recording-session.json')));assert.equal(checkpoint.status,'recording');assert.ok(checkpoint.firstFrameTime>0);assert.ok(checkpoint.recordedDuration>1);assert.ok(fs.statSync(path.join(session.mediaDirectory,'pointer-events.ndjson')).size>0);
    target.destroy();let timeout;let reason;
    try{reason=await Promise.race([interrupted,new Promise((resolve,reject)=>{timeout=setTimeout(()=>reject(Error('Window closure was not detected')),5000);})]);}finally{clearTimeout(timeout);}
    const result=await session.finish([]);assert.equal(interruptions,1);assert.ok(result.project.media.screen.duration>2);assert.equal(result.project.markers.length,1);assert.equal(JSON.parse(fs.readFileSync(path.join(result.directory,'recording-session.json'))).status,'complete');
    const report={passed:true,onlyOwnedWindow:true,productionRecordingSession:true,checkpointAndPointerJournal:true,windowCloseDetected:true,interruptionReason:reason,interruptionCount:interruptions,projectSaved:true,duration:result.project.media.screen.duration};fs.writeFileSync(path.join(output,'session-lifecycle-report.json'),JSON.stringify(report,null,2));return report;
  }finally{if(session?.capture&&!session.finishing)await session.discard();if(!target.isDestroyed())target.destroy();}
};
