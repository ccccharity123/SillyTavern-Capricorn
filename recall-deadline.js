// Bound asynchronous recall, without allowing a late result to publish a prompt.
export class RecallTimeout extends Error {
  constructor(){super('动态记忆检索超时，本轮跳过动态注入');this.name='RecallTimeout';}
}
export async function boundedRecall(run,{ms=1800,guard=()=>{},cancel=()=>{},clock=()=>globalThis.performance?.now?.()??Date.now()}={}){
  const start=clock();let expired=false,timer;
  const expire=()=>{if(!expired){expired=true;cancel();}return new RecallTimeout();};
  const check=()=>{guard();if(expired||clock()-start>=ms)throw expire();};
  try{
    const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>reject(expire()),ms);});
    const work=Promise.resolve().then(()=>{check();return run(check);});
    const result=await Promise.race([work,timeout]);check();return result;
  }finally{clearTimeout(timer);}
}
