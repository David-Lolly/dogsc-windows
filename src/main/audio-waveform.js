'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawn}=require('node:child_process');
async function waveforms(directory,project,binary){
  const output={};
  for(const kind of ['microphone','systemAudio']){
    const reference=project.media[kind];if(!reference)continue;
    const file=path.resolve(directory,reference.file),stat=fs.statSync(file),hash=crypto.createHash('sha256').update(`${file}:${stat.size}:${stat.mtimeMs}`).digest('hex').slice(0,24);
    const cache=path.join(directory,'media','cache',`${hash}.waveform.json`);
    if(fs.existsSync(cache)){output[kind]=JSON.parse(fs.readFileSync(cache,'utf8'));continue;}
    const peaks=await new Promise((resolve,reject)=>{
      const child=spawn(binary,['-hide_banner','-loglevel','error','-i',file,'-vn','-ac','1','-ar','8000','-f','f32le','pipe:1'],{windowsHide:true,stdio:['ignore','pipe','pipe']});
      let tail=Buffer.alloc(0),count=0,peak=0,error='';const values=[];
      child.stdout.on('data',chunk=>{const data=tail.length?Buffer.concat([tail,chunk]):chunk,end=data.length-data.length%4;for(let i=0;i<end;i+=4){peak=Math.max(peak,Math.abs(data.readFloatLE(i)));if(++count===160){values.push(Math.min(peak,1));count=0;peak=0;}}tail=Buffer.from(data.subarray(end));});
      child.stderr.on('data',c=>{error=(error+c).slice(-4000);});child.on('error',reject);child.on('close',code=>{if(code!==0)reject(new Error(`波形生成失败：${error}`));else{if(count)values.push(Math.min(peak,1));resolve(values);}});
    });
    const data={binSeconds:0.02,peaks};fs.mkdirSync(path.dirname(cache),{recursive:true});fs.writeFileSync(cache,JSON.stringify(data));output[kind]=data;
  }return output;
}
module.exports={waveforms};
