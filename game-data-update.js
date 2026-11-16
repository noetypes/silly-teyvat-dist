// Published game data. Each extension version carries game-data-release.json, written by
// tools/release-game-data.py, which names the hosted export, its size and the version in which
// each file last changed. A first install downloads the whole export; an update reads only the
// changed files from it with byte ranges, falling back to the whole file when the host refuses.
// Every file is found at the offset and checked against the checksum the release names.
import {existingFiles,shippedEntry} from './share-package.js';
export const RELEASE_FILE='game-data-release.json',FORMAT=1;
const extensionRoot=new URL('./',import.meta.url),GROUP_BYTES=8<<20;
const parts=version=>[0,1,2].map(index=>Number.parseInt(String(version).split(/[.+-]/)[index],10) || 0);
export function compareVersions(a,b){
    const [x,y]=[parts(a),parts(b)];
    for(let i=0;i<3;i++)if(x[i]!==y[i])return x[i]<y[i]?-1:1;
    return 0;
}
// A checksum prefix of at least 16 digits: an empty one would match any file (see verified).
const validEntry=entry=>entry&&typeof entry.since==='string'&&/^[a-f0-9]{16,64}$/.test(entry.sha256 || '')&&Number.isSafeInteger(entry.size)&&Number.isSafeInteger(entry.offset);
const https=url=>typeof url==='string'&&/^https:\/\//.test(url);
function validChunks(release){
    if(release.chunks===undefined)return true;
    if(!Array.isArray(release.chunks)||!release.chunks.length)return false;
    let offset=0;
    for(const chunk of release.chunks){
        if(!https(chunk.url)||chunk.offset!==offset||!Number.isSafeInteger(chunk.size)||chunk.size<=0||!/^[a-f0-9]{64}$/.test(chunk.sha256 || ''))return false;
        offset+=chunk.size;
    }
    return offset===release.bytes;
}
export function validRelease(release){
    return Boolean(release&&release.format===FORMAT&&typeof release.version==='string'&&https(release.url)&&Number.isSafeInteger(release.bytes)
        &&release.files&&Object.values(release.files).every(entry=>validEntry(entry)&&entry.offset>=0&&entry.size>=0&&entry.offset+entry.size<=release.bytes)
        &&typeof release.manifest==='string'&&validEntry(release.files[release.manifest])&&validChunks(release));
}
// Development copies without a release file do not offer a download.
export async function loadRelease(fetcher=fetch){
    try{
        const response=await fetcher(new URL(RELEASE_FILE,extensionRoot),{cache:'no-store'});
        if(!response.ok)return null;
        const release=await response.json();
        return validRelease(release)?release:null;
    }catch{return null;}
}
// Settings remember the installed release; lorebooks, the theme and quick replies are tracked as
// named parts of the export's manifest file so that a change to one replaces only that one.
// A complete plan also covers files deleted since they were installed: Check for game data, or a
// library that lost most of the game's characters, offers them again. A repair is a complete plan
// for the release this player already has.
export function updatePlan(release,installed,{complete=false}={}){
    if(!release)return {kind:'none',paths:[],bytes:0};
    const shipped=Object.keys(release.files).filter(shippedEntry);
    if(!installed)return {kind:'install',paths:shipped,bytes:release.bytes};
    if(compareVersions(installed,release.version)>=0)return complete?{kind:'repair',paths:shipped,bytes:release.bytes}:{kind:'none',paths:[],bytes:0};
    const changed=name=>compareVersions(release.files[name]?.since ?? release.parts?.[name]?.since,installed)>0;
    const paths=shipped.filter(name=>name!==release.manifest&&changed(name));
    const parts=Object.keys(release.parts || {}).filter(changed);
    const bytes=[...paths,release.manifest].reduce((sum,name)=>sum+release.files[name].size,0);
    const plan={kind:'update',paths:[...paths,release.manifest],parts,bytes};
    if(complete){const listed=new Set(plan.paths);plan.restore=shipped.filter(name=>!listed.has(name));}
    return plan;
}
// The share of the release's characters missing from this server, from the character list alone.
// Characters the player kept as their own are not the game's to miss.
export function missingCards(ctx,release,kept=[]){
    const key=name=>String(name).normalize('NFC').toLowerCase(),have=new Set((ctx.characters || []).map(card=>key(card.avatar))),own=new Set(kept.map(key));
    const cards=Object.keys(release?.files || {}).filter(name=>name.startsWith('cards/')&&!own.has(key(name.slice(6))));
    return cards.length?cards.filter(name=>!have.has(key(name.slice(6)))).length/cards.length:0;
}
const stem=name=>name.replace(/\.[^.]+$/,'');
// A character's files in the release: its card and every sprite in the folder named after it.
export function characterPaths(release,avatar){
    const card=`cards/${avatar}`.toLowerCase(),root=`sprites/${stem(avatar)}/`.toLowerCase();
    return Object.keys(release.files).filter(name=>{const lower=name.toLowerCase();return lower===card||lower.startsWith(root);});
}
// The sprite folders a game character uses: the one named after it and the release's sets inside it.
export function characterFolders(release,avatar){
    const sets=characterPaths(release,avatar).filter(name=>name.startsWith('sprites/')).map(name=>name.slice(8).split('/').slice(0,-1).join('/'));
    return [...new Set([stem(avatar),...sets])];
}
function finishPlan(release,plan,need,have){
    const manifest=plan.kind==='install'||need.length||plan.parts?.length?[release.manifest]:[];
    const paths=[...need,...manifest];
    return {...plan,paths,need,have,files:need.length+have.length,bytes:paths.reduce((sum,name)=>sum+release.files[name].size,0)};
}
// Characters the player kept as their own ('keep') are left out of the game data, and their
// files are never compared or downloaded. Characters set aside for the game's ('replace') have
// every file of theirs downloaded again, over whatever is left.
export function adjustPlan(release,plan,avatars,mode){
    if(plan.kind==='none'||!avatars?.length)return plan;
    const owned=new Set(avatars.flatMap(avatar=>characterPaths(release,avatar))),other=name=>!owned.has(name);
    const need=plan.need.filter(other),have=plan.have.filter(other);
    if(mode==='replace')need.push(...owned);
    return {...finishPlan(release,plan,need,have),overwrite:mode==='replace'?[...new Set([...(plan.overwrite || []),...owned])]:plan.overwrite};
}
export function formatBytes(bytes){
    const units=['bytes','KB','MB','GB'];let value=bytes,unit=0;
    while(value>=1000&&unit<units.length-1){value/=1000;unit++;}
    return unit?`${value>=100?Math.round(value):value.toFixed(1)} ${units[unit]}`:`${bytes} bytes`;
}
async function sha256(blob){
    const hash=new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()));
    return [...hash].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}
