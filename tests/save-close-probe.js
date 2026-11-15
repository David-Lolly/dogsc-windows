'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {BrowserWindow,ipcMain}=require('electron');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
exports.run=async(output,media)=>{
  const directory=path.join(output,'save-close-suite');fs.mkdirSync(directory,{recursive:true});
  await media.ffmpeg(['-loglevel','error','-f','lavfi','-i','color=c=white:s=640x360:r=30:d=3','-c:v','libx264','-pix_fmt','yuv420p',path.join(directory,'screen.mp4')]);
  const {makeProject,normalizeProject}=require('../src/core/model'),files=require('../src/main/project-files');
  const project=makeProject({name:'保存关闭验收',media:{screen:{file:'screen.mp4',width:640,height:360,duration:3,frameRate:30}}});
  const writes=[];let release,fail=false,hold=true;
  ipcMain.handle('project:read',()=>normalizeProject(JSON.parse(JSON.stringify(project))));
  ipcMain.handle('project:write',async(event,{project:snapshot})=>{writes.push(snapshot);if(hold){hold=false;await new Promise(resolve=>{release=resolve;});}if(fail)throw Error('simulated disk full');files.writeProject(directory,snapshot);});
  ipcMain.handle('system:wallpapers',()=>({files:[],directory:null}));ipcMain.handle('preset:list',()=>[]);ipcMain.handle('project:waveforms',()=>({}));
  ipcMain.on('window:close',event=>BrowserWindow.fromWebContents(event.sender)?.close());
  const open=async()=>{const window=new BrowserWindow({show:false,width:1200,height:900,webPreferences:{nodeIntegration:true,contextIsolation:false}});await window.loadFile(path.join(__dirname,'../src/renderer/editor.html'),{query:{project:directory}});await window.webContents.executeJavaScript(`new Promise((resolve,reject)=>{let attempts=0;const poll=()=>typeof window.dogscSelfTest==='function'?resolve():attempts++>200?reject(Error('Editor not ready')):setTimeout(poll,20);poll();})`);return window;};
  const rename=(window,name)=>window.webContents.executeJavaScript(`(()=>{const input=document.getElementById('project-name');input.value=${JSON.stringify(name)};input.dispatchEvent(new Event('change'));})()`);
  const waitClosed=async window=>{for(let i=0;i<150&&!window.isDestroyed();i++)await sleep(20);assert.ok(window.isDestroyed(),'Editor failed to close after successful save');};
  let window=await open();
  try{
    await rename(window,'first snapshot');window.close();await sleep(150);assert.ok(!window.isDestroyed());assert.equal(writes.length,1);
    await rename(window,'latest snapshot');assert.equal(writes[0].name,'first snapshot');release();await waitClosed(window);
    assert.equal(files.readProject(path.join(directory,'project.json')).name,'latest snapshot');assert.equal(writes.length,2);
    fail=true;window=await open();await rename(window,'retry after failure');window.close();await sleep(200);assert.ok(!window.isDestroyed());
    const message=await window.webContents.executeJavaScript(`document.getElementById('save-state').textContent`);assert.match(message,/保存失败/);
    fail=false;window.close();await waitClosed(window);assert.equal(files.readProject(path.join(directory,'project.json')).name,'retry after failure');
    const report={passed:true,realEditorClose:true,inFlightSaveWaited:true,latestRevisionPersisted:true,failedSaveKeepsWindow:true,retryClosesWindow:true};
    fs.writeFileSync(path.join(output,'save-close-report.json'),JSON.stringify(report,null,2));return report;
  }finally{if(!window.isDestroyed())window.destroy();}
};
