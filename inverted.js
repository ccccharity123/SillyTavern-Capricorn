import {tokenize} from './hybrid.js';
export function createInverted(){const docs=new Map(),post=new Map();let total=0;
function remove(id){const b=docs.get(id);if(!b)return;for(const t of b.f.keys()){const p=post.get(t);p.delete(id);if(!p.size)post.delete(t);}total-=b.n;docs.delete(id);}
function put(id,text,cached){if(docs.get(id)?.text===text)return;remove(id);const tokens=cached?null:tokenize(text),f=cached?cached.f:new Map();if(tokens)for(const t of tokens)f.set(t,(f.get(t)||0)+1);const n=cached?cached.n:tokens.length;docs.set(id,{text,f,n});total+=n;for(const [t,n] of f){if(!post.has(t))post.set(t,new Map());post.get(t).set(id,n);}}
function score(ids,query){const scores=new Map(),avg=total/Math.max(1,docs.size)||1;for(const t of new Set(tokenize(query))){const p=post.get(t);if(!p)continue;const idf=Math.log(1+(docs.size-p.size+.5)/(p.size+.5));for(const [id,f] of p){const n=docs.get(id).n;scores.set(id,(scores.get(id)||0)+idf*f*2.2/(f+1.2*(.25+.75*n/avg)));}}return ids.map(id=>scores.get(id)||0);}
function dump(){return [...docs];}
return {put,remove,score,dump,get:id=>docs.get(id),ids:()=>docs.keys()};}
