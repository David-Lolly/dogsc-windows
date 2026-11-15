'use strict';
const {validatePayload}=require('../core/effect-clipboard');
const PREFIX='DogSC-Effects/1\n';
// Use the supported text API. Electron 44's clipboard does not expose the
// legacy readBuffer/writeBuffer methods. Await both sync and async runtimes.
class EffectClipboard {
  constructor(clipboard){this.clipboard=clipboard;}
  async copy(payload){
    validatePayload(payload);
    await this.clipboard.writeText(`DogSC-Effects/${payload.version}\n`+JSON.stringify(payload));
  }
  async paste(){
    const text=await this.clipboard.readText();
    if(typeof text!=='string'||!/^DogSC-Effects\/[12]\n/.test(text)||text.length>1024*1024)throw new Error('剪贴板中没有可粘贴的 DogSC 效果。');
    let payload;
    try{payload=JSON.parse(text.slice(PREFIX.length));}catch{throw new Error('剪贴板中的 DogSC 效果数据已损坏。');}
    return validatePayload(payload);
  }
}
module.exports={EffectClipboard,PREFIX};
