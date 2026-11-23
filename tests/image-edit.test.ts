import {it,expect} from 'vitest';
import {imageEdit,rotateImage,flipImage,cropRatio,imageTransform} from '../src/draw/imageEdit';
it('bounds corrupt crop data and reads existing images without edits',()=>{
 expect(imageEdit()).toEqual({crop:{x:0,y:0,w:1,h:1},turn:0,flipX:false,flipY:false});
 const e=imageEdit({crop:{x:2,y:-1,w:5,h:NaN},turn:NaN});expect(e.crop.x).toBe(.98);expect(e.crop.y).toBe(0);expect(e.crop.w).toBeCloseTo(.02);expect(e.crop.h).toBe(1);expect(e.turn).toBe(0);
});
it('rotation and reflection preserve selected source pixels',()=>{
 const e=imageEdit({crop:{x:.1,y:.2,w:.4,h:.6},flipX:true});
 const r=rotateImage(e,1);expect(r.turn).toBe(1);expect(r.flipX).toBe(false);expect(r.flipY).toBe(true);expect(r.crop.x).toBeCloseTo(.2);expect(r.crop.y).toBeCloseTo(.1);expect(r.crop.w).toBe(.6);expect(r.crop.h).toBe(.4);
 const restored=rotateImage(r,-1);expect(restored.flipX).toBe(true);expect(restored.turn).toBe(0);for(const k of ['x','y','w','h'] as const)expect(restored.crop[k]).toBeCloseTo(e.crop[k]);
 const twice=flipImage(flipImage(e,'x'),'x');expect(twice.flipX).toBe(e.flipX);expect(twice.crop.x).toBeCloseTo(e.crop.x);
 expect(cropRatio(imageEdit({crop:{x:.25,y:0,w:.5,h:1}}),2)).toBe(1);
 expect(imageTransform(r)).toContain('rotate(90)');
});
