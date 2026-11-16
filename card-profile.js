// Character Customization, Profile: the card's name, home waypoint, a Greetings drawer (each greeting
// with the waypoint it starts at and its own scenario) and a Character details drawer for the rest of
// its SillyTavern card (description, portrait and so on). Changes are written to the card file
// itself. Personas have their own profile (persona-wardrobe.js).
import {baseName} from './card-name.js';
import {cardArtFor,cardArtState,setCardArt,removeCardArt,restoreCardArt,cardArtReady} from './card-art-store.js';
import {cardGreetings,greetingScenes,normalizeScenes} from './greeting-scenes.js';
import {worldWaypoints} from './world-data.js';
import {defaultCharacterLocation,setCharacterHome} from './location-cast.js';
import {isEnemy} from './character-properties.js';
import {cardByAvatar} from './card-index.js';

// [field, label, rows, data key where the V2 card's data block names it differently]
export const CARD_FIELDS=[
    ['description','Description',7],
    ['personality','Personality summary',3],
    ['scenario','Scenario',3],
    ['mes_example','Example dialogue',6],
    ['creatorcomment','Creator’s notes',3,'creator_notes'],
];
const dataKey=([key,,,data])=>data || key;
export const cardField=(card,field)=>String(card?.data?.[dataKey(field)] ?? card?.[field[0]] ?? '');
const avatarStem=avatar=>String(avatar || '').replace(/\.[^.]+$/,'');

// What a save sends to SillyTavern's merge endpoint. A rename records the card's first name once,
// so game data looked up by name keeps finding it.
export function cardUpdate(card,values){
    const update={avatar:card.avatar,data:{}};
    if(values.name!==undefined){
        const name=String(values.name).trim();
        if(!name)throw new Error('Enter a name.');
        if(name.length>100)throw new Error('Names can be up to 100 characters.');
        update.name=update.data.name=name;
        if(name!==card.name&&!card.data?.extensions?.silly_teyvat?.baseName)update.data.extensions={silly_teyvat:{baseName:card.name}};
    }
    for(const field of CARD_FIELDS){
        const value=values[field[0]];if(value===undefined)continue;
        update[field[0]]=String(value);update.data[dataKey(field)]=String(value);
    }
    // Greetings: the first is the card's first message, the rest its alternate greetings, each with its scene.
    if(values.greetings!==undefined){
        const texts=values.greetings.map(g=>String(g.text ?? ''));
        if(!texts.length||!texts[0].trim())throw new Error('The first greeting cannot be empty.');
        update.first_mes=update.data.first_mes=texts[0];update.data.alternate_greetings=texts.slice(1);
        update.data.extensions={...update.data.extensions,silly_teyvat:{...update.data.extensions?.silly_teyvat,greetings:normalizeScenes(values.greetings,texts.length)}};
    }
    return update;
}
// After a rename, the sprites stay in the folder named after the old name: SillyTavern's
// expressions look in the card name's folder unless a folder override says otherwise.
export function keepSpriteFolder(ctx,card){
    const overrides=ctx.extensionSettings.expressionOverrides ??= [],stem=avatarStem(card.avatar);
    if(overrides.some(x=>x.name===stem&&x.path))return false;
    const at=overrides.findIndex(x=>x.name===stem),entry={name:stem,path:baseName(card)};
    if(at<0)overrides.push(entry);else overrides[at]=entry;
    ctx.saveSettingsDebounced?.();return true;
}

