// Graphics quality: one setting for how much the browser is asked to draw.
//   high      everything: frosted glass behind panels, looping glows, Burst splash art and particles.
//   balanced  no frosted glass (the blur behind panels is the most expensive thing to paint) and at most 60 frames a second.
//   low       also no looping glows, no Burst splash art or particles, and at most 30 frames a second.
// "auto" picks one from what the browser reports about the device. The classes below are styled in performance.css.
import {frameCapFps,setFrameCap} from './frame-rate.js';
export const GRAPHICS_OPTIONS=Object.freeze(['auto','high','balanced','low']);
export const GRAPHICS_LABELS=Object.freeze({high:'High',balanced:'Balanced',low:'Low'});
const CLASSES={balanced:['gi-gfx-balanced'],low:['gi-gfx-balanced','gi-gfx-low']},ALL=['gi-gfx-balanced','gi-gfx-low'];
const CAPS={balanced:60,low:30};
// The graphics adapter's name, where the browser gives it. A software renderer draws on the processor.
function rendererName(doc=globalThis.document){
    try{
        const gl=doc?.createElement('canvas').getContext('webgl');if(!gl)return 'none';
        const info=gl.getExtension('WEBGL_debug_renderer_info'),name=String(gl.getParameter(info?info.UNMASKED_RENDERER_WEBGL:gl.RENDERER) || '');
        gl.getExtension('WEBGL_lose_context')?.loseContext();
        return name;
    }catch{return 'none';}
}
// What a device reports is coarse (memory is capped at 8 GB, and some browsers report neither), so
// this only separates the clear cases; anything unknown counts as capable.
export function recommendGraphics({cores,memory,renderer='',coarse=false,reducedMotion=false}={}){
    if(/swiftshader|llvmpipe|software|basic render|^none$/i.test(renderer))return {level:'low',reason:'the browser is drawing without a graphics card (hardware acceleration is off or unavailable)'};
    if(cores&&cores<=2||memory&&memory<=2)return {level:'low',reason:`this device reports ${cores&&cores<=2?`${cores} processor core${cores===1?'':'s'}`:`${memory} GB of memory`}`};
    if(reducedMotion)return {level:'balanced',reason:'the system asks for reduced motion'};
    if(cores&&cores<=4||memory&&memory<=4||coarse)return {level:'balanced',reason:coarse&&!(cores&&cores<=4)&&!(memory&&memory<=4)?'this is a touch device':`this device reports ${cores&&cores<=4?`${cores} processor cores`:`${memory} GB of memory`}`};
    return {level:'high',reason:'this device reports enough processor cores and memory'};
}
let detected=null;
export function detectGraphics(){
    if(detected)return detected;
    const nav=globalThis.navigator || {},media=query=>Boolean(globalThis.matchMedia?.(query).matches);
    detected=recommendGraphics({cores:nav.hardwareConcurrency,memory:nav.deviceMemory,renderer:rendererName(),coarse:media('(pointer: coarse)')&&!media('(any-pointer: fine)'),reducedMotion:media('(prefers-reduced-motion: reduce)')});
    return detected;
}
// The level in force: the player's choice, or the detected one for Auto.
export function graphicsLevel(prefs={}){
    const chosen=GRAPHICS_OPTIONS.includes(prefs.graphics)?prefs.graphics:'auto';
    return chosen==='auto'?detectGraphics().level:chosen;
}
// Burst splash art, particles and screen shake are drawn only above Low.
export const effectsAllowed=prefs=>graphicsLevel(prefs)!=='low';
let applied='';
export function applyGraphics(prefs={},body=globalThis.document?.body){
    const level=graphicsLevel(prefs),cap=frameCapFps(prefs),limit=CAPS[level] || 0;
    // The lower of the player's frame cap and the level's own.
    setFrameCap(limit?(cap?Math.min(cap,limit):limit):cap);
    if(!body||applied===level)return level;
    applied=level;
    body.classList.remove(...ALL);body.classList.add(...(CLASSES[level] || []));
    return level;
}
export function removeGraphics(body=globalThis.document?.body){applied='';body?.classList.remove(...ALL);}
