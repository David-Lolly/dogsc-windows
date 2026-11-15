'use strict';
const TABS={zoom:'motion',screenMotion:'screenMotion',cameraMotion:'cameraMotion',sticker:'sticker',mosaic:'mosaic'};
const selectionTab=selection=>TABS[selection?.type]||null;
const isTextEditing=target=>Boolean(target?.isContentEditable||target?.closest?.('[contenteditable="true"], [contenteditable=""]')||(['INPUT','TEXTAREA','SELECT'].includes(target?.tagName)&&target.type!=='range'));
const compactNumber=value=>Number.isFinite(value)?String(Number(value.toFixed(4))):'—';
module.exports={selectionTab,isTextEditing,compactNumber};
