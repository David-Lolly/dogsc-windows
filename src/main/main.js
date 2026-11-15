'use strict';
// DogSC Windows 版主进程：窗口管理、录制调度、项目库与导出混流。

const { app, BrowserWindow, ipcMain, screen, desktopCapturer, dialog, globalShortcut, session, shell, Menu, powerMonitor, clipboard } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const media = require('./ffmpeg');
const { RecordingSession, listDisplays, PROJECT_EXTENSION } = require('./recording');
const { normalizeProject, validateProjectContract } = require('../core/model');

// 所有窗口只加载应用自带的本地页面，不打开任何远程内容。
process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';

const RENDERER = path.join(__dirname, '..', 'renderer');
const SELF_TEST = process.argv.includes('--selftest');
const SMOKE_TEST = process.argv.includes('--smoke-startup');
if(SMOKE_TEST){if(!process.env.DOGSC_PROBE_OUTPUT)throw Error('DOGSC_PROBE_OUTPUT is required for startup smoke test');app.setPath('userData',path.join(process.env.DOGSC_PROBE_OUTPUT,'startup-profile'));}
// 开发时直接用仓库里的 resources（字体、图标）；打包后由 electron-builder 复制到 resources/Resources。
const resourcesDirectory = app.isPackaged
  ? path.join(process.resourcesPath, 'Resources')
  : path.join(__dirname, '..', '..', 'resources');
// 自测产生的项目放在临时目录，不进用户的项目库。
const projectsRoot = () => (SMOKE_TEST?path.join(process.env.DOGSC_PROBE_OUTPUT,'startup-projects'):SELF_TEST ? path.join(app.getPath('temp'), 'dogsc-selftest') : path.join(app.getPath('videos'), 'DogSC'));

let recorderWindow = null;
let libraryWindow = null;
let cameraWindow = null;
let memoWindow = null;
const editorWindows = new Map();
let recording = null;
let preparing = null;
let finalizingRecording = false;
let startingRecording = false;
let environment = { ok: false, reason: '正在检查 ffmpeg…' };
const { dockBounds, dragBounds } = require('../core/recorder-dock');
const exportJobs = new (require('./export-jobs').ExportJobs)();

