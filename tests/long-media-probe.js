'use strict';
// Accelerated media generation/indexing, not a wall-clock capture/device test.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const media=require('../src/main/ffmpeg');
(async()=>{
  const directory=path.resolve(__dirname,'../../analysis/results/long-media');fs.mkdirSync(directory,{recursive:true});media.resolveBinaries(null);
  const file=path.join(directory,'synthetic-60min.mp4'),started=Date.now(),samples=[];
  const timer=setInterval(()=>samples.push(process.memoryUsage()),100);
  try{
    await media.ffmpeg(['-loglevel','error','-f','lavfi','-i','color=c=black:s=320x180:r=60:d=3600','-c:v','libx264','-preset','ultrafast','-crf','35','-g','120','-bf','0','-pix_fmt','yuv420p','-movflags','+faststart',file]);
    const generationMs=Date.now()-started,before=process.memoryUsage(),indexStart=Date.now(),index=await media.buildVideoIndex(file),after=process.memoryUsage();
    assert.equal(index.packets.length,216000);assert.ok(Math.abs(index.duration-3600)<0.02);assert.ok(Math.abs(index.packets.at(-1)[2]-(3600-1/60))<0.002);
    assert.ok(index.packets.every((p,i)=>p[0]>=0&&p[1]>0&&(!i||p[3]>=index.packets[i-1][3])));
    assert.ok(after.heapUsed-before.heapUsed<256*1024*1024,'Indexing heap growth exceeded 256MiB for one-hour 60fps fixture');
    await media.ffmpeg(['-loglevel','error','-ss','3599.5','-i',file,'-frames:v','1',path.join(directory,'near-end.png')]);
    const report={passed:true,scope:'Accelerated synthetic H.264 generation, streaming index and near-end seek; not real-time recording, hardware compatibility or audio-clock drift certification.',duration:index.duration,frames:index.packets.length,fps:60,generationMs,indexMs:Date.now()-indexStart,heapGrowthMiB:(after.heapUsed-before.heapUsed)/1024/1024,peakObservedRssMiB:Math.max(after.rss,...samples.map(s=>s.rss))/1024/1024,streamedPacketOutput:true,nearEndDecode:true,bytes:fs.statSync(file).size};
    fs.writeFileSync(path.join(directory,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
  }finally{clearInterval(timer);}
})().catch(error=>{console.error(error);process.exitCode=1;});
