import {createInverted} from './inverted.js';
import {createIndexStore} from './index-store.js';
const store=createIndexStore();
let scope='',index=createInverted(),chain=Promise.resolve();
function valid(b){return b&&typeof b.text==='string'&&b.f instanceof Map&&Number.isSafeInteger(b.n)&&b.n>=0&&[...b.f].every(([k,v])=>typeof k==='string'&&Number.isSafeInteger(v)&&v>0)&&[...b.f.values()].reduce((a,v)=>a+v,0)===b.n;}
self.onmessage=({data:m})=>{chain=chain.then(async()=>{try{
 const live=new Set(m.ids),removed=new Set(m.removed);
 if(scope!==m.scope){scope=m.scope;index=createInverted();for(const [id,b] of await store.read(scope)){if(live.has(id)&&valid(b))index.put(id,b.text,b);else removed.add(id);}}
 for(const id of index.ids())if(!live.has(id))removed.add(id);
 for(const id of removed)index.remove(id);
 await store.patch(scope,[],[...removed]);
 let batch=[];
 for(let i=0;i<m.changed.length;i++){const [id,text]=m.changed[i];if(index.get(id)?.text!==text){index.put(id,text);batch.push([id,index.get(id)]);}if(batch.length>=256){await store.patch(scope,batch);batch=[];}if(i%256===255)await new Promise(r=>setTimeout(r,0));}
 self.postMessage({id:m.id,scores:index.score(m.ids,m.query)});
 await store.patch(scope,batch);
 }catch(e){self.postMessage({id:m.id,error:String(e)});}});};