function createWindow(file, options = {}, query = {}) {
  const win = new BrowserWindow({
    show: false,
    backgroundColor: options.transparent ? '#00000000' : '#F4F5F3',
    icon: path.join(resourcesDirectory, 'AppIconMaster.png'),
    ...options,
    webPreferences: { nodeIntegration: true, contextIsolation: false, backgroundThrottling: false, ...(options.webPreferences || {}) },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(RENDERER, file), { query: { resources: resourcesDirectory, ...query } });
  return win;
}

/// 录制条、备忘录、摄像头预览都不进入本软件自己的录制画面（WDA_EXCLUDEFROMCAPTURE）。
function excludeFromCapture(win) {
  win.setContentProtection(true);
  win.setAlwaysOnTop(true, 'screen-saver');
}

function showRecorder() {
  if (recorderWindow && !recorderWindow.isDestroyed()) {
    recorderWindow.show();
    return recorderWindow;
  }
  const area = screen.getPrimaryDisplay().workArea;
  const width = 1040;
  const height = 132;
  recorderWindow = createWindow('recorder.html', {
    width, height,
    x: Math.round(area.x + (area.width - width) / 2),
    y: Math.round(area.y + area.height - height - 28),
    frame: false, transparent: true, resizable: false, maximizable: false, fullscreenable: false, skipTaskbar: false, hasShadow: false,
    title: 'DogSC',
  });
  excludeFromCapture(recorderWindow);
    recorderWindow.once('ready-to-show', () => {if(!SMOKE_TEST)recorderWindow.show();});
    recorderWindow.on('close', event => {
      if (preparing || startingRecording || recording || finalizingRecording) {
        event.preventDefault();
        if (recording) recorderWindow.webContents.send('recorder:interrupted','录制窗口正在关闭，先保存已录内容');
      }
    });
  recorderWindow.on('closed', () => {
    recorderWindow = null;
    for (const win of [cameraWindow, memoWindow]) if (win && !win.isDestroyed()) win.close();
    if (!editorWindows.size && !(libraryWindow && !libraryWindow.isDestroyed())) app.quit();
  });
  return recorderWindow;
}

function showLibrary() {
  if (libraryWindow && !libraryWindow.isDestroyed()) {
    libraryWindow.show();
    libraryWindow.focus();
    libraryWindow.webContents.send('library:refresh');
    return;
  }
  libraryWindow = createWindow('library.html', { width: 980, height: 680, minWidth: 720, minHeight: 480, title: 'DogSC 项目库' });
  libraryWindow.once('ready-to-show', () => libraryWindow.show());
  libraryWindow.on('closed', () => { libraryWindow = null; });
}

function openEditor(directory) {
  const existing = editorWindows.get(directory);
  if (existing && !existing.isDestroyed()) {
    existing.show();
    existing.focus();
    return existing;
  }
  const win = createWindow('editor.html', { width: 1480, height: 940, minWidth: 1100, minHeight: 700, title: `${path.basename(directory, PROJECT_EXTENSION)} — DogSC` }, { project: directory });
  win.once('ready-to-show', () => { win.maximize(); win.show(); });
  win.on('closed', () => editorWindows.delete(directory));
  editorWindows.set(directory, win);
  return win;
}

function toggleCameraPreview(visible, deviceId) {
  if (!visible) {
    if (cameraWindow && !cameraWindow.isDestroyed()) cameraWindow.close();
    cameraWindow = null;
    return;
  }
  if (cameraWindow && !cameraWindow.isDestroyed()) {
    cameraWindow.webContents.send('camera:device', deviceId);
    return;
  }
  const area = screen.getPrimaryDisplay().workArea;
  cameraWindow = createWindow('camera.html', {
    width: 240, height: 240, x: area.x + 36, y: area.y + area.height - 240 - 36,
    frame: false, transparent: true, resizable: false, skipTaskbar: true, hasShadow: false, focusable: false,
  }, { device: deviceId || '' });
  excludeFromCapture(cameraWindow);
  cameraWindow.once('ready-to-show', () => cameraWindow.showInactive());
  cameraWindow.on('closed', () => { cameraWindow = null; });
}

function toggleMemo() {
  if (memoWindow && !memoWindow.isDestroyed()) {
    memoWindow.close();
    return;
  }
  const area = screen.getPrimaryDisplay().workArea;
  memoWindow = createWindow('memo.html', {
    width: 360, height: 300, minWidth: 240, minHeight: 160, x: area.x + area.width - 360 - 36, y: area.y + 80,
    frame: false, transparent: true, skipTaskbar: true, hasShadow: false,
  }, { store: path.join(app.getPath('userData'), 'memo.json') });
  excludeFromCapture(memoWindow);
  memoWindow.once('ready-to-show', () => memoWindow.show());
  memoWindow.on('closed', () => { memoWindow = null; });
}

/// 全屏半透明遮罩上拖出录制区域，返回所在显示器与物理像素矩形。
function pickArea() {
  return new Promise((resolve) => {
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const overlay = createWindow('area.html', {
      ...display.bounds, frame: false, transparent: true, resizable: false, movable: false, skipTaskbar: true, hasShadow: false, fullscreenable: false,
    });
    overlay.setAlwaysOnTop(true, 'screen-saver');
    overlay.once('ready-to-show', () => { overlay.show(); overlay.focus(); });
    let settled = false;
    const finish = (rect) => {
      if (settled) return;
      settled = true;
      ipcMain.removeListener('area:done', onDone);
      if (!overlay.isDestroyed()) overlay.close();
      if (!rect) return resolve(null);
      const scale = display.scaleFactor;
      resolve({
        displayId: display.id,
        rect: { x: Math.round(rect.x * scale), y: Math.round(rect.y * scale), width: Math.round(rect.width * scale), height: Math.round(rect.height * scale) },
      });
    };
    const onDone = (event, rect) => { if (event.sender === overlay.webContents) finish(rect); };
    ipcMain.on('area:done', onDone);
    overlay.on('closed', () => finish(null));
  });
}

async function listWindows() {
  const own = new Set(BrowserWindow.getAllWindows().map((win) => win.getMediaSourceId()));
  const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 360, height: 220 } });
  return sources
    .filter((source) => !own.has(source.id) && source.name)
    .map((source) => ({ hwnd: Number(source.id.split(':')[1]), title: source.name, thumbnail: source.thumbnail.isEmpty() ? null : source.thumbnail.toDataURL() }))
    .filter((source) => Number.isFinite(source.hwnd) && source.hwnd > 0);
}

