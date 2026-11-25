// One bounded, ephemeral URL lookup; never downloads audio or persists signed URLs.
export function createMusicPrefetch({now=Date.now,ttl=60000}={}) {
 let entry;
 function clear(){entry?.controller.abort();entry=undefined;}
 function start(key,lookup){
   if(entry?.key===key && now()<entry.expires)return entry.promise;
   clear(); const controller=new AbortController();
   const item={key,controller,expires:now()+ttl,value:null};entry=item;
   item.promise=Promise.resolve().then(()=>lookup(controller.signal)).then(value=>{
     if(entry===item&&!controller.signal.aborted&&now()<item.expires)item.value=value;
     return item.value;
   }).catch(()=>null);
   return item.promise;
 }
 function take(key){const value=entry?.key===key&&now()<entry.expires?entry.value:null;clear();return value;}
 return {start,take,clear};
}
