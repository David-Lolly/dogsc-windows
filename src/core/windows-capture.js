'use strict';
function captureFilter(source,fps){
  if(source.backend==='wgc'||source.kind==='window'){
    const window=source.kind==='window',handle=BigInt(window?source.hwnd:source.hmonitor);
    if(handle<=0n)throw new Error('Windows 采集句柄无效。');
    let filter=`gfxcapture=${window?'hwnd':'hmonitor'}=${handle}:capture_cursor=0:capture_border=1:display_border=0:max_framerate=${fps}`;
    if(source.kind==='area'){
      const r=source.rect;
      filter+=`:crop_left=${r.x}:crop_top=${r.y}:crop_right=${source.monitorWidth-r.x-r.width}:crop_bottom=${source.monitorHeight-r.y-r.height}`;
    }
    return filter+`:width=${source.width}:height=${source.height}:resize_mode=scale_aspect`;
  }
  let filter=`ddagrab=output_idx=${source.outputIndex}:draw_mouse=0:framerate=${fps}`;
  if(source.kind==='area')filter+=`:video_size=${source.rect.width}x${source.rect.height}:offset_x=${source.rect.x}:offset_y=${source.rect.y}`;
  return filter;
}
module.exports={captureFilter};