function listProjects() {
  const root = projectsRoot();
  if (!fs.existsSync(root)) return [];
  const projects = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.endsWith(PROJECT_EXTENSION)) continue;
    const directory = path.join(root, entry.name);
    try {
      const project = JSON.parse(fs.readFileSync(path.join(directory, 'project.json'), 'utf8'));
      validateProjectContract(project);
      projects.push({
        directory,
        name: project.name || path.basename(directory, PROJECT_EXTENSION),
        createdAt: project.createdAt,
        duration: project.media.screen.duration,
        width: project.media.screen.width,
        height: project.media.screen.height,
        recoveredFrom: project.capture?.recoveredFrom,
        thumbnails: project.media.thumbnails ? { ...project.media.thumbnails, file: path.join(directory, project.media.thumbnails.file) } : null,
      });
    } catch {
      const recovery=require('./recording-recovery').candidate(directory);
      if(recovery)projects.push(recovery);
    }
  }
  const recovered=new Set(projects.filter(p=>!p.recovery&&p.recoveredFrom).map(p=>path.resolve(p.recoveredFrom).toLowerCase()));
  return projects.filter(p=>!p.recovery||!recovered.has(path.resolve(p.directory).toLowerCase())).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

/// Windows 自带壁纸，对应 macOS 版的"系统壁纸"背景来源。
function listWallpapers() {
  const roots = [path.join(process.env.SystemRoot || 'C:\\Windows', 'Web', 'Wallpaper'), path.join(process.env.SystemRoot || 'C:\\Windows', 'Web', '4K', 'Wallpaper')];
  const files = [];
  const walk = (directory, depth) => {
    let entries = [];
    try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory() && depth < 3) walk(full, depth + 1);
      else if (/\.(jpe?g|png)$/i.test(entry.name)) files.push(full);
    }
  };
  roots.forEach((root) => walk(root, 0));
  const current = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Themes', 'TranscodedWallpaper');
  return { current: fs.existsSync(current) ? current : null, files: files.slice(0, 48) };
}

