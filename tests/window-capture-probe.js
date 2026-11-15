'use strict';
const {BrowserWindow,screen}=require('electron'),path=require('node:path'),fs=require('node:fs');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
exports.run=async(output,media)=>{
  const target=new BrowserWindow({show:false,frame:false,width:640,height:360,x:100,y:100,webPreferences:{backgroundThrottling:false}});
  const cover=new BrowserWindow({show:false,frame:false,width:180,height:180,x:200,y:180,backgroundColor:'#101010'});
  let capture=null;
  try{
    await target.loadURL('data:text/html,'+encodeURIComponent('<body style="margin:0;background:#18232b"><canvas width="640" height="360" id="c"></canvas><script>let running=true;function draw(t){let x=document.getElementById("c").getContext("2d");x.fillStyle="#18232b";x.fillRect(0,0,640,360);x.fillStyle="#1aaab0";x.fillRect(120,80,240,180);x.fillStyle="#bba166";x.fillRect(30+Math.sin(t/400)*10,30,30,30);if(running)requestAnimationFrame(draw)}requestAnimationFrame(draw);</script>'));
    target.showInactive();await sleep(500);
    const physical=screen.dipToScreenRect(null,target.getBounds()),buffer=target.getNativeWindowHandle(),hwnd=(buffer.length>=8?buffer.readBigUInt64LE():BigInt(buffer.readUInt32LE())).toString();
    const monitor=require('../src/main/pointer-recorder').monitorAtPoint({x:physical.x+50,y:physical.y+50});
    if(!monitor||monitor.rect.width<=0||monitor.rect.height<=0)throw new Error('Native physical monitor mapping failed');
    const file=path.join(output,'native-window.mkv');
    capture=await media.startCapture({source:{kind:'window',hwnd,width:Math.floor(physical.width/2)*2,height:Math.floor(physical.height/2)*2},fps:30,file,width:physical.width,height:physical.height});
    const firstFrame=await capture.firstFrame;
    await cover.loadURL('data:text/html,<body style="margin:0;background:%23101010"></body>');cover.showInactive();await sleep(1200);
    const sustained=Math.min(60,Math.max(0,Number(process.env.DOGSC_CAPTURE_SECONDS)||0)),memory=[];
    if(sustained){const until=Date.now()+sustained*1000;while(Date.now()<until){memory.push(process.memoryUsage().rss);await sleep(Math.min(1000,until-Date.now()));}}
    target.setBounds({x:180,y:120,width:800,height:500});await sleep(400);
    target.minimize();await sleep(400);target.restore();await sleep(400);
    await target.webContents.executeJavaScript('running=false');await sleep(500);
    const start=performance.now();await capture.stop();const elapsed=capture.stoppedAt-firstFrame;capture=null;const stopMs=performance.now()-start;
    const mp4=path.join(output,'native-window.mp4');await media.finalizeWindow(file,mp4,elapsed,30);const info=await media.probe(mp4);
    if(info.duration<=0||!info.video)throw new Error('Native window capture produced no playable frames');
    if(Math.abs(info.duration-elapsed)>0.05)throw new Error('Native capture did not preserve static tail duration');
    const probe=await media.run(media.resolveBinaries(null).ffmpeg,['-hide_banner','-loglevel','error','-ss','0.8','-i',mp4,'-vf',`crop=16:16:${Math.round(info.video.width*0.375)}:${Math.round(info.video.height*0.47)},signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-`,'-frames:v','1','-f','null','-']);
    const luma=Number(/lavfi.signalstats.YAVG=(\d+(?:\.\d+)?)/.exec(probe.stdout)?.[1]);if(!(luma>80))throw new Error('Owned target was not visible under the occluding test window');
    const report={passed:true,onlyOwnedTestWindow:true,sustainedSeconds:sustained,mainProcessPeakRssMiB:memory.length?Math.max(...memory)/1024/1024:null,nativeMonitorMapping:monitor,occluderWasVisible:true,occludedTargetLuma:luma,staticTailDurationPreserved:true,movedAndResized:true,minimizedAndRestored:true,requestedDuration:elapsed,idleStopMs:stopMs,video:info,scope:'One owned synthetic window moved/resized/minimized/restored; cross-monitor and real device matrix still pending.'};fs.writeFileSync(path.join(output,'window-capture-report.json'),JSON.stringify(report,null,2));return report;
  }finally{if(capture)await capture.stop();cover.destroy();target.destroy();}
};
