'use strict';
const {StringDecoder}=require('node:string_decoder');
class PacketIndexParser {
  constructor(){this.decoder=new StringDecoder('utf8');this.pending='';this.packets=[];}
  line(line){
    if(!line.trim())return;
    const fields=Object.fromEntries(line.trim().split(',').map(pair=>pair.split('=')));
    const pts=Number(fields.pts_time),dts=Number(fields.dts_time),pos=Number(fields.pos),size=Number(fields.size);
    if(!Number.isFinite(pts)||!Number.isSafeInteger(pos)||pos<0||!Number.isSafeInteger(size)||size<=0)return;
    this.packets.push([pos,size,pts,Number.isFinite(dts)?dts:pts,(fields.flags||'').includes('K')?1:0]);
  }
  feed(chunk){
    const text=this.pending+this.decoder.write(Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk));let from=0,end;
    while((end=text.indexOf('\n',from))!==-1){this.line(text.slice(from,end));from=end+1;}
    this.pending=text.slice(from);
    if(this.pending.length>65536)throw new Error('视频索引行过长，无法安全解析。');
  }
  finish(){this.line(this.pending+this.decoder.end());this.pending='';this.packets.sort((a,b)=>a[3]-b[3]||a[0]-b[0]);return this.packets;}
}
module.exports={PacketIndexParser};
