import { describe, expect, it } from 'vitest';
import { handles, translate, type Resolved } from '../src/draw/model';
import { tboxStyle } from '../src/draw/TextBox';
import { arrange } from '../src/draw/arrange';
const shape: Resolved & {t:'text'} = {id:'shape',t:'text',frame:'ellipse',stroke:'r',fill:'y',dash:true,a:{x:10,y:20},bw:40,bh:30,c:'k',w:.35,z:1,text:''};
describe('도형 안의 글상자', () => {
  it('원형·테두리·채우기는 글자색과 독립적으로 표시한다', () => {
    const style=tboxStyle({...shape,c:'p'});
    expect(style.border).toBe('0.35mm dashed #EC3535');
    expect(style.borderRadius).toBe('50%');
    expect(style.color).toBe('#4D00E8');
    expect(style.background).toContain('#FFCB10');
    expect(style.minHeight).toContain('30mm');
  });
  it('네모의 기본 위아래 여백은 0.25mm로 작게 둔다', () => {
    expect(tboxStyle({...shape,frame:'rect'}).padding).toBe('0.25mm 0.8mm');
  });
  it('일반 글상자는 폭 손잡이 하나, 도형은 원래의 모서리·변 손잡이 8개를 갖는다', () => {
    expect(handles(shape,()=>30)).toEqual([{x:10,y:20},{x:50,y:20},{x:50,y:50},{x:10,y:50},{x:30,y:20},{x:50,y:35},{x:30,y:50},{x:10,y:35}]);
    expect(handles({...shape,frame:undefined},()=>30)).toEqual([{x:50,y:35}]);
  });
  it('이동·정렬·크기 맞춤도 도형과 글의 정보를 한 번에 유지한다', () => {
    expect(translate(shape,5,8)).toEqual({...shape,a:{x:15,y:28}});
    const result=arrange([shape,{...shape,id:'other',a:{x:60,y:70},bw:60,bh:45}], 'size',id=>id==='shape'?30:45);
    expect(result[0]).toMatchObject({frame:'ellipse',stroke:'r',fill:'y',bw:60,bh:45,text:''});
  });
});
