import {linkedCard,playedAvatars} from './persona-link.js';
import {activeGroup,inPartyChat} from './party.js';
import {defaultCharacterLocation,locationCastState} from './location-cast.js';
import {isEnemy} from './character-properties.js';
import {teleportTo,worldWaypoints} from './world-data.js';
import {noteLocationArrival} from './arrival-policy.js';
import {rollLocationEncounter} from './location-encounters.js';
import {saveTravel,travelState} from './backgrounds.js';
import {beginOpeningScene} from './opening-scene.js';
import {isNarrator} from './narrator.js';
import {enemyNative} from './enemy-regions.js';
import {abyssAvatar} from './twin-roles.js';
import {applyGreetingScenario,greetingIndex,greetingScene} from './greeting-scenes.js';

// Called when a solo card opens a new chat. A chat that already has a saved location
// resumes there instead, and group conversion or history views never move it.
export const hasSavedLocation=ctx=>Boolean(travelState(ctx).location?.id);
export function startCharacterAtHome(ctx,random=Math.random){
    if(ctx.groupId)return startGroupAtHome(ctx);
    if(inPartyChat(ctx))return false;
    const character=ctx.characters?.[ctx.characterId];if(!character||playedAvatars(ctx).has(character.avatar))return false;
    if(hasSavedLocation(ctx))return false;
    if(character.avatar!==abyssAvatar(ctx))applyGreetingScenario(ctx,character);
    const points=worldWaypoints(ctx),enemy=isEnemy(ctx,character),defaultHome=defaultCharacterLocation(ctx,character.avatar);
    const habitats=enemy?points.filter(({location})=>location.wilderness&&(location.enemyPool || []).includes(character.avatar)):[];
    const regional=enemy?points.filter(({region,location})=>location.wilderness&&enemyNative(character.name,region.name)):[];
    const options=habitats.length?habitats:regional;
    // The opening greeting's own waypoint comes first; without one, enemies roam and everyone else is at home.
    const home=greetingPlace(ctx,character) || (options.length?options[Math.min(options.length-1,Math.floor(random()*options.length))].location:null) || points.find(item=>item.location.id===defaultHome?.id)?.location || points[0]?.location;
    beginOpeningScene(ctx,character.avatar,home?.id);if(!home)return false;
    openAt(ctx,character,home);return true;
}
// Where the chat's opening greeting starts, when its waypoint exists and has artwork.
// The Abyss twin keeps its own greeting and the Chasm, whatever the card's greetings say.
export function greetingPlace(ctx,character){
    if(character?.avatar===abyssAvatar(ctx))return null;
    const id=greetingScene(character,greetingIndex(ctx,character)).location;
    return id?worldWaypoints(ctx).find(item=>item.location.id===id)?.location || null:null;
}
function openAt(ctx,character,home){
    const enemy=isEnemy(ctx,character),state=locationCastState(ctx);
    state.core=enemy?[]:[character.avatar];
    state.managed=[];if(!enemy)state.placements[character.avatar]=home.id;
    teleportTo(ctx,home.id,{record:false});
    state.encounter=rollLocationEncounter(ctx,home.id,enemy?[]:[character.avatar],{kind:'open'});
    if(enemy)state.encounter.enemies=[character.avatar];
    noteLocationArrival(ctx,home.id,{kind:'open',travellers:[character.avatar]});saveTravel(ctx);
}
// The opening message changed: a new chat's random greeting, or a swipe to another greeting.
// While the party is still where the chat began, it moves to that greeting's waypoint (or home)
// and takes its scenario. Returns whether anything changed.
export function followGreeting(ctx,random=Math.random){
    if(ctx.groupId||inPartyChat(ctx))return false;
    const character=ctx.characters?.[ctx.characterId];if(!character||playedAvatars(ctx).has(character.avatar)||character.avatar===abyssAvatar(ctx))return false;
    const index=greetingIndex(ctx,character);if(index<0)return false;
    if(!hasSavedLocation(ctx))return startCharacterAtHome(ctx,random);
    const scenario=applyGreetingScenario(ctx,character,index),opening=locationCastState(ctx).opening;
    if(!opening?.active||opening.avatar!==character.avatar){if(scenario)saveTravel(ctx);return scenario;}
    const points=worldWaypoints(ctx),home=defaultCharacterLocation(ctx,character.avatar);
    const target=greetingPlace(ctx,character) || (isEnemy(ctx,character)?null:points.find(item=>item.location.id===home?.id)?.location);
    if(!target||target.id===travelState(ctx).location?.id){if(scenario)saveTravel(ctx);return scenario;}
    opening.locationId=target.id;openAt(ctx,character,target);return true;
}

// A brand-new group has no location. Start it at the home of a random member
// that has one, so everyone begins in a real place. Groups with any chat or
// travel history are left alone.
export function startGroupAtHome(ctx,random=Math.random){
    const group=activeGroup(ctx);if(!ctx.groupId||!group)return false;
    const state=locationCastState(ctx);
    if(state.groupHomeStart||travelState(ctx).location?.id||ctx.chat?.some(m=>m.is_user&&!m.extra?.silly_teyvat_inherited))return false;
    const points=worldWaypoints(ctx),members=(group.members || []).filter(a=>!playedAvatars(ctx).has(a)&&!group.disabled_members?.includes(a)&&!isEnemy(ctx,a)&&!isNarrator(a));
    // A journey with no one else in it is a solo journey, which starts at the played card's home.
    const homes=(members.length?members:[linkedCard(ctx)?.avatar]).map(a=>defaultCharacterLocation(ctx,a)).filter(home=>home&&points.some(p=>p.location.id===home.id));
    state.groupHomeStart=true;
    if(!homes.length){saveTravel(ctx);return false;}
    const home=homes[Math.floor(random()*homes.length)];
    state.core=[...members];state.managed=[];
    for(const avatar of members)state.placements[avatar]=home.id;
    teleportTo(ctx,home.id,{record:false});
    state.encounter=rollLocationEncounter(ctx,home.id,members,{kind:'open'});
    noteLocationArrival(ctx,home.id,{kind:'open',travellers:members});saveTravel(ctx);return true;
}
