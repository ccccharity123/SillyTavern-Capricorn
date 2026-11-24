export function mountMobile({root,island,nav,onResume}){
 const W=window,D=document;let start=null,moved=false,suppress=false,raf=0;
 const key='capricorn_island_position';
 function clamp(x,y){const r=island.getBoundingClientRect();return {x:Math.max(8,Math.min(Math.max(8,W.innerWidth-r.width-8),x)),y:Math.max(8,Math.min(Math.max(8,W.innerHeight-r.height-8),y))}}
 function place(x,y){const p=clamp(x,y);root.style.left=p.x+'px';root.style.top=p.y+'px';root.style.right='auto';return p}
 function fit(){if(!nav.hidden)return;const r=island.getBoundingClientRect();if(root.style.left)place(r.left,r.top)}
 try{const p=JSON.parse(localStorage.getItem(key));if(Number.isFinite(p?.x)&&Number.isFinite(p?.y))place(p.x,p.y)}catch{}
 function down(e){if(!nav.hidden||e.button!==0)return;const r=island.getBoundingClientRect();start={id:e.pointerId,x:e.clientX,y:e.clientY,left:r.left,top:r.top};moved=false;suppress=false;try{island.setPointerCapture(e.pointerId)}catch{}}
 function move(e){if(!start||e.pointerId!==start.id)return;const dx=e.clientX-start.x,dy=e.clientY-start.y;if(!moved&&Math.hypot(dx,dy)<8)return;moved=true;place(start.left+dx,start.top+dy)}
 function end(e){if(!start||e.pointerId!==start.id)return;if(moved){suppress=true;const r=island.getBoundingClientRect();try{localStorage.setItem(key,JSON.stringify({x:r.left,y:r.top}))}catch{}}start=null}
 function resize(){cancelAnimationFrame(raf);raf=requestAnimationFrame(fit)}
 function visible(){if(!D.hidden){resize();onResume()}}
 island.addEventListener('pointerdown',down);island.addEventListener('pointermove',move);island.addEventListener('pointerup',end);island.addEventListener('pointercancel',end);W.addEventListener('resize',resize);W.visualViewport?.addEventListener('resize',resize);D.addEventListener('visibilitychange',visible);
 return {fit(){resize();setTimeout(fit,350)},consumeDrag(){const v=suppress;suppress=false;return v},destroy(){cancelAnimationFrame(raf);island.removeEventListener('pointerdown',down);island.removeEventListener('pointermove',move);island.removeEventListener('pointerup',end);island.removeEventListener('pointercancel',end);W.removeEventListener('resize',resize);W.visualViewport?.removeEventListener('resize',resize);D.removeEventListener('visibilitychange',visible)}}
}
