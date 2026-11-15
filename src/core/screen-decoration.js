'use strict';
const FRAME_STYLES={none:'无',windowLight:'浅色窗口',windowDark:'深色窗口',browserLight:'浅色浏览器',browserDark:'深色浏览器',devicePhone:'手机',deviceTablet:'平板',devicePhonePortrait:'竖向手机',devicePhoneLandscape:'横向手机',deviceTabletPortrait:'竖向平板',deviceTabletLandscape:'横向平板'};
function decorationInsets(canvas,scale=1){
  const style=canvas.screenFrame||'none',factor=scale*(canvas.screenFrameScale??1);
  if(style==='none')return{top:0,right:0,bottom:0,left:0};
  const device=style.startsWith('device'),pad=(device?14:6)*factor;
  return{top:pad+(device?8:32*(canvas.screenFrameToolbarScale??1))*factor,right:pad,bottom:pad,left:pad};
}
function decorationGeometry(screen){
  const r=screen.finalRect,b=screen.borderWidth||0,d=screen.decoration,active=d&&d.style!=='none';
  const left=Math.max(b,active?d.left:0),right=Math.max(b,active?d.right:0),top=Math.max(b,active?d.top:0),bottom=Math.max(b,active?d.bottom:0);
  return {rect:{x:r.x-left,y:r.y-top,width:r.width+left+right,height:r.height+top+bottom},radius:active&&Number.isFinite(d.outerCornerRadius)?d.outerCornerRadius:screen.cornerRadius+Math.max(b,active?Math.max(d.left,d.bottom):0)};
}
module.exports={FRAME_STYLES,decorationInsets,decorationGeometry};
