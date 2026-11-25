// Session-only health, shared by foreground and migration. Never persist credentials.
export function createVectorHealth(embed, clock = Date.now) {
  let identity, state = '待验证', retryAt = 0, failures = 0;
  function sync(cfg) {
    const key = JSON.stringify([cfg.vectorUrl,cfg.vectorModel,cfg.vectorKey||'']);
    if (key !== identity) { identity=key; state='待验证'; retryAt=failures=0; }
    return key;
  }
  function info(cfg) {
    if (!cfg.vectorEnabled || !cfg.vectorUrl || !cfg.vectorModel) return '未配置';
    sync(cfg);
    return retryAt && clock() >= retryAt ? '等待恢复验证' : state;
  }
  async function request(texts,cfg,signal,onRequest) {
    const key=sync(cfg);
    if(clock()<retryAt) { const e=Error('向量服务冷却中'); e.retryAfterMs=retryAt-clock(); throw e; }
    try {
      const result=await embed(texts,cfg,signal,onRequest);
      if(identity===key&&!signal?.aborted){state='可用';retryAt=failures=0;}
      return result;
    } catch(e) {
      if(identity===key&&!signal?.aborted){
        const code=Number(e.status)||0;
        state=code===401||code===403?'认证失败':code===429?'限流或额度不足':code===402?'额度不足':'请求失败';
        retryAt=clock()+Math.max(e.retryAfterMs||0,Math.min(900000,60000*2**Math.min(failures++,4)),code===401||code===403||code===402?300000:0);
      }
      throw e;
    }
  }
  return {request,info,ready:cfg=>{sync(cfg);return clock()>=retryAt;}};
}