// The release keeps a 16-digit prefix of each file's SHA-256, enough to catch a wrong or damaged file.
export async function verified(release,path,blob){
    const expected=release.files[path];
    if(!expected)return blob;
    if(blob.size!==expected.size||!(await sha256(blob)).startsWith(expected.sha256))throw new Error(`${path} did not match the published game data. The host may have a different file.`);
    return blob;
}
export class RangeUnsupported extends Error{}
// A browser reports an offline host and a host that refuses other sites (CORS) the same way.
async function reach(fetcher,release,options,url=release.url){
    try{return await fetcher(url,options);}
    catch(error){
        if(error?.name==='AbortError')throw error;
        throw new Error(`Could not reach ${new URL(url).host}. Check the connection and try again later; if it keeps failing, the host may not allow downloads from other sites.`);
    }
}
// Reads changed entries straight from the hosted ZIP, in the shape share-package expects of readZip.
export function rangedArchive(release,paths,{fetcher=fetch,signal}={}){
    const entries=new Map(paths.map(name=>[name,{name,...release.files[name]}]));
    return {
        entries,
        async read(entry){
            const blobs=[],end=entry.offset+entry.size;
            const chunks=release.chunks || [{url:release.url,offset:0,size:release.bytes}];
            for(const chunk of chunks){
                const start=Math.max(entry.offset,chunk.offset),stop=Math.min(end,chunk.offset+chunk.size);
                if(start>=stop)continue;
                const response=await reach(fetcher,release,{headers:{Range:`bytes=${start-chunk.offset}-${stop-chunk.offset-1}`},signal},chunk.url);
                if(response.status===200){await response.body?.cancel?.();throw new RangeUnsupported('The game data host does not send parts of files.');}
                if(response.status!==206)throw new Error(`The game data host answered ${response.status}.`);
                blobs.push(await response.blob());
            }
            return verified(release,entry.name,new Blob(blobs));
        },
    };
}
// Install large static-hosted packs one part at a time. Keeping the entire multi-gigabyte ZIP
// as a browser Blob can exceed storage quotas, especially in a private window or on a phone.
// Two parts cover an entry crossing a boundary; everything already installed can be released.
export function chunkedArchive(release,paths,{fetcher=fetch,signal,report=()=>{}}={}){
    // The release JSON is sorted by filename, while the ZIP groups cards, sprite folders and
    // uploads in export order. Physical order prevents repeatedly downloading evicted parts.
    const ordered=[...paths].sort((a,b)=>release.files[a].offset-release.files[b].offset);
    const entries=new Map(ordered.map(name=>[name,{name,...release.files[name]}])),cache=new Map();
    let received=0;
    async function chunkBlob(chunk){
        if(cache.has(chunk.url)){
            const blob=cache.get(chunk.url);cache.delete(chunk.url);cache.set(chunk.url,blob);return blob;
        }
        const response=await reach(fetcher,release,{signal},chunk.url);
        if(!response.ok)throw new Error(`The game data host answered ${response.status}.`);
        const blob=await response.blob();
        if(blob.size!==chunk.size||await sha256(blob)!==chunk.sha256)throw new Error('A game data download part did not match the published checksum. Try again later.');
        received+=blob.size;report(Math.min(received,release.bytes),release.bytes);
        cache.set(chunk.url,blob);
        while(cache.size>2)cache.delete(cache.keys().next().value);
        return blob;
    }
    return {entries,async read(entry){
        const blobs=[],end=entry.offset+entry.size;
        for(const chunk of release.chunks){
            const start=Math.max(entry.offset,chunk.offset),stop=Math.min(end,chunk.offset+chunk.size);
            if(start>=stop)continue;
            signal?.throwIfAborted();
            blobs.push((await chunkBlob(chunk)).slice(start-chunk.offset,stop-chunk.offset));
        }
        return verified(release,entry.name,new Blob(blobs));
    }};
}
export async function downloadRelease(release,{fetcher=fetch,report=()=>{},signal}={}){
    // Chunks go into Blobs as they arrive: the browser can keep those on disk, where a gigabyte of
    // loose arrays would have to stay in memory.
    const blobs=[];let received=0;
    for(const chunk of release.chunks || [{url:release.url,size:release.bytes}]){
        signal?.throwIfAborted();
        const response=await reach(fetcher,release,{signal},chunk.url);
        if(!response.ok)throw new Error(`The game data host answered ${response.status}.`);
        const reader=response.body.getReader(),groups=[];let group=[],grouped=0,chunkBytes=0;
        for(;;){
            const {done,value}=await reader.read();
            if(done)break;
            group.push(value);grouped+=value.byteLength;received+=value.byteLength;chunkBytes+=value.byteLength;report(received,release.bytes);
            if(chunkBytes>chunk.size){await reader.cancel();throw new Error('The game data download is larger than published.');}
            if(grouped>=GROUP_BYTES){groups.push(new Blob(group));group=[];grouped=0;}
        }
        const blob=new Blob([...groups,...group]);
        if(chunkBytes!==chunk.size)throw new Error(`The game data download was ${formatBytes(received)} instead of ${formatBytes(release.bytes)}. Try again later.`);
        if(chunk.sha256&&await sha256(blob)!==chunk.sha256)throw new Error('A game data download part did not match the published checksum. Try again later.');
        blobs.push(blob);
    }
    if(received!==release.bytes)throw new Error(`The game data download was ${formatBytes(received)} instead of ${formatBytes(release.bytes)}. Try again later.`);
    // Files are read at the offsets the release names, never through the ZIP directory: download parts
    // can hold bare file contents, some of them stored by earlier releases (tools/release-game-data.py).
    const archive=new Blob(blobs),entries=new Map(Object.entries(release.files).map(([name,entry])=>[name,{name,...entry}]));
    return {entries,read:async entry=>verified(release,entry.name,archive.slice(entry.offset,entry.offset+entry.size))};
}

