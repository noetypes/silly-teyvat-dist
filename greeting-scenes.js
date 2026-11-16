// Greetings linked to places. Each of a card's greetings (its first message, then its alternate
// greetings) can name the waypoint it starts at and a scenario of its own. They are kept on the card,
// in data.extensions.silly_teyvat.greetings, in the same order as the greetings, so they travel with it.
// A greeting without a waypoint starts at the character's home.

export const cardGreetings=card=>{
    const data=card?.data || {},first=data.first_mes ?? card?.first_mes ?? '';
    return [String(first),...(Array.isArray(data.alternate_greetings)?data.alternate_greetings.map(String):[])];
};
export function greetingScenes(card){
    const list=card?.data?.extensions?.silly_teyvat?.greetings;
    return Array.isArray(list)?list:[];
}
export function greetingScene(card,index){
    const scene=Number.isInteger(index)&&index>=0?greetingScenes(card)[index]:null;
    return {location:typeof scene?.location==='string'&&scene.location?scene.location:null,scenario:typeof scene?.scenario==='string'?scene.scenario:''};
}
// Links trimmed to the greetings the card has, with empty entries left as null so the order holds.
export function normalizeScenes(scenes,count){
    const list=Array.from({length:count},(_,i)=>{
        const s=scenes?.[i],location=typeof s?.location==='string'?s.location.trim():'',scenario=typeof s?.scenario==='string'?s.scenario.trim():'';
        return location||scenario?{...(location?{location}:{}),...(scenario?{scenario}:{})}:null;
    });
    while(list.length&&!list.at(-1))list.pop();
    return list;
}

// Which of the card's greetings the opening message shows. SillyTavern drops an empty first
// message from the swipes, and swipes generated past the last greeting belong to none (-1).
export function greetingIndex(ctx,character=ctx.characters?.[ctx.characterId]){
    const message=ctx.chat?.[0];if(!character||!message||message.is_user||message.is_system)return -1;
    const greetings=cardGreetings(character),offset=greetings[0].trim()?0:1,index=Number(message.swipe_id ?? 0)+offset;
    return Number.isInteger(index)&&index<greetings.length&&greetings[index].trim()?index:-1;
}

// The greeting's scenario becomes the chat's scenario override, which SillyTavern uses in place of
// the card's. One the player wrote themselves is never replaced. Returns whether it changed.
export function applyGreetingScenario(ctx,character=ctx.characters?.[ctx.characterId],index=greetingIndex(ctx,character)){
    if(!character||index<0)return false;
    const meta=ctx.chatMetadata ??= {},previous=meta.silly_teyvat_greeting,scene=greetingScene(character,index);
    const ours=!meta.scenario||meta.scenario===previous?.scenario;let changed=false;
    if(ours&&(meta.scenario || '')!==scene.scenario){if(scene.scenario)meta.scenario=scene.scenario;else delete meta.scenario;changed=true;}
    if(previous?.index!==index||previous?.scenario!==scene.scenario||previous?.location!==scene.location)changed=true;
    meta.silly_teyvat_greeting={index,location:scene.location,scenario:scene.scenario};
    return changed;
}
