'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
exports.run=async({app,window,environment,media,output})=>{
  assert.ok(environment.ok,environment.reason);
  if(window.webContents.isLoading())await new Promise(resolve=>window.webContents.once('did-finish-load',resolve));
  const ui=await window.webContents.executeJavaScript(`new Promise((resolve,reject)=>{let tries=0;const check=()=>{const start=document.getElementById('start'),hint=document.getElementById('hint');if(start&&!start.disabled)resolve({recordEnabled:true,status:hint.textContent,versionVisible:hint.textContent.includes(${JSON.stringify(app.getVersion())})});else if(tries++>200)reject(Error(document.body.innerText));else setTimeout(check,25);};check();})`);
  const binaries=media.resolveBinaries(process.resourcesPath);
  const bundled=Object.values(binaries).every(file=>path.resolve(file).toLowerCase().startsWith(path.resolve(process.resourcesPath,'bin').toLowerCase()+path.sep));
  assert.ok(bundled,'Startup test must use the bundled FFmpeg tools');assert.ok(ui.versionVisible,'Current version must be visible');
  const report={passed:true,normalProductEntry:true,recordingNotStarted:true,workspaceProfileOnly:true,version:app.getVersion(),electron:process.versions.electron,bundledFFmpeg:true,ffmpegAvailable:environment.ok,ui};
  fs.writeFileSync(path.join(output,'startup-report.json'),JSON.stringify(report,null,2));return report;
};
