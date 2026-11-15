'use strict';
// Port of ScreenProjection.project at Mac baseline 567fd6e.
function projectScreen(rect, { rotationX = 0, rotationY = 0, rotationZ = 0, perspective = 0.65 } = {}, anchor, surface = rect) {
  const pivot = anchor && Number.isFinite(anchor.x) && Number.isFinite(anchor.y)
    ? anchor : { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  const depth = Math.min(Math.max(perspective, 0), 2);
  const distance = depth > 0 ? Math.max(rect.width, rect.height, 1) * 2 / Math.max(depth, 0.0001) : Infinity;
  const [rx, ry, rz] = [rotationX, rotationY, rotationZ].map((d) => d * Math.PI / 180);
  return [[surface.x, surface.y], [surface.x + Math.max(surface.width, 0), surface.y],
    [surface.x + Math.max(surface.width, 0), surface.y + Math.max(surface.height, 0)], [surface.x, surface.y + Math.max(surface.height, 0)]].map(([px, py]) => {
    const x = px - pivot.x, y = py - pivot.y;
    const yx = y * Math.cos(rx), zx = y * Math.sin(rx);
    const xy = x * Math.cos(ry) + zx * Math.sin(ry);
    const zy = -x * Math.sin(ry) + zx * Math.cos(ry);
    const xz = xy * Math.cos(rz) - yx * Math.sin(rz);
    const yz = xy * Math.sin(rz) + yx * Math.cos(rz);
    const w = Number.isFinite(distance) ? Math.max(distance - zy, distance * 0.12) / distance : 1;
    return { x: pivot.x + xz / w, y: pivot.y + yz / w, w };
  });
}

function mapPlanePoint(quad,rect,point,inverse=false){
  const [p,q,,r]=quad;
  const a=q.x*q.w-p.x*p.w,b=r.x*r.w-p.x*p.w,c=p.x*p.w,d=q.y*q.w-p.y*p.w,e=r.y*r.w-p.y*p.w,f=p.y*p.w,g=q.w-p.w,h=r.w-p.w,i=p.w;
  if(!inverse){const x=(point.x-rect.x)/rect.width,y=(point.y-rect.y)/rect.height,w=g*x+h*y+i;if(Math.abs(w)<1e-9)return null;return{x:(a*x+b*y+c)/w,y:(d*x+e*y+f)/w};}
  const A=e*i-f*h,B=c*h-b*i,C=b*f-c*e,D=f*g-d*i,E=a*i-c*g,F=c*d-a*f,G=d*h-e*g,H=b*g-a*h,I=a*e-b*d;
  const determinant=a*A+b*D+c*G;if(Math.abs(determinant)<1e-9)return null;
  const w=G*point.x+H*point.y+I;if(Math.abs(w)<1e-9)return null;
  return{x:rect.x+(A*point.x+B*point.y+C)/w*rect.width,y:rect.y+(D*point.x+E*point.y+F)/w*rect.height};
}
module.exports = { projectScreen,mapPlanePoint };
