'use strict';
// Only a workspace copy is edited. Reports contain metrics, never source frames.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{randomUUID,createHash}=require('node:crypto'),{BrowserWindow,ipcMain}=require('electron');
exports.run=async(output,source,media)=>{
  const original=path.join(source,'project.json'),before=createHash('sha256').update(fs.readFileSync(original)).digest('hex');
  const directory=path.join(output,`recorded-fixture-${randomUUID()}.dogscproject`);fs.cpSync(source,directory,{recursive:true,errorOnExist:true,force:false});
  const {normalizeProject,validateProjectContract}=require('../src/core/model'),files=require('../src/main/project-files');
  ipcMain.handle('project:read',()=>normalizeProject(files.readProject(path.join(directory,'project.json'))));
  ipcMain.handle('project:write',(event,{directory:target,project})=>{if(target!==directory)throw Error('Only the workspace fixture may be edited');files.writeProject(directory,project);});
  ipcMain.handle('system:wallpapers',()=>({files:[],directory:null}));ipcMain.handle('preset:list',()=>[]);ipcMain.handle('project:waveforms',()=>({}));
  ipcMain.handle('project:rebuild-index',(event,file)=>{if(!path.resolve(file).startsWith(directory+path.sep))throw Error('Only fixture indexes may be written');return media.buildVideoIndex(file);});
  ipcMain.handle('export:mux',async(event,job)=>{if(!path.resolve(job.outputFile).startsWith(path.resolve(output)+path.sep))throw Error('Only workspace exports allowed');await media.ffmpeg(media.buildMuxArguments(job));return job.outputFile;});
  const editor=new BrowserWindow({show:false,width:1480,height:940,webPreferences:{nodeIntegration:true,contextIsolation:false,backgroundThrottling:false}});
  try{
    await editor.loadFile(path.join(__dirname,'../src/renderer/editor.html'),{query:{project:directory}});
    const result=await editor.webContents.executeJavaScript(`require(${JSON.stringify(__filename)}).exercise().catch(error=>({error:error.stack}))`);if(result.error)throw Error(result.error);
    await new Promise(r=>setTimeout(r,700));const project=files.readProject(path.join(directory,'project.json'));validateProjectContract(project);
    const render=await editor.webContents.executeJavaScript(`(async()=>{const fs=require('node:fs'),p=JSON.parse(fs.readFileSync(${JSON.stringify(path.join(directory,'project.json'))},'utf8'));p.timeline.segments=[{...p.timeline.segments[0],sourceEnd:Math.min(p.timeline.segments[0].sourceStart+1,p.timeline.segments[0].sourceEnd)}];return require(${JSON.stringify(path.join(__dirname,'../src/renderer/editor/export.js'))}).exportProject({project:p,directory:${JSON.stringify(directory)},outputFile:${JSON.stringify(path.join(output,'recorded-fixture-export.mp4'))},frameRate:30});})()`);
    const after=createHash('sha256').update(fs.readFileSync(original)).digest('hex');assert.equal(before,after);assert.ok(render.frames>0);
    const report={...result,passed:true,realRecordedProject:true,editedWorkspaceCopyOnly:true,originalProjectUnchanged:true,sourceWidth:project.media.screen.width,sourceHeight:project.media.screen.height,sourceDuration:project.media.screen.duration,shortExportFrames:render.frames,shortExportDuration:render.duration,privacy:'No source frames or project content included in this report.'};
    fs.writeFileSync(path.join(output,'real-project-report.json'),JSON.stringify(report,null,2));return report;
  }finally{editor.destroy();}
};
exports.exercise=async()=>{
  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));for(let i=0;i<300&&typeof window.dogscSelfTest!=='function';i++)await sleep(20);assert.equal(typeof window.dogscSelfTest,'function');
  for(let i=0;i<200;i++){const state=window.dogscSelfTest();if(state.screenReady>=2)break;await sleep(30);}await sleep(200);
  const button=[...document.querySelectorAll('#rail button')].find(n=>n.textContent.trim()==='屏幕 3D');button.click();
  if(!document.querySelector('#lane-screen-motion .zoom-clip'))[...document.querySelectorAll('#inspector button')].find(n=>n.textContent.trim()==='在播放头添加 3D 片段').click();
  const clip=document.querySelector('#lane-screen-motion .zoom-clip'),rect=clip.getBoundingClientRect();clip.dispatchEvent(new MouseEvent('pointerdown',{bubbles:true,clientX:rect.left+rect.width/2}));window.dispatchEvent(new MouseEvent('pointerup',{bubbles:true,clientX:rect.left+rect.width/2}));
  const field=[...document.querySelectorAll('.field')].find(n=>n.textContent.includes('X 轴旋转')),input=field.querySelector('input');
  const descriptor=Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype,'currentTime');let assignments=0;
  Object.defineProperty(HTMLMediaElement.prototype,'currentTime',{...descriptor,set(value){assignments++;return descriptor.set.call(this,value);}});
  try{input.dispatchEvent(new Event('pointerdown'));for(let i=0;i<64;i++){input.value=String((i%9)-4);input.dispatchEvent(new Event('input'));}input.dispatchEvent(new Event('change'));await sleep(100);assert.equal(assignments,0,'Appearance changes must not seek actual recorded media');}
  finally{Object.defineProperty(HTMLMediaElement.prototype,'currentTime',descriptor);}
  return{appearanceUpdates:64,appearanceSeekAssignments:assignments};
};