export function createCardProfileAdapter(getContext){
    const find=avatar=>cardByAvatar(getContext(),avatar);
    async function reload(card){
        const ctx=getContext(),index=ctx.characters?.findIndex(c=>c.avatar===card.avatar);
        await ctx.getOneCharacter?.(card.avatar);
        const fresh=find(card.avatar) || card;
        await ctx.eventSource?.emit?.(ctx.eventTypes?.CHARACTER_EDITED ?? 'character_edited',{detail:{id:String(index),character:fresh}});
        // The open chat and SillyTavern's character editor show the new name and details too.
        if(String(ctx.characterId)===String(index)){
            const script=await import('/script.js');
            if(fresh.name)script.setCharacterName?.(fresh.name);
            script.select_selected_character?.(index,{switchMenu:false});
        }
        (await import('/script.js')).printCharactersDebounced?.();
        return fresh;
    }
    return {
        // Characters arrive "shallow" (without their long fields) until something asks for them.
        async load(card){
            const ctx=getContext(),index=ctx.characters?.findIndex(c=>c.avatar===card.avatar);
            if(index>=0&&ctx.characters[index].shallow)await ctx.unshallowCharacter?.(index);
            return find(card.avatar) || card;
        },
        async save(card,values){
            const ctx=getContext(),update=cardUpdate(card,values),renamed=update.name!==undefined&&update.name!==card.name;
            const response=await fetch('/api/characters/merge-attributes',{method:'POST',headers:ctx.getRequestHeaders(),body:JSON.stringify(update)});
            if(!response.ok)throw new Error(`${card.name} could not be saved (${response.status}).`);
            if(renamed)keepSpriteFolder(ctx,card);
            return reload(card);
        },
        async uploadPortrait(card,file){
            if(!file||!/^image\//.test(file.type))throw new Error('Choose a portrait image.');
            const ctx=getContext(),form=new FormData();form.append('avatar_url',card.avatar);form.append('avatar',file);
            const response=await fetch('/api/characters/edit-avatar',{method:'POST',headers:ctx.getRequestHeaders({omitContentType:true}),body:form});
            if(!response.ok)throw new Error(`Portrait upload failed (${response.status}).`);
            const thumb=ctx.getThumbnailUrl?.('avatar',card.avatar);
            await Promise.allSettled([fetch(`/characters/${encodeURIComponent(card.avatar)}`,{cache:'reload'}),thumb&&fetch(thumb,{cache:'reload'})]);
            return reload(card);
        },
    };
}

export function mountCardProfile({panel,getContext,getCharacter,adapter=createCardProfileAdapter(getContext),onChange=async()=>{},status=()=>{}}){
    panel.className='gi-card-profile';panel.hidden=true;
    panel.innerHTML=`<label class="gi-card-name" title="The name the story and SillyTavern use. Sprites, outfits and game data stay with the character.">Name<input data-card="name" maxlength="100" autocomplete="off" spellcheck="false"></label>
        <label class="gi-card-home" title="Where they live on the map, and where a greeting without a waypoint of its own starts.">Home waypoint<select data-card-home></select></label>
        <details class="gi-card-greetings gi-editor-disclosure"><summary>Greetings</summary><div class="gi-card-greetings-body">
        <div class="gi-greeting-nav"><button type="button" data-greeting="prev" aria-label="Previous greeting" title="Previous greeting">‹</button><span data-greeting-count aria-live="polite"></span><button type="button" data-greeting="next" aria-label="Next greeting" title="Next greeting">›</button></div>
        <label>Greeting<textarea data-greeting-text rows="8" spellcheck="true"></textarea></label>
        <label title="A new chat that opens on this greeting starts here. Swiping to it in Review moves the opening scene here too.">Starts at<select data-greeting-location></select></label>
        <label title="Used in place of the card's Scenario in chats that open on this greeting. Leave empty to use the card's.">Scenario<textarea data-greeting-scenario rows="3" spellcheck="true" placeholder="The card's scenario"></textarea></label>
        <div class="gi-greeting-actions"><button type="button" data-greeting="save">Save greetings</button><button type="button" data-greeting="add">Add greeting</button><button type="button" data-greeting="delete">Delete greeting</button></div></div></details>
        <details class="gi-card-details gi-editor-disclosure"><summary>Character details</summary><div class="gi-card-details-body">
        <div class="gi-card-portrait"><img alt="" draggable="false"><label title="The character's icon: the picture SillyTavern shows for this character everywhere.">Portrait<input data-card-portrait type="file" accept="image/png,image/webp,image/jpeg,image/gif,image/avif"></label></div>
        <div class="gi-card-portrait gi-card-art-row" title="The card shown in SillyTavern's character list while Card art in SillyTavern is on. It is kept apart from the portrait."><img alt="" draggable="false" data-card-art-preview><div class="gi-card-art-controls"><label>Card art<input data-card-art type="file" accept="image/png,image/webp,image/jpeg,image/gif,image/avif"></label><span data-card-art-note></span><button type="button" data-card-art-remove></button></div></div>
        ${CARD_FIELDS.map(([key,label,rows])=>`<label>${label}<textarea data-card="${key}" rows="${rows}" spellcheck="true"></textarea></label>`).join('')}
        <button type="button" data-card-save>Save character details</button></div></details>`;
    const abort=new AbortController(),on=(node,type,fn)=>node.addEventListener(type,fn,{signal:abort.signal}),field=key=>panel.querySelector(`[data-card="${key}"]`);
    const details=panel.querySelector('.gi-card-details'),greetingBox=panel.querySelector('.gi-card-greetings'),name=field('name'),portrait=panel.querySelector('.gi-card-portrait img');
    let loaded='',token=0;
    const portraitUrl=card=>getContext().getThumbnailUrl?.('avatar',card.avatar) || `/characters/${encodeURIComponent(card.avatar)}`;
    const portraitBox=panel.querySelector('.gi-card-portrait'),uploaded=new Map();let shown='';
    // The portrait is the character's icon. Their card art is a picture of its own (card-art-store.js).
    function paintPortrait(card,version=uploaded.get(card.avatar) || ''){
        const thumb=portraitUrl(card),key=`${card.avatar}|${version}`;
        if(shown!==key){shown=key;portrait.src=version?`${thumb}${thumb.includes('?')?'&':'?'}v=${version}`:thumb;}
        paintCardArt(card);
    }
    const artRow=panel.querySelector('.gi-card-art-row'),artPreview=artRow.querySelector('[data-card-art-preview]'),artNote=artRow.querySelector('[data-card-art-note]'),artRemove=artRow.querySelector('[data-card-art-remove]');
    function paintCardArt(card){
        const ctx=getContext(),art=cardArtFor(ctx,card),state=cardArtState(ctx,card);
        artRow.hidden=Boolean(card.isPersona);
        artRow.classList.toggle('gi-card-portrait-card',Boolean(art));artRow.classList.toggle('gi-card-portrait-tcg',art?.kind==='tcg');
        if(art){if(artPreview.getAttribute('src')!==art.url)artPreview.src=art.url;}else artPreview.removeAttribute('src');
        artPreview.hidden=!art;
        artNote.textContent={own:'Your picture.',game:'The game\u2019s card.',hidden:'Hidden: shown with the portrait in a frame.',none:'None: shown with the portrait in a frame.'}[state];
        artRemove.hidden=state==='none';artRemove.textContent=state==='hidden'?'Use the game\u2019s card':state==='own'?'Remove my picture':'Hide card art';
        artRemove.dataset.state=state;
    }
    const cardArtChanged=()=>document.dispatchEvent(new CustomEvent('gi-card-art-changed'));
    cardArtReady.then(()=>{const card=getCharacter?.();if(card&&!abort.signal.aborted&&!panel.hidden)paintCardArt(card);});
    // Home waypoint and Greetings. The greetings are edited as a draft and saved together, so each
    // keeps its waypoint and scenario when one is added or removed.
    const home=panel.querySelector('[data-card-home]'),homeRow=home.closest('label'),gx=key=>panel.querySelector(`[data-greeting${key}]`);
    const gText=gx('-text'),gPlace=gx('-location'),gScenario=gx('-scenario'),gCount=gx('-count'),gButton=action=>panel.querySelector(`[data-greeting="${action}"]`);
    let greetings=[],at=0,greetingsFor='';
    function fillPlaces(select,first,value){
        const points=worldWaypoints(getContext()),key=points.map(p=>p.location.id+'\u0001'+p.location.label).join('\u0002');
        if(select.dataset.key!==key){
            select.replaceChildren(new Option(first,''));const groups=new Map();
            for(const {region,location} of points){let group=groups.get(region.name);if(!group){group=document.createElement('optgroup');group.label=region.name;groups.set(region.name,group);select.append(group);}group.append(new Option(location.label,location.id));}
            select.dataset.key=key;
        }
        select.options[0].textContent=first;select.querySelector('[data-missing]')?.remove();
        if(value&&![...select.options].some(o=>o.value===value)){const missing=new Option(`${value} (not on the map)`,value);missing.dataset.missing='';select.append(missing);}
        select.value=value || '';
    }
    function paintHome(card){
        const ctx=getContext();homeRow.hidden=isEnemy(ctx,card);
        if(!homeRow.hidden)fillPlaces(home,'No home',defaultCharacterLocation(ctx,card.avatar)?.id || '');
    }
    function stashGreeting(){const g=greetings[at];if(g){g.text=gText.value;g.location=gPlace.value;g.scenario=gScenario.value;}}
    function paintGreeting(){
        const card=getCharacter();if(!card||!greetings.length)return;
        const g=greetings[at],place=defaultCharacterLocation(getContext(),card.avatar)?.label;
        gCount.textContent=`${at+1} of ${greetings.length}${at===0?' · First message':''}`;
        gText.value=g.text;gScenario.value=g.scenario;fillPlaces(gPlace,isEnemy(getContext(),card)?'Anywhere they roam':place?`Home (${place})`:'Home',g.location);
        gButton('prev').disabled=at===0;gButton('next').disabled=at>=greetings.length-1;gButton('delete').disabled=greetings.length<2;
    }
    function readGreetings(card){
        const scenes=greetingScenes(card),texts=cardGreetings(card),keep=greetingsFor===card.avatar;
        greetings=texts.map((text,i)=>({text,location:scenes[i]?.location || '',scenario:scenes[i]?.scenario || ''}));
        greetingsFor=card.avatar;at=keep?Math.min(at,greetings.length-1):0;
    }
    function paintDetails(card){for(const f of CARD_FIELDS)field(f[0]).value=cardField(card,f);readGreetings(card);loaded=card.avatar;}
    const editors=()=>panel.querySelectorAll('textarea,[data-card-save],.gi-card-greetings-body :is(select,button)');
    async function loadDetails(){
        const card=getCharacter();if(!card||card.isPersona)return;const mine=++token;
        for(const node of editors())node.disabled=true;
        try{const full=await adapter.load(card);if(mine===token&&getCharacter()?.avatar===card.avatar)paintDetails(full);}
        catch(error){status(error.message);}
        finally{if(mine===token){for(const node of editors())node.disabled=false;paintGreeting();}}
    }
    function refresh(){
        const card=getCharacter();panel.hidden=!card||Boolean(card.isPersona);if(panel.hidden)return;
        name.value=card.name;paintPortrait(card);paintHome(card);
        if(loaded!==card.avatar){loaded='';for(const f of CARD_FIELDS)field(f[0]).value='';if(greetingsFor!==card.avatar){greetings=[];gText.value=gScenario.value=gCount.textContent='';}if(details.open||greetingBox.open)void loadDetails();}
        else paintGreeting();
    }
    for(const box of [details,greetingBox])on(box,'toggle',()=>{if(box.open&&loaded!==getCharacter()?.avatar)void loadDetails();});
    on(home,'change',()=>{
        const card=getCharacter();if(!card)return;
        try{setCharacterHome(getContext(),card.avatar,home.value || null);status(home.value?`${card.name} now lives at ${home.selectedOptions[0].textContent}.`:`${card.name} has no home waypoint now.`);stashGreeting();paintGreeting();}
        catch(error){status(error.message);paintHome(card);}
    });
    on(gButton('prev'),'click',()=>{stashGreeting();at=Math.max(0,at-1);paintGreeting();});
    on(gButton('next'),'click',()=>{stashGreeting();at=Math.min(greetings.length-1,at+1);paintGreeting();});
    on(gButton('add'),'click',()=>{if(!greetings.length)return;stashGreeting();greetings.push({text:'',location:'',scenario:''});at=greetings.length-1;paintGreeting();gText.focus();status('New greeting added. Save greetings to keep it.');});
    on(gButton('delete'),'click',()=>{if(greetings.length<2)return;greetings.splice(at,1);at=Math.min(at,greetings.length-1);paintGreeting();status('Greeting removed. Save greetings to keep the change.');});
    on(gButton('save'),'click',async event=>{
        event.stopPropagation();const button=event.currentTarget;stashGreeting();
        const kept=greetings.filter((g,i)=>i===0||g.text.trim());button.disabled=true;
        try{await save({greetings:kept},`${getCharacter()?.name}'s greetings saved to their card.`);}
        catch(error){status(error.message);}
        finally{button.disabled=false;}
    });
    async function save(values,done){
        const card=getCharacter();if(!card||card.isPersona)return;
        const fresh=await adapter.save(card,values);loaded='';
        await onChange(fresh || card);status(done);
    }
    on(name,'keydown',event=>{if(event.key==='Enter'){event.preventDefault();name.blur();}else if(event.key==='Escape'&&name.value!==getCharacter()?.name){event.preventDefault();event.stopPropagation();name.value=getCharacter()?.name || '';}});
    on(name,'change',async()=>{
        const card=getCharacter(),next=name.value.trim();if(!card||next===card.name){name.value=card?.name || '';return;}
        if(!next){name.value=card.name;status('Enter a name.');return;}
        name.disabled=true;
        try{const old=card.name;await save({name:next},`${old} is now called ${next}.`);}
        catch(error){name.value=card.name;status(error.message);}
        finally{name.disabled=false;}
    });
    on(panel.querySelector('[data-card-save]'),'click',async event=>{
        event.stopPropagation();const button=event.currentTarget;button.disabled=true;
        try{await save(Object.fromEntries(CARD_FIELDS.map(([key])=>[key,field(key).value])),`${getCharacter()?.name}'s details saved to their card.`);}
        catch(error){status(error.message);}
        finally{button.disabled=false;}
    });
    on(panel.querySelector('[data-card-art]'),'change',async event=>{
        const card=getCharacter?.(),file=event.target.files?.[0];event.target.value='';if(!card||!file)return;
        try{await setCardArt(getContext(),card,file);paintCardArt(card);cardArtChanged();status(`${card.name}'s card art updated.`);}
        catch(error){status(error.message);globalThis.toastr?.error?.(error.message,'Silly Teyvat');}
    });
    on(artRemove,'click',()=>{
        const card=getCharacter?.();if(!card)return;
        if(artRemove.dataset.state==='hidden')restoreCardArt(getContext(),card);else removeCardArt(getContext(),card);
        paintCardArt(card);cardArtChanged();status(`${card.name}'s card art updated.`);
    });
    on(panel.querySelector('[data-card-portrait]'),'change',async event=>{
        const input=event.currentTarget,card=getCharacter(),file=input.files?.[0];if(!card||!file)return;input.disabled=true;
        try{const fresh=await adapter.uploadPortrait(card,file);uploaded.set(card.avatar,String(Date.now()));paintPortrait(fresh || card);await onChange(fresh || card);status(`${card.name}'s portrait updated.`);}
        catch(error){status(error.message);}
        finally{input.value='';input.disabled=false;}
    });
    return {refresh,dispose(){token++;abort.abort();}};
}
