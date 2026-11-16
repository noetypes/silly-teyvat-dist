// One lookup of the player's card library, shared by every module. A library can hold tens of thousands
// of cards that have nothing to do with the game, so nothing that runs on a refresh may scan it once per
// card or per avatar: that made opening a chat take seconds at 3,000 cards and minutes beyond 10,000.
// SillyTavern keeps one array and refills it with new card objects whenever a card is added, edited or
// removed, so the index is rebuilt when the array's length or its first or last card changes, and a hit
// is checked against the array before it is trusted. Kept free of other imports so any module can use it.
const indexes=new WeakMap();
function indexOf(list){
    const n=list.length;let index=indexes.get(list);
    if(index&&index.n===n&&index.first===list[0]&&index.last===list[n-1])return index;
    index={n,first:list[0],last:list[n-1],byAvatar:new Map(),memo:new Map()};
    // The first card with an avatar wins, as Array.find would have it.
    for(let i=0;i<n;i++){const avatar=list[i]?.avatar;if(avatar!=null&&!index.byAvatar.has(avatar))index.byAvatar.set(avatar,i);}
    indexes.set(list,index);
    return index;
}
// The card with this avatar file, or undefined.
export function cardByAvatar(ctx,avatar){
    const list=ctx?.characters;
    if(!Array.isArray(list)||avatar==null)return undefined;
    let index=indexOf(list),at=index.byAvatar.get(avatar);
    // A card swapped in the middle of the array leaves the ends alone: look again before answering.
    if(at!==undefined&&list[at]?.avatar!==avatar){indexes.delete(list);index=indexOf(list);at=index.byAvatar.get(avatar);}
    return at===undefined?undefined:list[at];
}
export const hasCard=(ctx,avatar)=>cardByAvatar(ctx,avatar)!==undefined;
// Where the card sits in the library, for keeping a short list in the library's own order; -1 when absent.
export function cardPosition(ctx,avatar){
    const card=cardByAvatar(ctx,avatar);
    return card===undefined?-1:indexOf(ctx.characters).byAvatar.get(avatar);
}
// A value worked out from the whole library (find(list) may scan it), kept until the library changes.
export function libraryMemo(ctx,key,find){
    const list=ctx?.characters;
    if(!Array.isArray(list))return find([]);
    const memo=indexOf(list).memo;
    if(!memo.has(key))memo.set(key,find(list));
    return memo.get(key);
}
// Every card with exactly this name, in library order. Several cards can share a name.
export function cardsByName(ctx,name){
    return libraryMemo(ctx,'names',list=>{
        const names=new Map();
        for(const card of list){const known=names.get(card?.name);if(known)known.push(card);else names.set(card?.name,[card]);}
        return names;
    }).get(name) || [];
}
export const cardByName=(ctx,name)=>cardsByName(ctx,name)[0];
