// Settings > Share: one long job at a time, with progress and a way to stop it.
import {exportExtension,exportGameData,foreignCards,importArchive,importGameData,restoreSillyTavern,setAsideCards} from './share-package.js';
import {openDownload} from './zip-store.js';
import {RangeUnsupported,adjustPlan,characterFolders,checkLocal,chunkedArchive,downloadRelease,formatBytes,loadRelease,missingCards,rangedArchive,updatePlan,wholeDownload} from './game-data-update.js';
const stamp=()=>new Date().toISOString().slice(0,10),KEY='genshin_dialogue_ui',files=n=>`${n} ${n===1?'file':'files'}`;
// Names in a sentence: "Klee, Venti and 3 more".
function listed(names,shown=5){
    const head=names.slice(0,shown),rest=names.length-head.length;
    if(rest)return `${head.join(', ')} and ${rest} more`;
    return head.length>1?`${head.slice(0,-1).join(', ')} and ${head.at(-1)}`:head.join('');
}
export function mountShare({getContext,announce,signal:mountSignal}){
    const $=selector=>document.querySelector(selector);
    let job=null;
    // The game data popup mirrors the Share page, which may be closed while a download runs.
    function paint(message,value=null,max=1){
        document.querySelectorAll('#gi-share-status, #gi-game-data-status').forEach(status=>{status.textContent=message;});
        document.querySelectorAll('#gi-share-progress, #gi-game-data-progress').forEach(bar=>{bar.hidden=value===null;bar.max=max;bar.value=value ?? 0;});
    }
    function setBusy(busy){
        document.querySelectorAll('#gi-settings [data-gi-share]').forEach(button=>{button.disabled=busy;});
        const cancel=$('[data-gi-action="share-cancel"]');if(cancel)cancel.hidden=!busy;
    }
    async function run(label,task){
        if(job)return;
        job=new AbortController();setBusy(true);paint(`${label}...`);
        const report=(done,total)=>paint(`${label}: ${done} of ${total}`,done,total);
        try{await task({report,signal:job.signal});}
        catch(error){
            if(error?.name==='AbortError'||job.signal.aborted)paint('Stopped.');
            else{console.error('[Silly Teyvat] Share',error);paint(error.message);globalThis.toastr?.error?.(error.message,'Silly Teyvat');}
        }finally{job=null;setBusy(false);}
    }
    async function download(name,label,write){
        let sink;
        try{sink=await openDownload(name);}
        catch(error){if(error?.name!=='AbortError')paint(error.message);return;}
        await run(label,async options=>{
            try{const result=await write(sink,options);await sink.close();return result;}
            catch(error){await sink.abort().catch(()=>{});throw error;}
        });
    }
    function ask(text,okButton,cancelButton){
        const ctx=getContext(),body=document.createElement('p');body.textContent=text;
        return ctx.callGenericPopup(body,ctx.POPUP_TYPE.CONFIRM,'',{okButton,cancelButton});
    }
    // The popup counts files as they go and tallies what was added and what this player already had.
    function counts({added=0,have=0,failed=0}={}){
        const tally=document.querySelector('#gi-game-data-tally');if(!tally)return;
        tally.replaceChildren(...[['Added',added,'added'],['Already have it',have,'have'],['Failed',failed,'failed']].filter(([,n,kind])=>n||kind!=='failed').map(([label,n,kind])=>{
            const item=document.createElement('li');item.dataset.kind=kind;const value=document.createElement('strong');value.textContent=String(n);item.append(value,` ${label}`);return item;
        }));
    }
    function step(text){const line=document.querySelector('#gi-game-data-count');if(line)line.textContent=text;}
    // Stop in the popup stops the job; the popup closes itself when the job ends.
    function progressPopup(title){
        const ctx=getContext(),body=document.createElement('div');body.className='gi-game-data-popup';
        body.innerHTML='<h3></h3><p id="gi-game-data-status" role="status"></p><progress id="gi-game-data-progress" class="gi-share-progress"></progress><p id="gi-game-data-count" aria-live="off"></p><ul id="gi-game-data-tally" aria-label="Files"></ul>';
        body.querySelector('h3').textContent=title;
        const popup=new ctx.Popup(body,ctx.POPUP_TYPE.TEXT,'',{okButton:false,cancelButton:'Stop'});
        let open=true,closing=false;
        popup.show().then(()=>{open=false;if(!closing)job?.abort();});
        return async()=>{closing=true;if(open)await popup.completeAffirmative();};
    }
    // The installed release, and the characters this player keeps as their own instead of the game's.
    const kept=()=>getContext().extensionSettings[KEY]?.gameData?.kept || [];
    function record(version,keep=kept()){
        const ctx=getContext();ctx.extensionSettings[KEY].gameData={version,...(keep.length?{kept:keep}:{})};ctx.saveSettingsDebounced();
    }
    // Nothing to download: the release is recorded, and the player sees that they already have it.
    async function alreadyHave(release,plan,{startup}){
        const ctx=getContext();record(release.version);
        const text=`Game data ${release.version}: already have it. Every file is on this server (${files(plan.files)}).`;
        paint(text);
        if(startup){globalThis.toastr?.success?.(text,'Game data');return;}
        const body=document.createElement('div');body.className='gi-game-data-popup gi-game-data-have';
        body.innerHTML='<h3><span aria-hidden="true">✓</span> Already have it</h3><p></p>';body.querySelector('p').textContent=`Every file in game data ${release.version} is already on this server (${files(plan.files)}).`;
        await ctx.callGenericPopup(body,ctx.POPUP_TYPE.TEXT,'',{okButton:'OK'});
    }
    async function installGameData(release,plan){
        const title=plan.kind==='install'?'Downloading game data':plan.kind==='repair'?'Restoring game data':`Updating game data to ${release.version}`;
        let result=null,installed=false;const close=progressPopup(!plan.need.length?'Already have it':title);
        const have=plan.have.length,total=plan.need.length+have;
        counts({have});step(`${have} of ${files(total)} already here`);
        await run('Downloading game data',async({signal})=>{
            const ctx=getContext(),leave=kept(),overwrite=new Set([...(plan.kind==='update'?[...plan.paths,...plan.parts]:[]),...(plan.overwrite || [])]);
            // The import also finds files that are already here when it reads a whole download.
            const installing=(done,_total,tally={})=>{
                const kept=have+(tally.skipped || 0),added=tally.added || 0;
                paint('Installing game data',kept+added+(tally.failed || 0),total);
                step(`${kept+added+(tally.failed || 0)} of ${files(total)}`);counts({added,have:kept,failed:tally.failed});
            };
            if(!wholeDownload(release,plan))try{paint('Downloading game data',have,total);result=await importArchive({ctx,zip:rangedArchive(release,plan.paths,{signal}),overwrite,leave,report:installing,signal});}
            catch(error){if(!(error instanceof RangeUnsupported))throw error;console.info('[Silly Teyvat]',error.message,'Downloading all of it instead.');}
            if(!result){
                const options={signal,report:(done,size)=>{paint('Downloading game data',done,size);step(`${formatBytes(done)} of ${formatBytes(size)}`);}};
                const zip=release.chunks?chunkedArchive(release,plan.paths,options):await downloadRelease(release,options);
                result=await importArchive({ctx,zip,overwrite,leave,report:installing,signal});
            }
            if(result.failed.length){
                console.warn('[Silly Teyvat] Game data failures',result.failed);
                throw new Error(`${result.failed.length} game data files could not be installed. Choose Check for game data in Share to try again.`);
            }
            record(release.version,leave);
            installed=true;
            paint(`Game data ${release.version} is installed: ${files(result.added)} added, ${have+result.skipped} already here. Reload the page to finish.`);
        });
        await close();
        if(installed&&await ask(`Game data ${release.version} is installed. Reload SillyTavern now to finish?`,'Reload','Later'))location.reload();
    }
    // The player's own cards with a game character's file name or name. Installing beside them would mix
    // the game's sprites into their sprite folders, so they choose: back theirs up and use the game's,
    // or keep theirs and leave those game characters out. Returns the plan to install, or null to stop.
    async function settleSameNames(release,plan,groups){
        const ctx=getContext(),names=[...new Set(groups.flatMap(group=>group.cards.map(card=>card.name || card.avatar)))];
        const body=document.createElement('div');body.className='gi-game-data-popup gi-game-data-names';
        body.innerHTML='<h3>Characters with the same names</h3><p></p><p><strong>Back up and use the game’s:</strong> <span></span></p><p><strong>Keep mine:</strong> <span></span></p>';
        const [intro,useGame,keepMine]=body.querySelectorAll('p');
        intro.textContent=`You already have ${names.length===1?'a character':`${names.length} characters`} of your own with the same ${names.length===1?'name':'names'} as Silly Teyvat’s: ${listed(names)}. Installing beside ${names.length===1?'it':'them'} would mix the game’s sprites and settings into ${names.length===1?'your character':'your characters'}.`;
        useGame.querySelector('span').textContent='your cards and their sprites are saved to a ZIP on this computer, then the game’s versions are installed. A card with the same file name is replaced; your chats are kept.';
        keepMine.querySelector('span').textContent='your characters stay exactly as they are, and the game leaves its versions of them out.';
        const replace=await ctx.callGenericPopup(body,ctx.POPUP_TYPE.CONFIRM,'',{okButton:'Back up and use the game’s',cancelButton:'Keep mine'});
        const avatars=groups.map(group=>group.avatar);
        if(!replace){
            const prefs=ctx.extensionSettings[KEY];prefs.gameData={...prefs.gameData,kept:[...new Set([...kept(),...avatars])]};ctx.saveSettingsDebounced();
            return adjustPlan(release,plan,avatars,'keep');
        }
        let sink;
        try{sink=await openDownload(`silly-teyvat-backup-${stamp()}.zip`);}
        catch(error){if(error?.name!=='AbortError')paint(error.message);else paint('Nothing was changed.');return null;}
        let saved=null;const close=progressPopup('Backing up your characters');
        await run('Backing up your characters',async({signal,report})=>{
            try{saved=await setAsideCards(ctx,groups,{sink,folders:avatars.flatMap(avatar=>characterFolders(release,avatar)),signal,report});}
            catch(error){await sink.abort().catch(()=>{});throw error;}
        });
        await close();
        if(!saved)return null;
        paint(`Saved ${saved.cards} ${saved.cards===1?'card':'cards'} and ${saved.sprites} ${saved.sprites===1?'sprite':'sprites'} to your backup ZIP.`);
        return adjustPlan(release,plan,avatars,'replace');
    }
    // At startup, a release this player turned down is not offered again; Check for game data always asks.
    // Check for game data also finds game files deleted since they were installed, and so does startup
    // when most of the game's characters are gone from the character list.
    async function checkGameData({startup=false}={}){
        const ctx=getContext();
        if(job||!ctx.callGenericPopup||!ctx.Popup)return;
        const release=await loadRelease(),prefs=ctx.extensionSettings[KEY] ??= {},installed=prefs.gameData?.version;
        if(!release){if(!startup)paint('This copy of Silly Teyvat has no published game data.');return;}
        let plan=updatePlan(release,installed,{complete:!startup||Boolean(installed)&&missingCards(ctx,release,kept())>.5});
        if(plan.kind==='none'){if(!startup)paint(`Game data ${installed} is up to date.`);return;}
        if(startup&&prefs.gameData?.declined===release.version)return;
        // Files are checked against the release with SubtleCrypto, which a page served over plain http (a phone on the home network) does not have.
        if(!globalThis.crypto?.subtle){if(!startup)paint('Game data can only be downloaded and checked on a secure page. Open SillyTavern at https:// or localhost, or import an exported game data ZIP.');return;}
        let checked=false,groups=[];
        await run('Checking your game data',async({signal})=>{
            plan=adjustPlan(release,await checkLocal(ctx,release,plan,{signal,report:(done,total)=>paint('Checking your game data',done,total)}),kept(),'keep');
            const leave=new Set(kept().map(avatar=>avatar.toLowerCase()));
            groups=await foreignCards(ctx,Object.keys(release.files).filter(name=>name.startsWith('cards/')).map(name=>name.slice(6)).filter(avatar=>!leave.has(avatar.toLowerCase())),{signal});
            checked=true;
        });
        if(!checked)return;
        if(!plan.need.length&&!plan.parts?.length&&!groups.length&&plan.kind!=='install'){await alreadyHave(release,plan,{startup});return;}
        if(!plan.need.length&&!groups.length&&plan.kind==='install'&&plan.files){
            // Everything is here already; only the settings and lorebooks in the export's manifest are read.
            await installGameData(release,plan);return;
        }
        const have=plan.have.length?` You already have ${plan.have.length} of the ${files(plan.files)}, so ${plan.have.length===1?'it is':'they are'} skipped.`:'';
        const same=groups.length?` ${groups.length===1?'One of your own characters has':`${groups.length} of your own characters have`} the same name as one of the game’s; you choose what happens to ${groups.length===1?'it':'them'} next.`:'';
        const text=plan.kind==='install'
            ?`Silly Teyvat's game data has the characters, sprites, scenes, music and lorebooks. Download it now? It is ${formatBytes(plan.bytes)}.${have}${same}`
            :plan.kind==='repair'
                ?(plan.need.length?`${plan.need.length} of the ${files(plan.files)} in Silly Teyvat's game data ${release.version} ${plan.need.length===1?'is':'are'} missing from this server. Download ${plan.need.length===1?'it':'them'} again? It is ${formatBytes(plan.bytes)}.${same}`:`Silly Teyvat's game data ${release.version} is on this server.${same}`)
                :`Silly Teyvat game data ${release.version} is available. Download the update now? It is ${formatBytes(plan.bytes)}.${have} Updated characters, sprites and lorebooks replace your copies; everything else is kept.${same}`;
        if(await ask(text,plan.need.length||plan.kind==='install'?'Download':'Continue','Not now')){
            if(groups.length){
                plan=await settleSameNames(release,plan,groups);
                if(!plan)return;
                if(!plan.need.length&&!plan.parts?.length&&plan.kind!=='install'){record(release.version);paint(`Game data ${release.version} is installed. Your own characters are kept.`);return;}
            }
            await installGameData(release,plan);return;
        }
        prefs.gameData={...prefs.gameData,declined:release.version};ctx.saveSettingsDebounced();
        paint('You can download the game data later with Check for game data.');
        if(startup)globalThis.toastr?.info?.('You can download it later from Silly Teyvat settings, under Share.','Game data');
    }
    async function version(){try{return (await (await fetch(new URL('manifest.json',import.meta.url))).json()).version || '';}catch{return '';}}
    return {
        async exportExtension(){
            const number=await version();
            await download(`silly-teyvat-${number}.zip`,'Exporting extension',async(sink,options)=>{
                const result=await exportExtension({ctx:getContext(),sink,...options});
                paint(`Exported ${result.files} files.`);
            });
        },
        async exportGameData(){
            const number=await version();
            await download(`silly-teyvat-game-data-${stamp()}.zip`,'Exporting game data',async(sink,options)=>{
                const result=await exportGameData({ctx:getContext(),sink,version:number,...options});
                const skipped=result.missing.length?` ${result.missing.length} referenced files were not found and were left out.`:'';
                paint(`Exported ${result.cards} characters and ${result.files} files.${skipped}`);
                if(result.missing.length)console.warn('[Silly Teyvat] Missing from export',result.missing);
            });
        },
        chooseImport(){$('#gi-share-file')?.click();},
        // The same undo that deleting the extension runs, for a player who wants their own look back and to keep playing.
        async restoreSillyTavern(){
            await run('Restoring SillyTavern',async()=>{
                const ctx=getContext(),done=await restoreSillyTavern(ctx,{release:await loadRelease()});
                if(!done.look&&!done.lorebooks.length){paint('Nothing to restore: the Teyvat Slate theme is not in use and the game\u2019s lorebooks are not switched on for every chat.');return;}
                await (await import('/script.js')).saveSettings();
                const parts=[done.look&&'your previous theme is back',done.lorebooks.length&&`${done.lorebooks.join(' and ')} ${done.lorebooks.length===1?'is':'are'} no longer sent with every chat`].filter(Boolean);
                paint(`Done: ${parts.join(', and ')}. Reload the page to finish.`);announce('SillyTavern restored. Reload the page to finish.');
            });
        },
        checkGameData,
        cancel(){job?.abort();},
        bind(){
            $('#gi-share-file')?.addEventListener('change',event=>{
                const input=event.target,file=input.files?.[0];input.value='';
                if(!file)return;
                void run('Importing game data',async options=>{
                    const result=await importGameData({ctx:getContext(),file,replace:Boolean($('#gi-share-replace')?.checked),useSettings:Boolean($('#gi-share-settings')?.checked),...options});
                    const failed=result.failed.length?` ${result.failed.length} could not be imported; run it again to retry.`:'';
                    paint(`Added ${result.added} files and kept ${result.skipped} you already had.${failed} Reload the page to finish.`);
                    announce('Game data imported. Reload the page to finish.');
                    if(result.failed.length)console.warn('[Silly Teyvat] Import failures',result.failed);
                });
            },{signal:mountSignal});
        },
    };
}
