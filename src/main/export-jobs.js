'use strict';

// Every editor owns its mux process. Cancelling or closing one editor must not
// kill another editor's export, including when an old cancel arrives late.
class ExportJobs {
  constructor() { this.jobs = new Map(); }

  async run(owner, id, task) {
    if (!id || typeof id !== 'string') throw new Error('导出任务编号无效。');
    if (this.jobs.has(owner.id)) throw new Error('这个编辑器已有导出任务，请先等待完成或取消。');
    const job = { id, child: null, cancelled: false };
    const cancel = () => this.cancel(owner.id, id);
    this.jobs.set(owner.id, job);
    owner.once('destroyed', cancel);
    try {
      const result = await task({
        onSpawn: child => { job.child = child; if (job.cancelled) this.stop(job); },
        isCancelled: () => job.cancelled,
      });
      if (job.cancelled) throw Object.assign(new Error('已取消导出'), { cancelled: true });
      return result;
    } finally {
      owner.removeListener('destroyed', cancel);
      if (this.jobs.get(owner.id) === job) this.jobs.delete(owner.id);
    }
  }

  cancel(ownerId, id) {
    const job = this.jobs.get(ownerId);
    if (!job || job.id !== id) return false;
    job.cancelled = true;
    this.stop(job);
    return true;
  }

  stop(job) {
    if(!job.child||job.stopping)return;
    job.stopping=true;
    // PATH may point to a package-manager shim. Killing only the shim leaves
    // its FFmpeg child running and keeps pipes/output handles open on Windows.
    if(process.platform==='win32'&&job.child.pid){
      const killer=require('node:child_process').spawn('taskkill.exe',['/PID',String(job.child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});
      killer.on('error',()=>job.child.kill());
      killer.on('close',code=>{if(code!==0)job.child.kill();});
    }else job.child.kill();
  }
}

module.exports = { ExportJobs };
