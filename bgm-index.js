export function createBgmIndex(parse,hash){
 let scope=null,length=-1,newest=-1;
 const rows=new Map();
 function update(key,chat,ids=null){
 const full=key!==scope||ids===null||length<0||chat.length<length||chat.length-length>1;
 const positions=full?null:[...new Set([...ids,...(chat.length>length?[length]:[])])];
 const visited=positions?.length??chat.length;
 const changed=new Map();
 if(full){rows.clear();newest=-1;}
 for(let i=0;i<visited;i++){
   const position=positions?.[i]??i;
   const previous=rows.get(position),message=chat[position];
   if(!message||message.is_user||message.is_system){
     if(rows.delete(position))changed.set(position,null);
     continue;
   }
   const body=String(message.message??message.mes??message.content??message.text??'');
   const found=parse(body);
   if(!found.length){
     if(rows.delete(position))changed.set(position,null);
     continue;
   }
   const row={id:String(message.message_id??message.id??position),signature:hash(body),found};
   if(previous?.id===row.id&&previous.signature===row.signature)continue;
   rows.set(position,row);
   changed.set(position,row);
   newest=Math.max(newest,position);
 }
 if(newest>=0&&!rows.has(newest)){
   newest=-1;
   for(const position of rows.keys())newest=Math.max(newest,position);
 }
 scope=key;length=chat.length;
 return {full,visited,changed};
 }
 return {
   update,
   latest:()=>rows.get(newest)??null,
   entries:()=>[...rows.entries()].sort((a,b)=>a[0]-b[0]).map(x=>x[1]),
   clear(){scope=null;length=-1;newest=-1;rows.clear()},
 };
}