function registerIpc() {
  const effectClipboard=new(require('./effect-clipboard').EffectClipboard)(clipboard);
  const effectAssets=new(require('./effect-assets').EffectAssets)();
  ipcMain.handle('effects:copy',(event,payload)=>effectClipboard.copy(payload));
  ipcMain.handle('effects:paste',async(event,request)=>{const payload=await effectClipboard.paste();return effectAssets.prepare(event.sender,payload,request.directory,request.project,request.sourceTime);});
  ipcMain.handle('effects:accept-import',(event,id)=>effectAssets.finish(event.sender.id,id,true));
  ipcMain.handle('effects:discard-import',(event,id)=>effectAssets.finish(event.sender.id,id,false));
  ipcMain.handle('app:environment', () => ({ ...environment, projectsRoot: projectsRoot(), version: app.getVersion() }));
  ipcMain.handle('recorder:displays', () => listDisplays());
  ipcMain.handle('recorder:windows', () => listWindows());
  ipcMain.handle('recorder:pick-area', () => pickArea());
  ipcMain.handle('recorder:pick-window', () => new Promise((resolve) => {
    const picker = createWindow('picker.html', { width: 900, height: 620, parent: recorderWindow || undefined, title: '选择要录制的窗口' });
    picker.once('ready-to-show', () => picker.show());
    const onDone = (event, choice) => {
      if (event.sender !== picker.webContents) return;
      ipcMain.removeListener('picker:done', onDone);
      resolve(choice);
      picker.close();
    };
    ipcMain.on('picker:done', onDone);
    picker.on('closed', () => { ipcMain.removeListener('picker:done', onDone); resolve(null); });
  }));

  /// 设备菜单用原生菜单弹出，录制条窗口就不需要为下拉面板预留透明区域。
  ipcMain.handle('recorder:menu', (event, items) => new Promise((resolve) => {
    let chosen = null;
    const menu = Menu.buildFromTemplate(items.map((item) => (item.separator
      ? { type: 'separator' }
      : { label: item.label, type: item.checked === undefined ? 'normal' : 'checkbox', checked: Boolean(item.checked), enabled: item.enabled !== false, click: () => { chosen = item.id; } })));
    menu.popup({ window: BrowserWindow.fromWebContents(event.sender), callback: () => resolve(chosen) });
  }));

  // 录制分两步启动：先建好项目目录，让录制条把摄像头、麦克风、系统声音先录起来，
  // 再开始屏幕采集。这样附加轨一定早于屏幕首帧，成片从第一帧起就有画中画和声音。
  ipcMain.handle('recorder:prepare', async (event, { selection, frameRate }) => {
    if (startingRecording || recording || finalizingRecording) throw new Error('正在启动、录制或保存素材，请稍候');
    if (!environment.ok) throw new Error(environment.reason);
    if (preparing) await preparing.discard();
    fs.mkdirSync(projectsRoot(), { recursive: true });
    preparing = new RecordingSession({ projectsRoot: projectsRoot(), selection, frameRate });
    fs.mkdirSync(preparing.mediaDirectory, { recursive: true });
    return { mediaDirectory: preparing.mediaDirectory };
  });
  ipcMain.handle('recorder:start', async (event, tracks=[]) => {
    if (startingRecording) throw new Error('录制正在启动，请稍候');
    if (!preparing) throw new Error('录制还没有准备好');
    const sessionState = preparing;
    sessionState.setTracks(tracks);
    preparing = null;
    startingRecording = true;
    let started;
    try {started = await sessionState.start(reason=>{if(!event.sender.isDestroyed())event.sender.send('recorder:interrupted',reason);});}
    finally {startingRecording = false;}
    recording = sessionState;
    // 对应 macOS 版的 ⌃⌥M：录制中留下剪辑标记。
    globalShortcut.register('Control+Alt+M', () => {
      if (recording && recording.addMarker() && recorderWindow) recorderWindow.webContents.send('recorder:marker-added', recording.markers.length);
    });
    return started;
  });
  ipcMain.handle('recorder:marker', () => (recording && recording.addMarker() ? recording.markers.length : 0));
  ipcMain.handle('recorder:stop', async (event, tracks) => {
    if (!recording) throw new Error('当前没有在录制');
    const sessionState = recording;
    recording = null;
    finalizingRecording = true;
    globalShortcut.unregister('Control+Alt+M');
    let result;
    try {result = await sessionState.finish(tracks, (stage) => {if(!event.sender.isDestroyed())event.sender.send('recorder:stage', stage);});}
    finally {finalizingRecording = false;}
    if (libraryWindow && !libraryWindow.isDestroyed()) libraryWindow.webContents.send('library:refresh');
    const { media: recorded } = result.project;
    return {
      directory: result.directory, name: result.project.name, duration: recorded.screen.duration,
      warnings: result.project.recordingWarnings || [],
      recorded: { camera: Boolean(recorded.camera), microphone: Boolean(recorded.microphone), system: Boolean(recorded.systemAudio) },
    };
  });
  ipcMain.handle('recorder:cancel', async () => {
    const sessionState = recording || preparing;
    if (!sessionState) return;
    preparing = null;
    recording = null;
    globalShortcut.unregister('Control+Alt+M');
    await sessionState.discard();
  });
  ipcMain.on('recorder:camera-preview', (event, { visible, deviceId }) => toggleCameraPreview(visible, deviceId));
  ipcMain.on('recorder:memo', () => toggleMemo());
  ipcMain.on('recorder:library', () => showLibrary());
  ipcMain.on('recorder:show', () => showRecorder());
  // 录制条折叠为悬浮胶囊 / 展开：由页面通知目标形态，窗口矩形见 core/recorder-dock.js。
  const workAreaOf = (bounds) => screen.getDisplayMatching(bounds).workArea;
  let dragStart = null;
  ipcMain.on('recorder:dock', (event, { collapsed, width }) => {
    if (!recorderWindow || recorderWindow.isDestroyed() || event.sender !== recorderWindow.webContents) return;
    const current = recorderWindow.getBounds();
    recorderWindow.setBounds(dockBounds(current, { collapsed, width }, workAreaOf(current)));
  });
  ipcMain.on('recorder:drag-start', () => { dragStart = recorderWindow && !recorderWindow.isDestroyed() ? recorderWindow.getBounds() : null; });
  ipcMain.on('recorder:drag-move', (event, { dx, dy }) => {
    if (!dragStart || !recorderWindow || recorderWindow.isDestroyed()) return;
    recorderWindow.setBounds(dragBounds(dragStart, dx, dy, workAreaOf(dragStart)));
  });
  // 展开/收起快捷键；被其他程序占用时静默跳过，不影响录制。
  globalShortcut.register('Control+Alt+R', () => {
    if (recorderWindow && !recorderWindow.isDestroyed()) recorderWindow.webContents.send('recorder:toggle-dock');
  });
  ipcMain.on('window:close', (event) => { const win = BrowserWindow.fromWebContents(event.sender); if (win) win.close(); });
  ipcMain.on('window:minimize', (event) => { const win = BrowserWindow.fromWebContents(event.sender); if (win) win.minimize(); });

  ipcMain.handle('project:list', () => listProjects());
  ipcMain.handle('project:assets',(event,{directory,project})=>require('../core/project-assets').assetReferences(project).map(({key,label,file,kind})=>({key,label,file,kind,exists:fs.existsSync(path.resolve(directory,file))})));
  ipcMain.handle('project:relink-asset',async(event,{directory,project,key})=>{
    const result=await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender),{title:'重新定位素材（保留现有剪辑）',properties:['openFile']});
    if(result.canceled||!result.filePaths[0])return null;
    return require('./asset-relink').relinkAsset(directory,project,key,result.filePaths[0],media);
  });
  ipcMain.handle('project:recover',async(event,directory)=>{
    if(recording||startingRecording||finalizingRecording||preparing)throw new Error('请先结束当前录制和保存，再恢复工程。');
    finalizingRecording=true;
    try{
      const result=await require('./recording-recovery').recover(projectsRoot(),directory,media);
      openEditor(result.directory);return result.directory;
    }finally{finalizingRecording=false;if(libraryWindow&&!libraryWindow.isDestroyed())libraryWindow.webContents.send('library:refresh');}
  });
  ipcMain.handle('project:open', (event, directory) => { openEditor(directory); });
  ipcMain.handle('project:read', (event, directory) => {
    const target = path.join(directory, 'project.json');
    const project = JSON.parse(fs.readFileSync(target, 'utf8'));
    validateProjectContract(project);
    if (project.schema === 1 && !fs.existsSync(`${target}.schema1.bak`)) fs.copyFileSync(target, `${target}.schema1.bak`, fs.constants.COPYFILE_EXCL);
    return normalizeProject(project);
  });
  ipcMain.handle('project:write', (event, { directory, project }) => {
    require('./project-files').writeProject(directory,project);
  });
  ipcMain.handle('project:trash', async (event, directory) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const { response } = await dialog.showMessageBox(win, {
      type: 'question', buttons: ['移到回收站', '取消'], defaultId: 1, cancelId: 1,
      message: `把「${path.basename(directory, PROJECT_EXTENSION)}」移到回收站？`, detail: '项目和它的录制素材会一起进回收站，需要时可以从回收站还原。',
    });
    if (response !== 0) return false;
    const editor = editorWindows.get(directory);
    if (editor && !editor.isDestroyed()) editor.close();
    await shell.trashItem(directory);
    return true;
  });
  ipcMain.on('project:reveal', (event, target) => shell.showItemInFolder(target));
  ipcMain.handle('project:rebuild-index', async (event, file) => media.buildVideoIndex(file));
  ipcMain.handle('project:waveforms',async(event,directory)=>{
    const project=normalizeProject(JSON.parse(fs.readFileSync(path.join(directory,'project.json'),'utf8')));
    return require('./audio-waveform').waveforms(directory,project,media.resolveBinaries(app.isPackaged?process.resourcesPath:null).ffmpeg);
  });
  ipcMain.handle('system:wallpapers', () => listWallpapers());
  const presets=new(require('./scene-presets').ScenePresets)(path.join(app.getPath('userData'),'scene-presets'));
  ipcMain.handle('preset:list',()=>presets.list().map(({id,name,builtin})=>({id,name,builtin:Boolean(builtin)})));
  ipcMain.handle('preset:save',(event,{name,project,directory})=>{validateProjectContract(project);return presets.save(name,project,directory);});
  ipcMain.handle('preset:apply',(event,{id,directory})=>presets.apply(id,directory));
  ipcMain.handle('preset:remove',(event,id)=>presets.remove(id));
  ipcMain.handle('dialog:open-image', async (event) => {
    const result = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), { title: '选择背景图片', properties: ['openFile'], filters: [{ name: '图片', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp'] }] });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle('project:import-sticker',async(event,directory)=>{
    const result=await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender),{title:'导入贴图',properties:['openFile'],filters:[{name:'图片',extensions:['png','jpg','jpeg','webp','bmp']}]});
    if(result.canceled||!result.filePaths[0])return null;
    const original=result.filePaths[0],relative=`media/stickers/${require('node:crypto').randomUUID()}${path.extname(original).toLowerCase()}`;
    fs.mkdirSync(path.dirname(path.join(directory,relative)),{recursive:true});fs.copyFileSync(original,path.join(directory,relative));
    return relative;
  });
  ipcMain.handle('dialog:save-export', async (event, { name, kind }) => {
    const extension = kind === 'audio' ? 'm4a' : 'mp4';
    const result = await dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender), {
      title: '导出', defaultPath: path.join(app.getPath('videos'), `${name}.${extension}`),
      filters: [{ name: kind === 'audio' ? 'M4A 音频' : 'MP4 视频', extensions: [extension] }],
    });
    return result.canceled ? null : result.filePath;
  });
  ipcMain.handle('project:import-background-video',async(event,directory)=>{
    const result=await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender),{title:'导入视频背景',properties:['openFile'],filters:[{name:'视频',extensions:['mp4','mov','mkv','webm']}]});
    if(result.canceled||!result.filePaths[0])return null;
    const file=`media/backgrounds/${require('node:crypto').randomUUID()}.mp4`,target=path.join(directory,file);fs.mkdirSync(path.dirname(target),{recursive:true});
    const info=await media.finalizeCamera(result.filePaths[0],target);
    const index=`${file}.index.json`;fs.writeFileSync(path.join(directory,index),JSON.stringify(await media.buildVideoIndex(target)));
    return{kind:'video',file,index,width:info.video.width,height:info.video.height,duration:info.duration};
  });

  ipcMain.handle('export:mux', async (event, job) => {
    const args = media.buildMuxArguments(job);
    return exportJobs.run(event.sender, job.jobId, async ({onSpawn}) => {
      await media.ffmpeg(args, {
        onSpawn,
        onStderr: (text) => {
          const match = /time=(\d+):(\d+):(\d+\.\d+)/.exec(text);
          if (match && !event.sender.isDestroyed()) event.sender.send('export:mux-progress', (Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])) / Math.max(job.outputDuration, 0.001));
        },
      });
      return job.outputFile;
    });
  });
  ipcMain.on('export:cancel', (event, id) => exportJobs.cancel(event.sender.id, id));
  ipcMain.on('shell:open', (event, target) => shell.openPath(target));
}

