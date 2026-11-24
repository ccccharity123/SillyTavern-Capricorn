export function mountNetease(settings, shared){
 const box=document.createElement('section');box.className='cap-backup';box.innerHTML='<h4>声屿 · 共享服务</h4><label>HTTPS 服务地址<input type="url" placeholder="https://your-service.onrender.com"></label><label>邀请码 / 管理员密钥<input type="password" autocomplete="off"></label><button data-save>保存连接</button><button data-test>连接检测</button><button data-retry>取消检测</button><p role="status"></p>';settings.append(box);
 const [url,key]=box.querySelectorAll('input'), status=box.querySelector('p');let controller,retryTimer,disposed=false;try{url.value=localStorage.getItem('capricorn_music_endpoint')||'https://capricorn-music-gateway.bonto.page';key.value=localStorage.getItem('capricorn_music_token:'+url.value)||''}catch{}
 url.onchange=()=>{cancelCheck();stop();adminPanel.hidden=true;try{key.value=localStorage.getItem('capricorn_music_token:'+endpoint())||''}catch{key.value=''}};
 const forget=document.createElement('button');forget.textContent='清除本地凭证';box.append(forget);forget.onclick=()=>{cancelCheck();stop();note.textContent="";try{localStorage.removeItem('capricorn_music_token:'+endpoint());key.value='';adminPanel.hidden=true;status.textContent='本地凭证已清除'}catch(e){status.textContent=e.message}};
 function endpoint(){const u=new URL(url.value.trim());if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||u.pathname!=='/')throw Error('请输入 HTTPS 服务根地址');return u.origin}
 box.querySelector('[data-save]').onclick=()=>{try{localStorage.setItem('capricorn_music_endpoint',endpoint());localStorage.setItem('capricorn_music_token:'+endpoint(),key.value.trim());status.textContent='连接已保存';void check(0)}catch(e){status.textContent=e.message}};
 function cancelCheck(){clearTimeout(retryTimer);controller?.abort();controller=null;}
 box.querySelector('[data-retry]').onclick=()=>{cancelCheck();status.textContent='检测已取消'};
 async function check(attempt=0){
 cancelCheck();if(disposed||!key.value.trim())return;
 const c=new AbortController();controller=c;const timer=setTimeout(()=>c.abort(),60000);
 try{const base=endpoint(),secret=key.value.trim();status.textContent='正在自动连接…';
 const r=await fetch(base+'/health',{headers:{Authorization:'Bearer '+secret},signal:c.signal,redirect:'error',cache:'no-store'});
 if(!r.ok){const e=Error('HTTP '+r.status);e.status=r.status;throw e;}
 const data=await r.json();if(data.service!=='capricorn-music')throw Error('服务标识不匹配');
 if(controller!==c||disposed||key.value.trim()!==secret||endpoint()!==base)return;
 adminPanel.hidden=!data.admin;status.textContent='连接成功；上游音乐接口：'+(data.upstream?'已配置':'未配置');
 const n=epoch;try{const a=await request('/auth/account','GET',base,secret,c.signal);if(controller===c&&n===epoch&&!disposed)note.textContent=a.loggedIn?'已登录：'+a.nickname:'未登录';}catch(e){if(controller===c&&n===epoch)note.textContent='账号状态暂不可用，可手动查看';}
 }catch(e){if(controller!==c||disposed)return;adminPanel.hidden=true;status.textContent='连接失败：'+e.message;if(attempt<2&&(!e.status||e.status===429||e.status>=500))retryTimer=setTimeout(()=>void check(attempt+1),5000*(attempt+1));}finally{clearTimeout(timer)}
 }
 box.querySelector('[data-test]').onclick=()=>void check(0);
 const adminPanel=document.createElement('section');adminPanel.hidden=true;adminPanel.innerHTML='<h4>共享管理</h4><input placeholder="好友备注" data-note><button data-create>创建邀请码</button><button data-list>刷新好友</button><input readonly data-token placeholder="新邀请码（仅显示一次）"><div data-guests></div>';box.append(adminPanel);
 async function manage(path,method='GET'){return request(path,method,endpoint(),key.value.trim(),AbortSignal.timeout(30000))}
 async function list(){const d=await manage('/admin/guests');const area=adminPanel.querySelector('[data-guests]');area.replaceChildren();for(const g of d.guests){const row=document.createElement('div');row.textContent=g.note||'未命名好友';const b=document.createElement('button');b.textContent='撤销';b.onclick=async()=>{if(!confirm('撤销此好友访问权限？'))return;try{await manage('/admin/revoke?id='+encodeURIComponent(g.id),'POST');await list()}catch(e){status.textContent=e.message}};row.append(b);area.append(row)}}
 adminPanel.querySelector('[data-list]').onclick=()=>list().catch(e=>status.textContent=e.message);
 adminPanel.querySelector('[data-create]').onclick=async()=>{try{const d=await manage('/admin/create?note='+encodeURIComponent(adminPanel.querySelector('[data-note]').value),'POST');adminPanel.querySelector('[data-token]').value=d.token;await list()}catch(e){status.textContent=e.message}};
 const auth=document.createElement('div');auth.innerHTML='<h4>网易云账号</h4><button data-login>生成登录二维码</button><button data-account>查看账号</button><button data-logout>退出本地会话</button><img hidden alt="网易云登录二维码" style="width:180px;max-width:100%"><p role="status"></p>';box.append(auth);
 const img=auth.querySelector('img'), note=auth.querySelector('p');let epoch=0, active;const stop=()=>{epoch++;active?.abort();img.hidden=true;img.removeAttribute('src')};
 async function request(path,method,base,secret,signal){const r=await fetch(base+path,{method,headers:{Authorization:'Bearer '+secret},signal,redirect:'error',cache:'no-store'});const d=await r.json();if(!r.ok)throw Error('HTTP '+r.status+' '+(d.error||''));return d}
 function run(fn){stop();const n=epoch,c=new AbortController();active=c;const timer=setTimeout(()=>c.abort(),150000);Promise.resolve().then(()=>fn(endpoint(),key.value.trim(),c.signal,n)).catch(e=>{if(n===epoch)note.textContent='操作失败：'+e.message}).finally(()=>clearTimeout(timer))}
 async function account(base,secret,signal,n){const a=await request('/auth/account','GET',base,secret,signal);if(n===epoch)note.textContent=a.loggedIn?'已登录：'+a.nickname:'未登录'}
 auth.querySelector('[data-login]').onclick=()=>run(async(base,secret,signal,n)=>{note.textContent='正在生成二维码…';const d=await request('/auth/start','POST',base,secret,signal);if(n!==epoch)return;if(!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(d.image))throw Error('二维码格式错误');img.src=d.image;img.hidden=false;note.textContent='请使用网易云音乐扫描二维码（同一部手机需借助另一屏幕）';while(n===epoch&&!signal.aborted){await new Promise(r=>setTimeout(r,3000));if(n!==epoch||signal.aborted)return;const p=await request('/auth/poll','POST',base,secret,signal);if(n!==epoch)return;if(p.code===803){img.hidden=true;await account(base,secret,signal,n);return}if(p.code===800){img.hidden=true;note.textContent='二维码已过期，请重新生成';return}note.textContent=p.code===802?'已扫码，请在网易云确认':'等待扫码'}});
 auth.querySelector('[data-account]').onclick=()=>run(account);auth.querySelector('[data-logout]').onclick=()=>run(async(base,secret,signal,n)=>{await request('/auth/logout','POST',base,secret,signal);if(n===epoch)note.textContent='网关本地会话已清除'});
 const online=document.createElement('label');online.innerHTML='<input type="checkbox"> 启用网易云自动匹配（仅发送歌名和歌手）';box.append(online);const enabled=online.querySelector('input');enabled.checked=localStorage.getItem('capricorn_online')==='true';enabled.onchange=()=>localStorage.setItem('capricorn_online',String(enabled.checked));
 shared.online={ready:()=>enabled.checked&&!!key.value.trim()&&!!url.value.trim(),async get(path,timeout=25000){if(!this.ready())throw Error('请在设置启用网易云并填写密钥');const c=new AbortController();const timer=setTimeout(()=>c.abort(),timeout);try{return await request(path,'GET',endpoint(),key.value.trim(),c.signal)}finally{clearTimeout(timer)}}};
 shared.cloud={request(path,method='GET'){const base=endpoint(),secret=key.value.trim();if(!secret)throw Error('请先保存连接');return request(path,method,base,secret,AbortSignal.timeout(90000))}};
 if(key.value.trim())void check(0);
 return ()=>{disposed=true;cancelCheck();delete shared.online;delete shared.cloud;stop();key.value='';box.remove()};
}
