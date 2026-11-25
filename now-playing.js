import {viewport,playerRect} from './viewport.js';
import { icon } from './icons.js';
import { createLatestTask } from './music-tasks.js';
export function parseLrc(text) {
  const out = [];
  const offset = Number(String(text).match(/\[offset:([+-]?\d+)\]/i)?.[1] || 0) / 1000;
  for (const line of String(text || '').split(/\r?\n/)) {
    const tags = [...line.matchAll(/\[(\d+):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
    const words = line.replace(/\[[^\]]*\]/g, '').trim();
    if (!words) continue;
    for (const t of tags) {
      out.push({
        time: Math.max(0, +t[1] * 60 + +t[2] + Number('0.' + (t[3] || '0')) + offset),
        text: words
      });
    }
  }
  return out.sort((a, b) => a.time - b.time);
}

const ICONS = Object.fromEntries(["prev","next","play","pause","stop","lyrics","queue"].map(k=>[k,icon(k,k==="play"||k==="pause"?32:24)]));

export function mountNowPlaying({ D, W, audio, shared, state, toggle, next, play, move, remove, volume, mode, quality }) {
  const panel = D.createElement('section');
  panel.className = 'cap-full-player';
  const android = /Android/i.test(W.navigator.userAgent);
  if(android) panel.dataset.androidViewport='true';
  const mobile=android||W.matchMedia?.('(pointer: coarse)')?.matches;
  if(mobile)panel.dataset.androidViewport='true';
  const motion=W.matchMedia?.('(prefers-reduced-motion: reduce)');
  const light=()=>!!(motion?.matches||(W.navigator.deviceMemory>0&&W.navigator.deviceMemory<=4));
  let viewportFrame=0;
  function fitViewport(){if(panel.hidden)return;panel.dataset.light=String(light());if(!mobile)return;const r=playerRect(viewport(W),panel.dataset.size);for(const [k,v] of Object.entries(r))panel.style.setProperty('--cap-rect-'+k,v+'px');}
  function scheduleViewport(){W.cancelAnimationFrame(viewportFrame);viewportFrame=W.requestAnimationFrame(fitViewport);}
  W.addEventListener('resize',scheduleViewport);W.visualViewport?.addEventListener('resize',scheduleViewport);W.visualViewport?.addEventListener('scroll',scheduleViewport);motion?.addEventListener?.('change',scheduleViewport);
  function visibility(){if(!D.hidden){scheduleViewport();refresh();}}
  D.addEventListener('visibilitychange',visibility);
  panel.hidden = true;
  panel.setAttribute('aria-label', '声屿全屏播放器');
  panel.innerHTML = `
    <div class="cap-ambient" aria-hidden="true"><img alt="" hidden></div>
    <div class="cap-fp-shell">
      <div class="cap-grabber" data-close title="收起播放器" aria-hidden="true"></div>
      <header>
        <button data-close class="cap-fp-pill" aria-label="收起播放器">${icon("down")}</button>
        <span data-heading class="cap-fp-heading">声屿</span>
        <div class="cap-fp-tools"><button data-size-switch aria-label="切换尺寸">${icon("size")}</button><button data-settings aria-label="设置">${icon("settings")}</button></div>
      </header>
      <div class="cap-hero">
        <div class="cap-art" title="点击切换播放视图">
          <img alt="专辑封面" hidden>
          <span>${icon("music",32)}</span>
        </div>
        <div class="cap-meta">
          <div class="cap-meta-text">
            <h2></h2>
            <p data-artist></p>
          </div>
          <button type="button" class="cap-badge cap-quality" data-quality aria-label="切换音质" aria-expanded="false"></button>
        </div>
      </div>
      <p data-status role="status" class="cap-fp-status"></p><p data-current-lyric class="cap-current-lyric"></p>
      <div class="cap-scrubber">
        <input data-seek type="range" min="0" max="0" step="0.1" aria-label="播放进度">
        <div class="cap-clock-row">
          <span data-elapsed>0:00</span>
          <span data-duration>0:00</span>
        </div>
      </div>
      <div class="cap-transport">
        <button data-prev aria-label="上一首">${ICONS.prev}</button>
        <button data-toggle class="cap-play-btn" aria-label="播放或暂停">${ICONS.play}</button>
        <button data-next aria-label="下一首">${ICONS.next}</button>
      </div>
      <div class="cap-volume"><span aria-hidden="true">${icon("volumeLow",16)}</span><input data-volume type="range" min="0" max="1" step="0.01" aria-label="音量"><span aria-hidden="true">${icon("volumeHigh",19)}</span></div><small data-volume-note class="cap-volume-note"></small><small class="cap-color-note">封面跨域限制，已使用模糊封面代替取色</small>
      <div data-detail class="cap-fp-detail" hidden></div>
      <nav class="cap-fp-tabs">
        <button data-mode aria-label="播放模式">${icon("repeat")}</button><button data-lyrics aria-label="歌词" aria-selected="false">${ICONS.lyrics}</button>
        <button data-queue aria-label="播放队列" aria-selected="false">${ICONS.queue}</button>
      <button data-library aria-label="曲库">${icon("library")}</button></nav>
    </div>
  `;
  D.body.append(panel);

  const q = x => panel.querySelector(x);
  const detail = q('[data-detail]');
  const qualityLabels={standard:'标准',higher:'高清',exhigh:'极高',lossless:'无损',hires:'Hi-Res',jyeffect:'高清环绕',sky:'沉浸环绕',jymaster:'超清母带'};
  const qualityButton=q('[data-quality]');
  const qualityMenu=D.createElement('div');qualityMenu.className='cap-quality-menu';qualityMenu.hidden=true;qualityButton.after(qualityMenu);
  function closeQuality(){qualityMenu.hidden=true;qualityButton.setAttribute('aria-expanded','false')}
  qualityButton.onclick=()=>{if(!qualityMenu.hidden){closeQuality();return}qualityMenu.replaceChildren();for(const [level,label] of Object.entries(qualityLabels)){const b=D.createElement('button');b.type='button';b.textContent=label+(state().preferredQuality===level?'  ✓':'');b.onclick=()=>{closeQuality();quality?.(level)};qualityMenu.append(b)}qualityMenu.hidden=false;qualityButton.setAttribute('aria-expanded','true')};
  panel.addEventListener('click',e=>{if(!qualityMenu.contains(e.target)&&!qualityButton.contains(e.target))closeQuality()});
  panel.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (!qualityMenu.hidden) closeQuality();
      else closePanel();
    } else if (e.key === ' ' && !/INPUT|TEXTAREA|SELECT|BUTTON/.test(e.target?.tagName)) {
      e.preventDefault();
      toggle?.();
    }
  });
  const sizes = ['compact','half','large'];
  let size = 'half'; try { const saved = W.localStorage.getItem('capricorn_player_size'); if(sizes.includes(saved)) size=saved; } catch {}
  panel.dataset.size=size;
  const reduce=light;

  function animateFrom(rect, target=panel){if(!rect||reduce()||!target.animate||mobile)return;const r=target.getBoundingClientRect();if(!r.width||!r.height)return;target.animate([{transformOrigin:'top left',transform:`translate(${rect.left-r.left}px,${rect.top-r.top}px) scale(${rect.width/r.width},${rect.height/r.height})`,opacity:.65},{transformOrigin:'top left',transform:'none',opacity:1}],{duration:340,easing:'cubic-bezier(.22,1,.36,1)'});}
  function setSize(){const before=q('.cap-art').getBoundingClientRect();size=sizes[(sizes.indexOf(size)+1)%sizes.length];panel.dataset.size=size;fitViewport();showTab(size==='large'?'lyrics':'');try{W.localStorage.setItem('capricorn_player_size',size)}catch{};animateFrom(before,q('.cap-art'));q('[data-size-switch]').title='当前：'+({compact:'悬浮卡片',half:'半屏',large:'大半屏'}[size]);}
  function closePanel(){closeQuality();if(panel.hidden)return;panel.hidden=true;shared.onPlayerClose?.();}
  function openAux(t){closePanel();shared.openPlayerAux?.(t);}
  function setTab(t){showTab(tab===t?'':t);} function showTab(t){tab=t;detail.hidden=!tab;panel.dataset.detail=tab;updateTabState();if(tab==='lyrics'){void loadLyrics(true);drawLyrics();}if(tab==='queue'){queueSignature='';queuePage=Math.max(0,Math.floor(state().queueIndex/queuePageSize));drawQueue();}}
  q('[data-size-switch]').onclick=setSize;
  q('.cap-art').onclick=()=>{
    if(size!=='large'){
      const before=q('.cap-art').getBoundingClientRect();
      size='large';panel.dataset.size=size;fitViewport();showTab('lyrics');
      try{W.localStorage.setItem('capricorn_player_size',size)}catch{}
      animateFrom(before,q('.cap-art'));
    }
  };
  q('[data-settings]').onclick=()=>openAux('settings');
  q('[data-library]').onclick=()=>openAux('library');
  q('[data-mode]').onclick=()=>{mode?.();refresh();};
  const volumeSlider=q('[data-volume]');let volumeDragging=false;
  volumeSlider.onpointerdown=()=>{volumeDragging=true};
  const paintVol=v=>volumeSlider.style.setProperty('--cap-vol-progress',Math.round(Math.max(0,Math.min(1,Number(v)||0))*100)+'%');
  volumeSlider.oninput=e=>{paintVol(e.target.value);volume?.(Number(e.target.value));};
  volumeSlider.onchange=e=>{paintVol(e.target.value);volume?.(Number(e.target.value));volumeDragging=false};
  volumeSlider.onpointerup=volumeSlider.onpointercancel=volumeSlider.onblur=()=>{volumeDragging=false};

  const img = q('.cap-art img');
  const ambient = q('.cap-ambient');
  const seek = q('[data-seek]');
  const lyricTasks = createLatestTask();
  const lyricCache = new Map();
  const retirements = new Set();
  const queuePageSize = 60;
  let tab = '', identity = '', lyricIdentity = '', lyricStatus = '';
  let lines = [], active = -1, dead = false, dragging = false;
  let queuePage = 0, queueSignature = '';
  let lastIslandSig = '', manualScrollUntil = 0;
  let bgEpoch = 0, bgURL = null, bgActive = null, bgPending = null, bgFrame = 0, colorProbe = null;
  panel.dataset.coverState = 'missing';
  ambient.replaceChildren();
  detail.addEventListener('touchstart',()=>{manualScrollUntil=Date.now()+5000},{passive:true});
  detail.addEventListener('wheel',()=>{manualScrollUntil=Date.now()+5000},{passive:true});

  function cancelAmbientLoad(){
    W.cancelAnimationFrame(bgFrame);
    if(!bgPending)return;
    bgPending.onload=bgPending.onerror=null;
    bgPending.removeAttribute('src');
    bgPending=null;
  }
  function retire(layer){
    if(!layer)return;
    layer.style.opacity='0';
    const timer=setTimeout(()=>{retirements.delete(timer);if(layer!==bgActive)layer.remove()},1300);
    retirements.add(timer);
  }
  function setAmbient(url){
    if(url===bgURL)return;
    bgURL=url;
    const epoch=++bgEpoch;
    cancelAmbientLoad();
    panel.dataset.coverState='missing';
    const old=bgActive;
    bgActive=null;
    retire(old);
    if(!url)return;
    panel.dataset.coverState='loading';
    const layer=D.createElement('div'),art=D.createElement('img');
    bgPending=art;
    layer.className='cap-ambient-layer';
    layer.style.opacity='0';
    art.alt='';
    layer.append(art);
    art.onload=()=>{
      if(dead||epoch!==bgEpoch)return;
      bgPending=null;
      panel.dataset.coverState='ready';
      ambient.append(layer);
      bgActive=layer;
      bgFrame=W.requestAnimationFrame(()=>{bgFrame=W.requestAnimationFrame(()=>{
        if(!dead&&bgActive===layer)layer.style.opacity='1';
      })});
    };
    art.onerror=()=>{
      if(dead||epoch!==bgEpoch)return;
      bgPending=null;
      panel.dataset.coverState='missing';
      panel.dataset.colorStatus='missing';
      panel.style.removeProperty('--cap-art-color');
    };
    art.src=url;
  }
  function cancelColorProbe(){
    if(!colorProbe)return;
    colorProbe.onload=colorProbe.onerror=null;
    colorProbe.removeAttribute('src');
    colorProbe=null;
  }
  img.onerror=()=>{
    img.hidden=true;
    img.alt='封面加载失败';
    panel.dataset.colorStatus='missing';
    panel.style.removeProperty('--cap-art-color');
  };
  img.onload=()=>{
    img.classList.add('is-loaded');
    cancelColorProbe();
    const url=img.src;
    const probe=new W.Image();
    colorProbe=probe;
    probe.crossOrigin='anonymous';
    panel.dataset.colorStatus='loading';
    probe.onload=()=>{
      if(dead||img.src!==url)return;
      colorProbe=null;
      try{
        const canvas=D.createElement('canvas');
        canvas.width=canvas.height=24;
        const context=canvas.getContext('2d');
        context.drawImage(probe,0,0,24,24);
        const pixels=context.getImageData(0,0,24,24).data;
        let red=0,green=0,blue=0,total=0;
        for(let i=0;i<pixels.length;i+=4){
          if(pixels[i+3]<128)continue;
          const weight=1+(Math.max(pixels[i],pixels[i+1],pixels[i+2])-Math.min(pixels[i],pixels[i+1],pixels[i+2]))/80;
          red+=pixels[i]*weight;green+=pixels[i+1]*weight;blue+=pixels[i+2]*weight;total+=weight;
        }
        if(!total)throw Error('empty');
        panel.style.setProperty('--cap-art-color',`rgb(${Math.round(red/total)},${Math.round(green/total)},${Math.round(blue/total)})`);
        panel.dataset.colorStatus='ready';
      }catch{panel.dataset.colorStatus='fallback'}
    };
    probe.onerror=()=>{
      if(dead||img.src!==url)return;
      colorProbe=null;
      panel.dataset.colorStatus='fallback';
    };
    probe.src=url;
  };
  const clock = n => Number.isFinite(n) ? `${Math.floor(n / 60)}:${String(Math.floor(n % 60)).padStart(2, '0')}` : '0:00';
  function button(label, fn) {
    const b = D.createElement('button');
    const controls = {'↑':['up','上移'],'↓':['arrowdown','下移'],'×':['close','移除']};
    if (Object.hasOwn(controls,label)) {
      b.innerHTML=icon(controls[label][0],18);
      b.setAttribute('aria-label',controls[label][1]);
    } else b.textContent = label;
    b.onclick = fn;
    return b;
  }
  function currentLyricIndex(time) {
    let lo=0,hi=lines.length;
    while(lo<hi){const mid=(lo+hi)>>>1;if(lines[mid].time<=time)lo=mid+1;else hi=mid;}
    return lo-1;
  }
  function emitIsland() {
    if (dead || typeof shared.onIslandUpdate !== 'function') return;
    const track = state().playing;
    const isPlaying = !audio.paused && !audio.ended && !!track;
    const index = isPlaying && lines.length ? currentLyricIndex(audio.currentTime || 0) : -1;
    const lyric = lines[index]?.text || '';
    const translation = lines[index]?.translation || '';
    const fallback = track ? (track.artist ? `${track.title} · ${track.artist}` : track.title) : '声屿';
    const text = lyric || fallback;
    const signature = JSON.stringify([isPlaying,text,translation,track?.coverUrl]);
    if (signature === lastIslandSig) return;
    lastIslandSig = signature;
    shared.onIslandUpdate({playing:isPlaying,lyric,translation,title:track?.title||'声屿',artist:track?.artist||'',text,coverUrl:track?.coverUrl||''});
  }
  function updateTabState() {
    q('[data-lyrics]').setAttribute('aria-selected', String(tab === 'lyrics'));
    q('[data-queue]').setAttribute('aria-selected', String(tab === 'queue'));
  }
  function drawQueue(){
    const {queue,queueRevision,queueIndex,resolving}=state();
    const pages=Math.max(1,Math.ceil(queue.length/queuePageSize));
    queuePage=Math.min(pages-1,Math.max(0,queuePage));
    const signature=JSON.stringify([queueRevision,queueIndex,queuePage,resolving]);
    if(signature===queueSignature)return;
    queueSignature=signature;
    detail.replaceChildren();
    if(!queue.length){detail.textContent='播放队列为空';return;}
    const start=queuePage*queuePageSize,end=Math.min(start+queuePageSize,queue.length);
    const fragment=D.createDocumentFragment();
    for(let i=start;i<end;i++){
      const track=queue[i];
      const row=D.createElement('div');
      row.className='cap-queue-row'+(i===queueIndex?' is-current':'');
      const name=button((i===queueIndex?'♫ ':'')+track.title+' — '+track.artist,()=>play(i));
      const up=button('↑',()=>move(i,i-1)),down=button('↓',()=>move(i,i+1)),del=button('×',()=>remove(i));
      up.disabled=resolving||i===0;
      down.disabled=resolving||i===queue.length-1;
      del.disabled=resolving||i===queueIndex;
      row.append(name,up,down,del);
      fragment.append(row);
    }
    if(pages>1){
      const nav=D.createElement('div'),label=D.createElement('span');
      nav.className='cap-queue-row';
      const previous=button('上一页',()=>{queuePage--;drawQueue();detail.scrollTop=0});
      const next=button('下一页',()=>{queuePage++;drawQueue();detail.scrollTop=0});
      previous.disabled=queuePage===0;
      next.disabled=queuePage===pages-1;
      label.textContent=`${queuePage+1} / ${pages}`;
      nav.append(previous,label,next);
      fragment.append(nav);
    }
    detail.append(fragment);
  }
  function drawLyrics(){
    if(panel.hidden||tab!=='lyrics')return;
    detail.replaceChildren();
    active=-1;
    if(!lines.length){
      const empty=D.createElement('div');
      empty.className='cap-fp-empty';
      const labels={loading:'正在读取歌词…',missing:'未关联网易云或服务未连接',error:'歌词读取失败，可重新点击歌词重试'};
      empty.textContent=labels[lyricStatus]||'暂无同步歌词';
      detail.append(empty);
      return;
    }
    const fragment=D.createDocumentFragment();
    for(const line of lines){
      const row=button(line.text,()=>{if(Number.isFinite(audio.duration))audio.currentTime=Math.min(audio.duration,line.time)});
      row.className='cap-lyric';
      if(line.translation){
        const text=D.createElement('small');
        text.textContent=line.translation;
        row.append(text);
      }
      fragment.append(row);
    }
    detail.append(fragment);
    updateTime();
  }
  function lyricKey(track){return track?.neteaseId ? JSON.stringify([track.id,track.neteaseId]) : '';}
  async function loadLyrics(retry=false){
    const track=state().playing,key=lyricKey(track);
    if(key!==lyricIdentity){
      lyricIdentity=key;
      lyricTasks.cancel();
      lines=[];
      lyricStatus='';
      active=-1;
    }
    if(lyricStatus==='loading'||lyricStatus==='loaded'||(lyricStatus==='error'&&!retry))return;
    if(!key||!shared.online?.ready()){
      lyricStatus='missing';
      drawLyrics();
      return;
    }
    const task=lyricTasks.start();
    lyricStatus='loading';
    drawLyrics();
    try{
      let data=lyricCache.get(key);
      if(!data)data=await shared.online.get('/music/lyric?id='+encodeURIComponent(track.neteaseId),25000,task.signal);
      if(dead||!task.active()||key!==lyricKey(state().playing))return;
      lyricCache.set(key,data);
      if(lyricCache.size>64)lyricCache.delete(lyricCache.keys().next().value);
      const translations=parseLrc(data.translation);
      let start=0;
      lines=parseLrc(data.lyric).map(line=>{
        while(start<translations.length&&translations[start].time<=line.time-0.15)start++;
        const match=translations[start];
        const translation=match&&Math.abs(match.time-line.time)<0.15&&match.text!==line.text?match.text:'';
        return {...line,translation};
      });
      lyricStatus='loaded';
      drawLyrics();
      emitIsland();
    }catch{
      if(!dead&&task.active()){lyricStatus='error';drawLyrics();}
    }
  }
  function updateTime(){
    if(D.hidden)return;
    emitIsland();
    if(panel.hidden)return;
    const time=audio.currentTime||0,duration=Number.isFinite(audio.duration)?audio.duration:0;
    seek.max=duration;
    if(!dragging)seek.value=time;
    seek.style.setProperty('--cap-progress',(duration>0?Math.min(100,Math.max(0,time/duration*100)):0)+'%');
    q('[data-elapsed]').textContent=clock(time);
    q('[data-duration]').textContent=clock(audio.duration);
    const index = currentLyricIndex(time);
    const text = lines[index]?.text || '';
    const currentLine=q('[data-current-lyric]');
    if(currentLine.textContent!==text)currentLine.textContent=text;
    const {userVolume,volumeSupported}=state();
    if(!volumeDragging){const v=userVolume??audio.volume;volumeSlider.value=v;paintVol(v);}
    q('[data-volume-note]').textContent=volumeSupported===false?'当前音源仅支持系统音量键':'';
    volumeSlider.title=volumeSupported===false?'当前音源可能需要系统音量键':'音量';
    if(tab!=='lyrics'||!lines.length||index===active)return;
    detail.children[active]?.classList.remove('active');
    active=index;
    const line=detail.children[index];
    if(line){
      line.classList.add('active');
      if(Date.now()>=manualScrollUntil)detail.scrollTo({top:detail.scrollTop+line.getBoundingClientRect().top-detail.getBoundingClientRect().top-detail.clientHeight/2+line.offsetHeight/2,behavior:reduce()?'auto':'smooth'});
    }
  }
  function refresh(){
    if(dead)return;
    const {playing:track,actualQuality,resolving,started,statusText,canChangeQuality,playMode}=state();
    const key=lyricKey(track);
    if(key!==lyricIdentity){
      if(!audio.paused||!panel.hidden)void loadLyrics();
      else{lyricTasks.cancel();lines=[];lyricIdentity='';lyricStatus='';}
    }
    emitIsland();
    if(panel.hidden){setAmbient(track?.coverUrl||'');return;}
    q('[data-heading]').textContent=resolving?'正在加载':started&&!audio.paused?'正在播放':'声屿';
    q('[data-status]').textContent=statusText||'';
    q('h2').textContent=track?.title||'尚未播放';
    q('[data-artist]').textContent=track?.artist||'选择一首歌曲';
    qualityButton.textContent=(qualityLabels[actualQuality]||actualQuality||'音质')+' ⌄';
    qualityButton.disabled=resolving||!canChangeQuality;
    if(qualityButton.disabled)closeQuality();
    q('[data-toggle]').innerHTML=resolving?ICONS.stop:audio.paused?ICONS.play:ICONS.pause;
    panel.dataset.playing=String(!audio.paused);
    panel.dataset.resolving=String(!!resolving);
    const modeButton=q('[data-mode]');
    const modeIcon=playMode==='shuffle'?'shuffle':playMode==='one'?'one':'repeat';
    if(modeButton.dataset.icon!==modeIcon){
      modeButton.innerHTML=icon(modeIcon);
      modeButton.dataset.icon=modeIcon;
      modeButton.title=playMode==='shuffle'?'随机播放':playMode==='one'?'单曲循环':'顺序播放';
      modeButton.setAttribute('aria-label',modeButton.title+'，点击切换');
    }
    const id=JSON.stringify([track?.id,track?.neteaseId,track?.coverUrl]);
    if(id!==identity){
      identity=id;
      cancelColorProbe();
      img.classList.remove('is-loaded');
      img.hidden=true;
      img.removeAttribute('src');
      img.alt='专辑封面';
      let ambientUrl='';
      panel.dataset.colorStatus='missing';
      panel.style.removeProperty('--cap-art-color');
      try{
        const url=new URL(track?.coverUrl);
        if(url.protocol==='https:'||url.protocol==='http:'){img.src=url.href;img.hidden=false;ambientUrl=url.href;}
      }catch{}
      setAmbient(ambientUrl);
    }
    if(tab==='queue')drawQueue();
    updateTime();
  }
  function resetOnline(){
    lyricTasks.cancel();
    lyricCache.clear();
    lyricIdentity='';lyricStatus='';lines=[];active=-1;
    if(tab==='lyrics')void loadLyrics();
    refresh();
  }

  for (const el of panel.querySelectorAll('[data-close]')) {
    el.onclick = closePanel;
  }
  q('[data-toggle]').onclick = toggle;
  q('[data-prev]').onclick = () => next(-1);
  q('[data-next]').onclick = () => next(1);
  q('[data-lyrics]').onclick = () => { setTab('lyrics'); };
  q('[data-queue]').onclick = () => { showTab(tab==='queue'?(size==='large'?'lyrics':''):'queue'); };
  seek.oninput = () => {
    dragging = true;
    const dur = Number(seek.max) || 0;
    seek.style.setProperty('--cap-progress', (dur > 0 ? (Number(seek.value) / dur) * 100 : 0) + '%');
    q('[data-elapsed]').textContent = clock(Number(seek.value));
  };
  seek.onchange = () => {
    if (Number.isFinite(audio.duration)) audio.currentTime = Number(seek.value);
    dragging = false;
  };
  seek.onpointercancel = () => { dragging = false; };

  const events = ['timeupdate', 'durationchange', 'play', 'pause', 'ended', 'loadedmetadata', 'volumechange'];
  const onTime=()=>updateTime(); for (const ev of events) audio.addEventListener(ev, ev==='timeupdate'?onTime:refresh);
  emitIsland();
  return {
    open() { if(!panel.hidden)return;const r=D.querySelector('#capricorn-hub .cap-island')?.getBoundingClientRect();panel.hidden=false;fitViewport();identity='';queueSignature='';manualScrollUntil=0;showTab(size==='large'?'lyrics':'');refresh();animateFrom(r); }, close:closePanel, isOpen:()=>!panel.hidden,
    refresh,resetOnline,
    destroy(){
      dead=true;
      lyricTasks.cancel();
      cancelAmbientLoad();
      cancelColorProbe();
      for(const timer of retirements)clearTimeout(timer);
      W.cancelAnimationFrame(viewportFrame);
      W.removeEventListener('resize',scheduleViewport);
      W.visualViewport?.removeEventListener('resize',scheduleViewport);
      W.visualViewport?.removeEventListener('scroll',scheduleViewport);
      motion?.removeEventListener?.('change',scheduleViewport);
      D.removeEventListener('visibilitychange',visibility);
      for(const event of events)audio.removeEventListener(event,event==='timeupdate'?onTime:refresh);
      img.onload=img.onerror=null;
      img.removeAttribute('src');
      panel.remove();
    }
  };
}
