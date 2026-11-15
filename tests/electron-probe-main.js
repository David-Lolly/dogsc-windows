'use strict';
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const output = process.env.DOGSC_PROBE_OUTPUT;
if (!output) throw new Error('DOGSC_PROBE_OUTPUT is required');
app.setPath('userData', path.join(output, 'electron-profile'));
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1280, height: 800,
    webPreferences: { nodeIntegration: true, contextIsolation: false, backgroundThrottling: false } });
  const timer = setTimeout(() => { fs.writeFileSync(path.join(output, 'renderer-report.json'), JSON.stringify({ error: 'probe timeout' })); app.exit(1); }, 90000);
  try {
    if(process.env.DOGSC_RESTORE_CLIPBOARD_IMAGE){
      const clipboard=require('electron').clipboard,items=await clipboard.read(),Item=items[0]?.constructor||require('electron').ClipboardItem;
      await clipboard.write([new Item({'image/png':new Blob([fs.readFileSync(process.env.DOGSC_RESTORE_CLIPBOARD_IMAGE)],{type:'image/png'})})]);
      fs.writeFileSync(path.join(output,'clipboard-restore-report.json'),JSON.stringify({restored:true,formats:(await clipboard.read()).map(item=>item.types)},null,2));clearTimeout(timer);app.exit(0);return;
    }
    if(process.env.DOGSC_CLIPBOARD_ROUNDTRIP==='1'){
      const clipboard=require('electron').clipboard,assert=require('node:assert/strict');
      const original=await clipboard.read();
      const snapshot=async items=>Promise.all(items.map(async item=>({types:[...item.types],data:await Promise.all(item.types.map(async type=>Buffer.from(await(await item.getType(type)).arrayBuffer())))})));
      const before=await snapshot(original);
      const restoreItems=original.map((item,i)=>new item.constructor(Object.fromEntries(item.types.map((type,j)=>[type,new Blob([before[i].data[j]],{type})]))));
      const {makeProject}=require('../src/core/model'),{copyEffects}=require('../src/core/effect-clipboard');
      const project=makeProject({media:{screen:{file:'synthetic.mp4',width:640,height:360,duration:3}}});project.zoomAnimations=[require('../src/core/zoom').makeClip({startTime:0,endTime:1})];
      const payload=copyEffects(project,{type:'zoom',id:project.zoomAnimations[0].id},output),bridge=new(require('../src/main/effect-clipboard').EffectClipboard)(clipboard);
      try{await bridge.copy(payload);assert.deepEqual(await bridge.paste(),payload);}
      finally{if(restoreItems.length)await clipboard.write(restoreItems);else await clipboard.clear();}
      const after=await snapshot(await clipboard.read());
      assert.equal(after.length,before.length);for(let i=0;i<before.length;i++){assert.deepEqual(after[i].types,before[i].types);for(let j=0;j<before[i].data.length;j++)assert.ok(before[i].data[j].equals(after[i].data[j]),'Original clipboard data not restored');}
      fs.writeFileSync(path.join(output,'clipboard-roundtrip-report.json'),JSON.stringify({passed:true,electron:process.versions.electron,realSystemClipboard:true,productionBridge:true,originalClipboardRestored:true,originalFormats:before.map(item=>item.types)},null,2));
      clearTimeout(timer);app.exit(0);return;
    }
    if(process.env.DOGSC_CLIPBOARD_API_PROBE==='1'){
      const clipboard=require('electron').clipboard;
      let readResult;
      try{const value=await clipboard.read();readResult={type:typeof value,array:Array.isArray(value),keys:value&&typeof value==='object'?Object.keys(value):[],items:Array.isArray(value)?value.map(item=>({type:typeof item,keys:Object.keys(item),types:item.types})):undefined};}catch(error){readResult={error:error.message};}
      fs.writeFileSync(path.join(output,'clipboard-api-report.json'),JSON.stringify({methods:Object.getOwnPropertyNames(clipboard),writeText:typeof clipboard.writeText,readText:typeof clipboard.readText,writeBuffer:typeof clipboard.writeBuffer,readBuffer:typeof clipboard.readBuffer,readResult},null,2));
      clearTimeout(timer);app.exit(0);return;
    }
    const media = require('../src/main/ffmpeg');
    media.resolveBinaries(app.isPackaged?process.resourcesPath:null);
    if(process.env.DOGSC_REAL_PROJECT_DIR){
      await require('./real-project-probe').run(output,process.env.DOGSC_REAL_PROJECT_DIR,media);clearTimeout(timer);app.exit(0);return;
    }
    if(process.env.DOGSC_SESSION_LIFECYCLE_PROBE==='1'){
      await require('./session-lifecycle-probe').run(output);clearTimeout(timer);app.exit(0);return;
    }
    if(process.env.DOGSC_SAVE_CLOSE_PROBE==='1'){
      await require('./save-close-probe').run(output,media);clearTimeout(timer);app.exit(0);return;
    }
    if(process.env.DOGSC_RECOVERY_PROBE==='1'){
      await require('./recovery-probe').run(output,media);clearTimeout(timer);app.exit(0);return;
    }
    if(process.env.DOGSC_CAPTURE_PROBE==='1'){
      const report=await require('./window-capture-probe').run(output,media);fs.writeFileSync(path.join(output,'window-capture-report.json'),JSON.stringify(report,null,2));clearTimeout(timer);app.exit(0);return;
    }
    await media.ffmpeg(['-loglevel','error','-f','lavfi','-i','testsrc2=size=640x360:rate=30:duration=3','-c:v','libx264','-pix_fmt','yuv420p',path.join(output,'pattern.mp4')]);
    await media.ffmpeg(['-loglevel','error','-f','lavfi','-i','color=c=red:s=320x240:r=30:d=3','-c:v','libx264','-pix_fmt','yuv420p',path.join(output,'red-camera.mp4')]);
    await media.ffmpeg(['-loglevel','error','-f','lavfi','-i','testsrc2=size=320x180:rate=30:duration=1','-c:v','libx264','-pix_fmt','yuv420p',path.join(output,'loop-background.mp4')]);
    await media.ffmpeg(['-loglevel','error','-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=3','-c:a','aac',path.join(output,'tone.m4a')]);
    ipcMain.handle('project:rebuild-index', (event, file) => media.buildVideoIndex(file));
    const exportJobs=new (require('../src/main/export-jobs').ExportJobs)();
    ipcMain.handle('export:mux', (event, job) => exportJobs.run(event.sender,job.jobId,async({onSpawn})=>{
      await media.ffmpeg(media.buildMuxArguments(job),{onSpawn});
      return job.outputFile;
    }));
    ipcMain.on('export:cancel',(event,id)=>exportJobs.cancel(event.sender.id,id));
    if(process.env.DOGSC_EFFECT_EDITOR_PROBE==='1'){
      ipcMain.handle('system:wallpapers',()=>({files:[],directory:null}));
      ipcMain.handle('preset:list',()=>[]);
      const report=await require('./effect-editor-probe').run(output);
      fs.writeFileSync(path.join(output,'editor-selection-report.json'),JSON.stringify(report,null,2));clearTimeout(timer);app.exit(0);return;
    }
    await win.loadFile(path.join(__dirname, 'electron-probe.html'));
    const frameCorners=await win.webContents.executeJavaScript(`require('./frame-corners-probe').run(${JSON.stringify(output)}).catch(error=>({probeError:error.stack}))`);
    if(frameCorners.probeError)throw new Error(frameCorners.probeError);
    if(process.env.DOGSC_FRAME_CORNERS_PROBE==='1'){
      clearTimeout(timer);app.exit(0);return;
    }
    const report = await win.webContents.executeJavaScript(`require('./electron-probe-renderer').run(${JSON.stringify(output)})`);
    report.frameCorners=frameCorners;
    report.effects=await win.webContents.executeJavaScript(`require('./effects-renderer-probe').run(${JSON.stringify(output)})`);
    report.overlays=await win.webContents.executeJavaScript(`require('./overlay-renderer-probe').run(${JSON.stringify(output)})`);
    report.reliability=await win.webContents.executeJavaScript(`require('./reliability-renderer-probe').run(${JSON.stringify(output)})`);
    report.cursorAssets=await win.webContents.executeJavaScript(`(()=>{const assert=require('node:assert/strict'),lib=require('../src/renderer/editor/cursors').cursorLibrary();const names=['arrow','pointingHand','ibeam','crosshair','openHand','closedHand','notAllowed','touchDot'];for(const name of names){const sprite=lib[name];assert.ok(sprite&&sprite.width>0);const data=sprite.canvas.getContext('2d').getImageData(0,0,sprite.width,sprite.height).data;assert.ok(data.some((v,i)=>i%4===3&&v>0),name);}return {passed:true,names};})()`);
    const { makeProject } = require('../src/core/model');
    const project = makeProject({ name: '合成媒体编辑器验收', media: {
      screen: { file: 'white.mp4', width: 640, height: 360, duration: 3, frameRate: 30 },
      camera: { file: 'white.mp4', width: 640, height: 360, duration: 3, offset: 0 },
      microphone:{file:'tone.m4a',duration:3,offset:0},
    }});
    let savedProject = null;
    ipcMain.handle('project:read', () => require('../src/core/model').normalizeProject(savedProject
      ? JSON.parse(fs.readFileSync(path.join(output, 'edited-project.json'), 'utf8')) : project));
    ipcMain.handle('project:write', (event, { directory, project: edited }) => {
      if (directory !== output) throw new Error('Probe must not save user projects');
      require('../src/core/model').validateProjectContract(edited);
      savedProject = JSON.parse(JSON.stringify(edited));
      fs.writeFileSync(path.join(output, 'edited-project.json'), JSON.stringify(savedProject, null, 2));
    });
    ipcMain.handle('system:wallpapers', () => ({ files: [], directory: null }));
    const presets=new (require('../src/main/scene-presets').ScenePresets)(path.join(output,'probe-presets'));
    ipcMain.handle('preset:list',()=>presets.list().map(({id,name,builtin})=>({id,name,builtin})));
    ipcMain.handle('preset:apply',(event,{id,directory})=>presets.apply(id,directory));
    ipcMain.handle('preset:save',(event,{name,project,directory})=>presets.save(name,project,directory));
    ipcMain.handle('preset:remove',(event,id)=>presets.remove(id));
    ipcMain.handle('project:import-sticker',()=> 'green.png');
    ipcMain.handle('project:import-background-video',()=>({kind:'video',file:'loop-background.mp4',width:320,height:180,duration:1}));
    ipcMain.handle('project:waveforms',()=>require('../src/main/audio-waveform').waveforms(output,savedProject||project,media.resolveBinaries(null).ffmpeg));
    const editor = new BrowserWindow({ show: false, width: 1480, height: 940,
      webPreferences: { nodeIntegration: true, contextIsolation: false, backgroundThrottling: false } });
    await editor.loadFile(path.join(__dirname, '../src/renderer/editor.html'), { query: { project: output } });
    const ready = await editor.webContents.executeJavaScript(`new Promise((resolve,reject)=>{
      const deadline=performance.now()+10000;
      const check=()=>{if(typeof window.dogscSelfTest==='function' && document.getElementById('preview').width>2)resolve(true);
        else if(performance.now()>deadline)reject(new Error(document.body.innerText));else setTimeout(check,25);};check();})`);
    await new Promise((resolve) => setTimeout(resolve, 300));
    fs.writeFileSync(path.join(output, 'editor.png'), (await editor.webContents.capturePage()).toPNG());
    report.editorBoot = { passed: ready, syntheticProject: true };
    report.editor3D = await editor.webContents.executeJavaScript(`(async()=>{
      const assert=require('node:assert/strict');window.__probeErrors=[];window.addEventListener('error',e=>window.__probeErrors.push(e.message));
      const click=(label)=>{const button=[...document.querySelectorAll('button')].find(n=>n.textContent.trim()===label);assert.ok(button,'missing '+label);button.click();};
      click('屏幕 3D');click('在播放头添加 3D 片段');
      assert.equal(document.querySelectorAll('#lane-screen-motion .zoom-clip').length,1);
      const editAngle=()=>{const field=[...document.querySelectorAll('label.field')].find(n=>n.textContent.includes('X 轴旋转'));assert.ok(field);const input=field.querySelector('input');
        input.dispatchEvent(new Event('pointerdown'));input.value='35';input.dispatchEvent(new Event('input'));input.dispatchEvent(new Event('change'));};
      editAngle();document.getElementById('undo').click();
      let field=[...document.querySelectorAll('label.field')].find(n=>n.textContent.includes('X 轴旋转'));
      assert.equal(Number(field.querySelector('input').value),10);
      document.getElementById('redo').click();field=[...document.querySelectorAll('label.field')].find(n=>n.textContent.includes('X 轴旋转'));
      assert.equal(Number(field.querySelector('input').value),35);
      click('画面');click('自定义');
      const number=(label,value)=>{const field=[...document.querySelectorAll('label.field')].find(n=>n.textContent.includes(label));assert.ok(field,label+'; inspector='+document.getElementById('inspector').innerText+'; errors='+window.__probeErrors.join(' | '));const input=field.querySelector('input');input.value=String(value);input.dispatchEvent(new Event('change'));};
      number('宽度比例',2);number('高度比例',1);
      let crop=[...document.querySelectorAll('label.field')].find(n=>n.textContent.includes('左侧')).querySelector('input');
      crop.dispatchEvent(new Event('pointerdown'));crop.value='0.25';crop.dispatchEvent(new Event('input'));crop.dispatchEvent(new Event('change'));
      click('摄像头');let camera=[...document.querySelectorAll('label.field')].find(n=>n.textContent.includes('内部缩放')).querySelector('input');
      camera.dispatchEvent(new Event('pointerdown'));camera.value='2';camera.dispatchEvent(new Event('input'));camera.dispatchEvent(new Event('change'));
      await new Promise(r=>setTimeout(r,700));
      return {passed:true,add:true,edit:true,undoRedo:true,customAspectEditor:true,cropEditor:true,cameraContentEditor:true};})()`);
    report.editorEffects=await editor.webContents.executeJavaScript(`(async()=>{
      const assert=require('node:assert/strict');
      const click=(text)=>{const b=[...document.querySelectorAll('button')].find(n=>n.textContent.trim()===text);assert.ok(b,text);b.click();};
      const field=(text)=>{const f=[...document.querySelectorAll('.field')].find(n=>n.textContent.includes(text));assert.ok(f,text);return f;};
      const slider=(text,value)=>{const input=field(text).querySelector('input');input.dispatchEvent(new Event('pointerdown'));input.value=String(value);input.dispatchEvent(new Event('input'));input.dispatchEvent(new Event('change'));};
      const select=(text,value)=>{const input=field(text).querySelector('select');input.value=value;input.dispatchEvent(new Event('change'));};
      click('屏幕 3D');field('启用聚焦').querySelector('button').click();slider('外部暗化',0.25);
      click('摄像头动画');click('在播放头添加摄像头动画');
      assert.equal(document.querySelectorAll('#lane-camera-motion .zoom-clip').length,1);
      select('布局','fullscreen');slider('目标透明度',0.6);
      document.getElementById('undo').click();assert.equal(Number(field('目标透明度').querySelector('input').value),1);
      document.getElementById('redo').click();assert.equal(Number(field('目标透明度').querySelector('input').value),0.6);
      click('开场');field('启用开场').querySelector('button').click();select('预设','sideSlide');slider('总时长',1.3);select('入场顺序','camera');
      await new Promise(r=>setTimeout(r,700));
      return {passed:true,focusControls:true,cameraTrack:true,cameraLayout:true,cameraUndoRedo:true,openingControls:true};
    })()`);
    report.editorOverlays=await editor.webContents.executeJavaScript(`(async()=>{
      const assert=require('node:assert/strict');
      const click=text=>{const b=[...document.querySelectorAll('button')].find(n=>n.textContent.trim()===text);assert.ok(b,text);b.click();};
      const field=text=>{const f=[...document.querySelectorAll('.field')].find(n=>n.textContent.includes(text));assert.ok(f,text);return f;};
      const slider=(text,value)=>{const input=field(text).querySelector('input');input.dispatchEvent(new Event('pointerdown'));input.value=String(value);input.dispatchEvent(new Event('input'));input.dispatchEvent(new Event('change'));};
      const select=(text,value)=>{const input=field(text).querySelector('select');input.value=value;input.dispatchEvent(new Event('change'));};
      const wait=ms=>new Promise(r=>setTimeout(r,ms));
      click('贴图');click('导入贴图…');for(let i=0;i<100&&!document.querySelector('#lane-sticker .zoom-clip');i++)await wait(20);
      assert.equal(document.querySelectorAll('#lane-sticker .zoom-clip').length,1);slider('贴图宽度',0.28);slider('背后模糊',0);
      await wait(150);const guide=document.querySelector('.canvas-tools polygon');assert.ok(guide,'sticker canvas guide');const box=guide.getBoundingClientRect(),gx=box.left+box.width/2,gy=box.top+box.height/2;
      guide.dispatchEvent(new MouseEvent('pointerdown',{bubbles:true,clientX:gx,clientY:gy}));window.dispatchEvent(new MouseEvent('pointermove',{bubbles:true,clientX:gx+30,clientY:gy+20}));window.dispatchEvent(new MouseEvent('pointerup',{bubbles:true,clientX:gx+30,clientY:gy+20}));
      click('柔化／突出');click('添加柔化区域');slider('效果强度',0.8);click('添加突出区域');slider('突出暗化',0.4);
      assert.equal(document.querySelectorAll('#lane-mosaic .zoom-clip').length,2);
      click('画面');click('启用动态背景');select('动态图案','auroraFluid');select('外框样式','browserDark');click('视频背景…');await wait(100);
      document.querySelector('#lane-screen-motion .zoom-clip').dispatchEvent(new MouseEvent('pointerdown',{bubbles:true,clientX:300}));window.dispatchEvent(new MouseEvent('pointerup',{bubbles:true,clientX:300}));
      select('缓动','custom');slider('x1',0.3);slider('y1',0.7);
      const lanes=document.getElementById('lanes').getBoundingClientRect();const x=lanes.left+14+(lanes.width-28)*0.5;
      document.getElementById('ruler').dispatchEvent(new MouseEvent('pointerdown',{bubbles:true,clientX:x}));window.dispatchEvent(new MouseEvent('pointerup',{bubbles:true,clientX:x}));
      window.dispatchEvent(new KeyboardEvent('keydown',{key:'b',ctrlKey:true,bubbles:true}));assert.equal(document.querySelectorAll('#lane-screen .segment').length,2);
      let segment=document.querySelector('#lane-screen .segment'),rect=segment.getBoundingClientRect();segment.dispatchEvent(new MouseEvent('pointerdown',{bubbles:true,clientX:rect.left+15}));window.dispatchEvent(new MouseEvent('pointerup',{bubbles:true,clientX:rect.left+15}));
      click('声音');field('单独设置此片段').querySelector('button').click();slider('片段麦克风音量',0.35);
      segment=document.querySelector('#lane-screen .segment');rect=segment.getBoundingClientRect();segment.dispatchEvent(new MouseEvent('pointerdown',{bubbles:true,clientX:rect.left+15,altKey:true}));
      window.dispatchEvent(new MouseEvent('pointerup',{bubbles:true,clientX:rect.left+lanes.width,altKey:true}));
      await wait(700);assert.ok(document.querySelector('.audio-waveform'),'audio waveform should render');
      click('场景');assert.ok([...document.querySelectorAll('button')].some(n=>n.textContent.trim()==='应用 · 简洁浅色'));click('应用 · 简洁浅色');await wait(150);document.getElementById('undo').click();await wait(700);
      return{passed:true,stickerImport:true,canvasGesture:true,regionControls:true,decorativeFrame:true,videoBackground:true,customCurve:true,splitAndReorder:true,segmentAudio:true,waveform:true,builtinPresetAndUndo:true};
    })()`);
    if (!savedProject || savedProject.timeline.screenMotionClips[0].target.rotationX !== 35) throw new Error('3D editor did not persist the changed target');
    if (savedProject.canvas.aspectRatio !== 'custom' || savedProject.canvas.customAspectRatio.width !== 2 || savedProject.canvas.crop.x !== 0.25 || savedProject.camera.contentScale !== 2) throw new Error('layout editor fields were not saved');
    if (savedProject.timeline.screenMotionClips[0].focusEffect?.dimming!==0.25
      || savedProject.timeline.cameraMotionClips[0]?.target.layout.kind!=='fullscreen'
      || savedProject.timeline.cameraMotionClips[0]?.target.opacity!==0.6
      || !savedProject.openingSequence.isEnabled || savedProject.openingSequence.preset!=='sideSlide'
      || savedProject.openingSequence.elementOrder[0]!=='camera') throw new Error('animation effect settings were not saved');
    report.editorEffects.persisted=true;
    if(savedProject.timeline.stickerClips.length!==1||savedProject.timeline.mosaicClips.length!==2||savedProject.canvas.background.kind!=='video'||savedProject.canvas.screenFrame!=='browserDark'
      ||savedProject.timeline.screenMotionClips[0].timing.customCurve?.x1!==0.3||savedProject.timeline.segments.length!==2||!savedProject.timeline.segments.some(s=>s.audio?.microphoneVolume===0.35)
      ||savedProject.timeline.segments[0].sourceStart===0)throw new Error('overlay/reorder/audio settings were not persisted');
    report.editorOverlays.persisted=true;
    report.editor3D.persisted = true;
    await new Promise((resolve) => { editor.webContents.once('did-finish-load', resolve); editor.reload(); });
    report.editor3D.reopened = await editor.webContents.executeJavaScript(`new Promise((resolve,reject)=>{
      const deadline=performance.now()+10000;
      const check=()=>{if(typeof window.dogscSelfTest==='function'){
        const assert=require('node:assert/strict');assert.ok(document.querySelectorAll('#lane-screen-motion .zoom-clip').length>=1);
        assert.ok(document.querySelectorAll('#lane-camera-motion .zoom-clip').length>=1);
        assert.ok(document.querySelectorAll('#lane-sticker .zoom-clip').length>=1);assert.ok(document.querySelectorAll('#lane-mosaic .zoom-clip').length>=2);
        const button=[...document.querySelectorAll('#rail button')].find(n=>n.textContent.trim()==='屏幕 3D');button.click();
        document.querySelector('#lane-screen-motion .zoom-clip').dispatchEvent(new MouseEvent('pointerdown',{bubbles:true,clientX:200}));
        window.dispatchEvent(new MouseEvent('pointerup',{bubbles:true,clientX:200}));
        const field=[...document.querySelectorAll('label.field')].find(n=>n.textContent.includes('X 轴旋转'));assert.equal(Number(field.querySelector('input').value),35);resolve(true);
      }else if(performance.now()>deadline)reject(new Error(document.body.innerText));else setTimeout(check,25);};check();})`);
    await new Promise((resolve) => setTimeout(resolve, 200));
    report.editorEffects.reopened=report.editor3D.reopened;
    report.editorOverlays.reopened=report.editor3D.reopened;
    fs.writeFileSync(path.join(output, 'editor-3d.png'), (await editor.webContents.capturePage()).toPNG());
    editor.destroy();
    report.editorSelectionClipboard=await require('./effect-editor-probe').run(output);
    report.electron = process.versions.electron;
    report.chrome = process.versions.chrome;
    report.gpu = app.getGPUFeatureStatus();
    fs.writeFileSync(path.join(output, 'renderer-report.json'), JSON.stringify(report, null, 2));
    clearTimeout(timer); app.exit(0);
  } catch (error) {
    fs.writeFileSync(path.join(output, process.env.DOGSC_REAL_PROJECT_DIR?'real-project-report.json':process.env.DOGSC_SESSION_LIFECYCLE_PROBE==='1'?'session-lifecycle-report.json':process.env.DOGSC_SAVE_CLOSE_PROBE==='1'?'save-close-report.json':process.env.DOGSC_RECOVERY_PROBE==='1'?'recovery-report.json':process.env.DOGSC_CLIPBOARD_ROUNDTRIP==='1'?'clipboard-roundtrip-report.json':process.env.DOGSC_FRAME_CORNERS_PROBE==='1'?'frame-corners-report.json':process.env.DOGSC_EFFECT_EDITOR_PROBE==='1'?'editor-selection-report.json':process.env.DOGSC_CAPTURE_PROBE==='1'?'window-capture-report.json':'renderer-report.json'), JSON.stringify({ error: error.stack }, null, 2));
    clearTimeout(timer); app.exit(1);
  }
});
