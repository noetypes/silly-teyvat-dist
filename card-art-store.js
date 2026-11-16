// Card art: the Genshin card picture a character is shown with in SillyTavern's lists while Card art in
// SillyTavern is on. It is kept apart from the character's own image, which is their icon everywhere and is
// all SillyTavern shows with the feature (or the extension) off. The game's own cards have theirs in
// assets/card-art (tools/build-card-art.py); a player sets or removes one in a character's Profile, and that
// choice is saved in the settings with the image among SillyTavern's uploaded files. Nothing is ever worked
// out from the size of a character's image.
import {mediaSettings} from './media-store.js';
import {baseName} from './card-name.js';
import {hasGenshinTag} from './character-properties.js';

const CARD_RATIO=208/248,TCG_RATIO=420/720;
// A Genshin character card is nearly square; a Genius Invokation card (the enemies') is tall.
export const cardShape=(width,height)=>height>0?(Math.abs(width/height-CARD_RATIO)<.03?true:Math.abs(width/height-TCG_RATIO)<.03?'tcg':false):false;
// How an uploaded picture is laid out: tall pictures as TCG cards, the rest as character cards.
export const cardKind=(width,height)=>height>0&&width/height<(CARD_RATIO+TCG_RATIO)/2?'tcg':'art';

let bundled={};
const root=new URL('./assets/card-art/',import.meta.url);
export const cardArtReady=(typeof fetch==='function'?fetch(new URL('index.json',root)).then(r=>r.ok?r.json():{}):Promise.resolve({}))
    .then(data=>{bundled=data.art || {};}).catch(()=>{});
// For checks.
export function setBundledCardArt(art){bundled=art || {};}

const stored=ctx=>mediaSettings(ctx).cardArtImages || {};
// {url, kind:'art'|'tcg', own} for a card, or null when it has no card art.
export function cardArtFor(ctx,card){
    if(!card?.avatar)return null;
    const own=stored(ctx)[card.avatar];
    if(own){return own.path?{url:own.path,kind:own.kind==='tcg'?'tcg':'art',own:true}:null;}
    // The game's art belongs to the game's cards: a player's own "Amber" keeps her own picture.
    if(!hasGenshinTag(ctx,card))return null;
    const entry=bundled[baseName(card)] || bundled[card.name] || bundled[String(card.avatar).replace(/\.[^.]+$/,'')];
    return entry?{url:new URL(entry.file,root).href,kind:entry.kind==='tcg'?'tcg':'art',own:false}:null;
}
// What the Profile editor shows: 'own' (the player's picture), 'game', 'hidden' (the game's, switched off) or 'none'.
export function cardArtState(ctx,card){
    const own=stored(ctx)[card?.avatar];
    if(own)return own.path?'own':'hidden';
    return cardArtFor(ctx,card)?'game':'none';
}
function imageSize(file){
    if(typeof createImageBitmap==='function')return createImageBitmap(file).then(image=>{const size=[image.width,image.height];image.close();return size;});
    return Promise.reject(new Error('This browser cannot read the picture.'));
}
const asBase64=blob=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(reader.error);reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.readAsDataURL(blob);});
// Saves a picture as the card's art. Its shape is read here, once, from the file the player chose.
export async function setCardArt(ctx,card,file,{upload=uploadFile}={}){
    if(!file||!/^image\/(png|webp|jpeg|gif|avif)$/.test(file.type))throw new Error('Choose a PNG, WebP, JPEG, GIF or AVIF picture.');
    if(file.size>8<<20)throw new Error('Choose a picture under 8 MB.');
    const [width,height]=await imageSize(file);
    const stem=String(card.avatar).replace(/\.[^.]+$/,'').replace(/[^\p{L}\p{N}_-]+/gu,'-').slice(0,60) || 'card',extension=file.type.split('/')[1].replace('jpeg','jpg');
    const path=await upload(ctx,`silly-teyvat-card-art-${stem}-${Date.now().toString(36)}.${extension}`,file);
    const prefs=mediaSettings(ctx);prefs.cardArtImages ??= {};prefs.cardArtImages[card.avatar]={path,kind:cardKind(width,height)};
    ctx.saveSettingsDebounced?.();
    return cardArtFor(ctx,card);
}
// Takes the card's art away: the player's own picture goes first, which shows the game's again; asked
// once more, the game's is hidden too. restoreCardArt brings the game's back.
export function removeCardArt(ctx,card){
    const prefs=mediaSettings(ctx);prefs.cardArtImages ??= {};
    if(prefs.cardArtImages[card.avatar]?.path)delete prefs.cardArtImages[card.avatar];
    else if(cardArtFor(ctx,card))prefs.cardArtImages[card.avatar]={path:''};
    ctx.saveSettingsDebounced?.();
}
export function restoreCardArt(ctx,card){
    const prefs=mediaSettings(ctx);if(prefs.cardArtImages)delete prefs.cardArtImages[card.avatar];
    ctx.saveSettingsDebounced?.();
}
async function uploadFile(ctx,name,file){
    const response=await fetch('/api/files/upload',{method:'POST',headers:ctx.getRequestHeaders(),body:JSON.stringify({name,data:await asBase64(file)})});
    if(!response.ok)throw new Error(`The picture could not be saved (${response.status}).`);
    return (await response.json()).path || `/user/files/${name}`;
}
