'use strict';
class CaptureClock {
  constructor({wall=()=>Date.now()/1000,monotonic=()=>performance.now()/1000}={}){this.wall=wall;this.monotonic=monotonic;this.firstWall=null;this.firstMonotonic=null;this.stoppedMonotonic=null;}
  start(timestamp){
    if(this.firstWall!==null)return;
    this.firstWall=timestamp;
    // The timestamp is produced at the first frame, then received through a
    // pipe. Estimate that small delivery delay once; never use wall time again.
    this.firstMonotonic=this.monotonic()-Math.min(10,Math.max(0,this.wall()-timestamp));
  }
  stop(){if(this.stoppedMonotonic===null)this.stoppedMonotonic=this.monotonic();}
  get elapsed(){return this.firstMonotonic===null?0:Math.max(0,(this.stoppedMonotonic??this.monotonic())-this.firstMonotonic);}
  get endWall(){return this.firstWall===null?this.wall():this.firstWall+this.elapsed;}
}
module.exports={CaptureClock};