// Where SillyTavern serves each kind of packaged file, so this player's copy can be compared.
export function localUrl(path){
    const slash=path.indexOf('/'),kind=path.slice(0,slash),name=path.slice(slash+1).split('/').map(encodeURIComponent).join('/');
    return {cards:`/characters/${name}`,sprites:`/characters/${name}`,files:`/user/files/${name}`,backgrounds:`/backgrounds/${name}`,avatars:`/User%20Avatars/${name}`}[kind] || '';
}
async function sameFile(release,path,{fetcher,signal}){
    const url=localUrl(path);if(!url)return false;
    const response=await fetcher(url,{cache:'no-store',signal}).catch(error=>{if(error?.name==='AbortError')throw error;return null;});
    if(!response?.ok||Number(response.headers?.get?.('content-length') ?? release.files[path].size)!==release.files[path].size){await response?.body?.cancel?.();return false;}
    try{await verified(release,path,await response.blob());return true;}catch{return false;}
}
// Narrows a plan to what this server lacks. A first install or a repair keeps whatever is already
// here; an update skips a changed file when this player's copy already matches the new one, and
// a complete update adds back unchanged files that are missing.
export async function localPlan(release,plan,{present,fetcher=fetch,signal,report=()=>{}}={}){
    if(plan.kind==='none')return {...plan,files:0,have:[]};
    const media=plan.paths.filter(name=>name!==release.manifest),restore=plan.restore || [],total=media.length+restore.length,need=[],have=[];let done=0;
    for(const path of media){
        signal?.throwIfAborted();
        if(!present.has(path))need.push(path);
        else if(plan.kind!=='update'||await sameFile(release,path,{fetcher,signal}))have.push(path);
        else need.push(path);
        report(++done,total,{have:have.length});
    }
    for(const path of restore){(present.has(path)?have:need).push(path);report(++done,total,{have:have.length});}
    // The export's own manifest carries settings, lorebooks, the theme and quick replies.
    return finishPlan(release,plan,need,have);
}
export async function checkLocal(ctx,release,plan,options={}){
    if(plan.kind==='none')return localPlan(release,plan,options);
    const present=await existingFiles(ctx,[...plan.paths,...(plan.restore || [])].filter(name=>name!==release.manifest),{signal:options.signal});
    return localPlan(release,plan,{...options,present});
}
// A first install that needs most of the export is faster as one download than as many ranges.
export const wholeDownload=(release,plan)=>plan.kind!=='update'&&plan.bytes>release.bytes*.6;
