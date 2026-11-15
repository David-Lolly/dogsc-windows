'use strict';
const {defaultCanvas,defaultCamera,defaultCursorStyle,defaultMotion}=require('./model');
function builtinPresets(){
  const designs=[
    ['clean','简洁浅色',{kind:'color',color:'#EDEFF2'},'none',72],
    ['dark','深色演示',{kind:'color',color:'#141820'},'windowDark',80],
    ['browser','浏览器演示',{kind:'pattern',preset:'obsidianGrid'},'browserDark',96],
    ['grid','科技网格',{kind:'dynamic',preset:'cyberDriftGrid'},'windowDark',110],
    ['aurora','流光背景',{kind:'dynamic',preset:'auroraFluid'},'none',96],
    ['portrait','竖屏讲解',{kind:'color',color:'#192735'},'none',60],
  ];
  return designs.map(([id,name,background,screenFrame,padding])=>{
    const canvas={...defaultCanvas(),background,screenFrame,padding};
    const camera={...defaultCamera(),position:{x:0.96,y:0.96},size:0.23};
    if(id==='portrait'){canvas.aspectRatio='portrait';camera.position={x:0.96,y:0.98};camera.size=0.34;}
    return{id:`builtin:${id}`,name,builtin:true,style:{canvas,camera,cursorStyle:defaultCursorStyle(),motion:defaultMotion()}};
  });
}
module.exports={builtinPresets};
