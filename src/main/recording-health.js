'use strict';

class RecordingHealth {
  constructor({screen,selection,windowExists,onInterrupted,interval=500}) {
    this.screen=screen;this.selection=selection;this.windowExists=windowExists;this.onInterrupted=onInterrupted;this.fired=false;
    this.removed=(event,display)=>{if(selection.kind!=='window'&&display.id===selection.displayId)this.interrupt('录制显示器已断开，正在保存已录内容');};
    this.changed=(event,display,metrics)=>{if(selection.kind!=='window'&&display.id===selection.displayId&&metrics.some(k=>['bounds','scaleFactor','rotation'].includes(k)))this.interrupt('显示器分辨率、缩放或方向发生变化，正在保存已录内容');};
    screen.on('display-removed',this.removed);screen.on('display-metrics-changed',this.changed);
    if(selection.kind==='window')this.timer=setInterval(()=>this.check(),interval);
  }
  check(){if(!this.windowExists(this.selection.hwnd))this.interrupt('录制窗口已关闭，正在保存已录内容');}
  interrupt(reason){if(this.fired)return;this.fired=true;this.onInterrupted(reason);}
  dispose(){clearInterval(this.timer);this.screen.removeListener('display-removed',this.removed);this.screen.removeListener('display-metrics-changed',this.changed);}
}
module.exports={RecordingHealth};
