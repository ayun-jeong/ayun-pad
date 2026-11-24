import {useEffect,useState} from 'react';
import type {Library} from './library';
import {supabase} from './supabase';
import {hub} from './sync';
import {syncRequest} from './syncRequest';
export interface ImageMeta {id:string;mime:string;width:number;height:number;bytes:number;owner?:string;}
interface ImageFile extends ImageMeta {blob:Blob;uploadedFor?:string[];}
const DB='ayunpad-images';
let database:Promise<IDBDatabase>|undefined;
const listeners=new Set<()=>void>(),sources=new Map<string,string>(),loading=new Map<string,Promise<string|undefined>>(),uploading=new Map<string,Promise<void>>();
let library:Library|null=null;
const emit=()=>listeners.forEach(fn=>fn());
function db(){return database??=new Promise<IDBDatabase>((resolve,reject)=>{const req=indexedDB.open(DB,1);req.onupgradeneeded=()=>req.result.createObjectStore('files',{keyPath:'id'});req.onsuccess=()=>resolve(req.result);req.onerror=()=>{database=undefined;reject(req.error);};});}
async function readFile(id:string):Promise<ImageFile|undefined>{const d=await db();return new Promise((resolve,reject)=>{const r=d.transaction('files').objectStore('files').get(id);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
async function putFile(file:ImageFile){const d=await db();await new Promise<void>((resolve,reject)=>{const t=d.transaction('files','readwrite');t.objectStore('files').put(file);t.oncomplete=()=>resolve();t.onerror=()=>reject(t.error);t.onabort=()=>reject(t.error);});}
async function allFiles():Promise<ImageFile[]>{const d=await db();return new Promise((resolve,reject)=>{const r=d.transaction('files').objectStore('files').getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
const asDataURL=(blob:Blob)=>new Promise<string>((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result as string);r.onerror=()=>reject(r.error);r.readAsDataURL(blob);});
const path=(uid:string,id:string)=>`${uid}/images/${id}`;
// Existing private file storage already grants access only to the current user's folder.
const BUCKET='pad-fonts';
export function bindImageAssets(lib:Library){library=lib;const map=lib.ydoc.getMap<ImageMeta>('images'),on=()=>emit();map.observe(on);let lastUser:string|null=null;
 const off=hub.subscribeStatus(()=>{const uid=hub.session?.user.id??null;if(uid!==lastUser){lastUser=uid;emit();if(uid)void uploadPendingImages();}});
 const online=()=>{void uploadPendingImages();emit();};const retry=window.setInterval(()=>{if(hub.session)void uploadPendingImages();emit();},30000);window.addEventListener('online',online);void lib.ready.then(()=>{emit();if(hub.session)void uploadPendingImages();});
 return()=>{clearInterval(retry);map.unobserve(on);off();window.removeEventListener('online',online);if(library===lib)library=null;};
}
export async function uploadImage(id:string):Promise<void>{const uid=hub.session?.user.id;if(!uid||!library)return;const key=uid+':'+id;if(uploading.has(key))return uploading.get(key)!;
 const run=(async()=>{const file=await readFile(id);if(!file)return;const lib=library;if(!lib)return;
  if(!file.uploadedFor?.includes(uid)){hub.begin();try{const {error}=await syncRequest(()=>supabase.storage.from(BUCKET).upload(path(uid,id),file.blob,{upsert:true,contentType:file.mime}),60000);if(error)throw error;await putFile({...file,uploadedFor:[...new Set([...(file.uploadedFor??[]),uid])]});hub.end(null,`image:${key}`);}catch(error){hub.end(error,`image:${key}`);return;}}
  if(hub.session?.user.id!==uid)return;const map=lib.ydoc.getMap<ImageMeta>('images'),current=map.get(id);if(!current||current.owner!==uid){map.set(id,{id,mime:file.mime,width:file.width,height:file.height,bytes:file.bytes,owner:uid});emit();}
 })().finally(()=>uploading.delete(key));uploading.set(key,run);return run;
}
export async function uploadPendingImages(){if(!hub.session)return;try{for(const file of await allFiles())await uploadImage(file.id);}catch{/* IndexedDB failure is reported when inserting an image. */}}
export async function imageSource(id:string):Promise<string|undefined>{if(sources.has(id))return sources.get(id);if(loading.has(id))return loading.get(id)!;
 const run=(async()=>{let file=await readFile(id);if(!file){const meta=library?.ydoc.getMap<ImageMeta>('images').get(id),uid=hub.session?.user.id;if(!meta||!uid)return;const {data,error}=await syncRequest(signal=>supabase.storage.from(BUCKET).download(path(meta.owner??uid,id),{}, {signal}));if(error||!data)return;file={...meta,blob:data,uploadedFor:[uid]};await putFile(file);}
 const src=await asDataURL(file.blob);sources.set(id,src);return src;})().catch(()=>undefined).finally(()=>loading.delete(id));loading.set(id,run);return run;
}
export function useImageSource(id:string,portable?:string){const [source,setSource]=useState<string|undefined>(()=>sources.get(id)??portable);useEffect(()=>{let alive=true;const load=()=>{void imageSource(id).then(src=>{if(alive)setSource(src??portable);});};listeners.add(load);load();return()=>{alive=false;listeners.delete(load);};},[id,portable]);return source;}
export async function registerImage(blob:Blob,width:number,height:number){const bytes=new Uint8Array(await blob.arrayBuffer()),hash=await crypto.subtle.digest('SHA-256',bytes),id='im-'+[...new Uint8Array(hash)].map(b=>b.toString(16).padStart(2,'0')).join('');const file:ImageFile={id,mime:blob.type,width,height,bytes:blob.size,blob};const previous=await readFile(id);await putFile(previous??file);sources.set(id,await asDataURL(blob));const map=library?.ydoc.getMap<ImageMeta>('images');if(map&&!map.has(id))map.set(id,{id,mime:file.mime,width,height,bytes:blob.size});emit();void uploadImage(id);return{id,width,height};}
export async function importImageSource(id:string,src:string){if(!/^data:image\/(png|jpeg|webp);base64,/i.test(src))throw new Error('지원하지 않는 이미지입니다');const blob=await (await fetch(src)).blob();const img=await decodeImage(blob);try{const stored=await registerImage(blob,img.naturalWidth,img.naturalHeight);if(stored.id!==id)throw new Error('이미지 데이터가 일치하지 않아요');}finally{URL.revokeObjectURL(img.src);}}
export async function exportImages(ids:Iterable<string>){const out:Record<string,string>={};for(const id of new Set(ids)){const src=await imageSource(id);if(!src)throw new Error('이미지를 내려받은 뒤 다시 시도해 주세요');out[id]=src;}return out;}
function decodeImage(blob:Blob):Promise<HTMLImageElement>{return new Promise((resolve,reject)=>{const img=new Image(),url=URL.createObjectURL(blob);img.onload=()=>resolve(img);img.onerror=()=>{URL.revokeObjectURL(url);reject(new Error('이미지를 열지 못했어요'));};img.src=url;});}
export async function prepareImage(blob:Blob){if(!blob.type.startsWith('image/'))throw new Error('이미지 파일을 골라 주세요');if(blob.size>40*1024*1024)throw new Error('40MB 이하 이미지를 넣어 주세요');const img=await decodeImage(blob);try{
 const w=img.naturalWidth,h=img.naturalHeight;if(!w||!h)throw new Error('이미지 크기를 읽지 못했어요');const scale=Math.min(1,4096/Math.max(w,h),Math.sqrt(12000000/(w*h))),width=Math.max(1,Math.round(w*scale)),height=Math.max(1,Math.round(h*scale));const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;canvas.getContext('2d')!.drawImage(img,0,0,width,height);
 const encoded=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('이미지를 변환하지 못했어요')),'image/webp',.94));const optimized=scale===1&&blob.type==='image/png'&&blob.size<encoded.size?blob:encoded;return await registerImage(optimized,width,height);
 }finally{URL.revokeObjectURL(img.src);}}

export const peekImageSource=(id:string)=>sources.get(id);
