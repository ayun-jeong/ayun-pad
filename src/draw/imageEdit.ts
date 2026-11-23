export interface ImageCrop {x:number;y:number;w:number;h:number}
export interface ImageEdit {crop:ImageCrop;turn:number;flipX:boolean;flipY:boolean}
const unit=(n:number,fallback:number)=>Number.isFinite(n)?Math.min(1,Math.max(0,n)):fallback;
export function imageEdit(value?:Partial<ImageEdit>):ImageEdit{
 const c=value?.crop,x=Math.min(.98,unit(c?.x??0,0)),y=Math.min(.98,unit(c?.y??0,0));
 return {crop:{x,y,w:Math.max(.02,Math.min(1-x,unit(c?.w??1,1))),h:Math.max(.02,Math.min(1-y,unit(c?.h??1,1)))},turn:((Math.round(Number.isFinite(value?.turn)?value!.turn!:0)%4)+4)%4,flipX:!!value?.flipX,flipY:!!value?.flipY};
}
export function imageTransform(edit:ImageEdit):string{
 return `translate(.5 .5) scale(${edit.flipX?-1:1} ${edit.flipY?-1:1}) rotate(${edit.turn*90}) translate(-.5 -.5)`;
}
// Keep the selected pixels when rotating or flipping the oriented image.
export function rotateImage(edit:ImageEdit,dir:1|-1):ImageEdit{
 const c=edit.crop;
 return {...edit,turn:(edit.turn+dir+4)%4,flipX:edit.flipY,flipY:edit.flipX,crop:dir===1?{x:1-c.y-c.h,y:c.x,w:c.h,h:c.w}:{x:c.y,y:1-c.x-c.w,w:c.h,h:c.w}};
}
export function flipImage(edit:ImageEdit,axis:'x'|'y'):ImageEdit{
 const c=edit.crop;
 return axis==='x'?{...edit,flipX:!edit.flipX,crop:{...c,x:1-c.x-c.w}}:{...edit,flipY:!edit.flipY,crop:{...c,y:1-c.y-c.h}};
}
export function cropRatio(edit:ImageEdit,sourceAspect:number):number{
 const aspect=edit.turn%2?1/sourceAspect:sourceAspect;
 return aspect*edit.crop.w/edit.crop.h;
}
