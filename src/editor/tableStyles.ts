import type {Attrs} from 'prosemirror-model';
import type {CellAttributes} from 'prosemirror-tables';

export const TABLE_COLORS=['#EC3535','#FFCB10','#0064E8','#52D407','#4D00E8','#000000','#FFFFFF'] as const;
export const BORDER_SIDES=['Top','Right','Bottom','Left'] as const;
export type BorderSide=typeof BORDER_SIDES[number];
export type BorderMode='all'|'outer'|'inner'|'horizontal'|'none';
export function tableColor(value:unknown):string|null {
  if(typeof value!=='string')return null;
  if(/^#[\da-f]{6}$/i.test(value))return value.toUpperCase();
  if(/^#[\da-f]{3}$/i.test(value))return '#'+[...value.slice(1)].map(c=>c+c).join('').toUpperCase();
  const rgb=value.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*(0?(?:\.\d+)?|1(?:\.0+)?))?\s*\)$/i);
  if(!rgb||rgb[4]==='0')return null;
  return '#'+rgb.slice(1,4).map(n=>Math.min(255,Number(n)).toString(16).padStart(2,'0')).join('').toUpperCase();
}
const opacity=(value:unknown)=>Number(value)===.2?.2:1;
const width=(value:unknown)=>[.5,1,1.5,2].includes(Number(value))?Number(value):1;
function border(value:unknown):string|null {
  if(typeof value!=='string')return null;
  if(/^0(?:px)?(?:\s|$)/.test(value))return '0px solid transparent';
  const m=value.match(/^(0\.5|1(?:\.5)?|2)px\s+solid\s+(.+)$/i),color=m&&tableColor(m[2]);
  return m&&color?`${m[1]}px solid ${color}`:null;
}
export const tableCellAttributes:Record<string,CellAttributes>={
  backgroundColor:{default:null,getFromDOM:el=>tableColor((el as HTMLElement).style.backgroundColor)},
  backgroundOpacity:{default:1,getFromDOM:el=>{const m=(el as HTMLElement).style.backgroundColor.match(/,\s*([\d.]+)\)$/);return m?opacity(m[1]):1;}},
  borderColor:{default:'#000000',getFromDOM:el=>tableColor((el as HTMLElement).style.borderColor)??'#000000'},
  borderWidth:{default:1,getFromDOM:el=>width(parseFloat((el as HTMLElement).style.borderWidth))},
  ...Object.fromEntries(BORDER_SIDES.map(side=>['border'+side,{default:null,getFromDOM:(el:HTMLElement)=>border(el.style['border'+side as 'borderTop'])}])),
};
export function cellInlineStyle(attrs:Attrs):string {
  const color=tableColor(attrs.backgroundColor),alpha=opacity(attrs.backgroundOpacity);
  const fill=color?(alpha===1?color:`rgba(${parseInt(color.slice(1,3),16)},${parseInt(color.slice(3,5),16)},${parseInt(color.slice(5,7),16)},0.2)`):'transparent';
  const fallback=`${width(attrs.borderWidth)}px solid ${tableColor(attrs.borderColor)??'#000000'}`;
  return `min-width:${attrs.colwidth?24:40}px;background-color:${fill};border-color:${tableColor(attrs.borderColor)??'#000000'};border-width:${width(attrs.borderWidth)}px;border-style:solid;`+BORDER_SIDES.map(side=>`border-${side.toLowerCase()}:${border(attrs['border'+side])??fallback};`).join('');
}