// 同一时间只运行一个实例：再次启动时把录制条叫到前台。
if (!SELF_TEST && !SMOKE_TEST && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showRecorder());
  app.whenReady().then(async () => {
    media.resolveBinaries(app.isPackaged ? process.resourcesPath : null);
    // 摄像头、麦克风与系统声音回环都由本应用自己的窗口请求。
    session.defaultSession.setPermissionRequestHandler((contents, permission, callback) => callback(true));
    session.defaultSession.setPermissionCheckHandler(() => true);
    session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
      const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } });
      callback({ video: sources[0], audio: 'loopback' });
    });
    registerIpc();
    powerMonitor.on('suspend',()=>{if(recording&&recorderWindow&&!recorderWindow.isDestroyed())recorderWindow.webContents.send('recorder:interrupted','系统即将睡眠，正在保存已录内容');});
    if (SELF_TEST) {
      require('./selftest').run({ media, projectsRoot, createWindow, openEditor, showRecorder, showLibrary, toggleMemo, setEnvironment: (value) => { environment = value; } });
      return;
    }
    showRecorder();
    environment = await media.checkAvailable();
    if (environment.ok) {
      try {
        environment.encoder = (await media.detectEncoder()).label;
      } catch (error) {
        environment = { ok: false, reason: error.message };
      }
    }
    if (recorderWindow) recorderWindow.webContents.send('app:environment', { ...environment, projectsRoot: projectsRoot(), version: app.getVersion() });
    if(SMOKE_TEST){
      try{await require('./startup-smoke').run({app,window:recorderWindow,environment,media,output:process.env.DOGSC_PROBE_OUTPUT});app.exit(0);}
      catch(error){fs.writeFileSync(path.join(process.env.DOGSC_PROBE_OUTPUT,'startup-report.json'),JSON.stringify({error:error.stack},null,2));app.exit(1);}
    }
  });
  app.on('window-all-closed', () => { if (!SELF_TEST) app.quit(); });
  app.on('will-quit', () => globalShortcut.unregisterAll());
}

module.exports = { resourcesDirectory };
