// Card art in SillyTavern: characters with card art (card-art-store.js) are shown with it, whole, in the
// character list and the other views below, so the card's own frame is the border and its back card adds
// depth. Other avatars get a frame the size of a card's front. The art is stored apart from the character's
// image, so nothing here fetches or measures that image: an avatar is a card only if a card was set for it.
import {linkedCard} from './persona-link.js';
import {cardByAvatar} from './card-index.js';
import {cardArtFor,cardArtReady} from './card-art-store.js';
export {cardShape} from './card-art-store.js';

const CARD_RATIO = 208 / 248;

const TARGETS = [
    '#right-nav-panel .character_select:not(.inline_avatar) .avatar img', // character list
    '#avatar_load_preview', // character editor
    '#right-nav-panel .hotswap .avatar img', // favorites above the character list
    '#right-nav-panel .group_member .avatar img', // group members / add members
    '#right-nav-panel .avatar_collage img', // group avatar collages
    '#right-nav-panel .group_select .avatar:not(.avatar_collage) img', // a group's own portrait in the character list
    '#group_avatar_preview .avatar img', // the group editor's portrait (a journey's stored card copy)
    '#chat .recentChat .avatar img', // Recent Chats on the welcome screen
    'body.gi-history #chat .mes .avatar img', // Dialogue Review
    'body.gi-classic #chat .mes .avatar img', // the classic chat, with Story view off
    '#user_avatar_block .avatar img', // Persona Management
].join(',');

function thumbFile(src, type = 'avatar') {
    try { const url = new URL(src, location.href); return url.pathname.endsWith('/thumbnail') && url.searchParams.get('type') === type ? url.searchParams.get('file') : null; }
    catch { return null; }
}
function mark(img, kind) {
    const box = img.closest('.avatar');
    img.classList.toggle('gi-card-img', kind === 'art' || kind === 'tcg');img.classList.toggle('gi-card-img-tcg', kind === 'tcg');img.classList.toggle('gi-card-img-frame', kind === 'frame');
    if (!box) return;
    if (box.classList.contains('avatar_collage')) {
        const count = box.querySelectorAll('img').length;
        box.classList.toggle('gi-card-collage', Boolean(kind)); box.style.setProperty('--gi-cards', count);
        box.style.setProperty('--gi-card-w', `${(box.clientHeight || 90) * CARD_RATIO * (count > 2 ? .7 : .8)}px`); return;
    }
    box.classList.toggle('gi-card-art', kind === 'art' || kind === 'tcg'); box.classList.toggle('gi-card-frame', kind === 'frame');
}
// A solo journey's portrait is a cropped copy stored in the group, so it is drawn from the card it was taken from.
// The group editor's portrait has no row naming its group, so it is the group whose stored portrait it shows.
function journeyCard(img, ctx) {
    const row = img.closest('[data-group], .group_select'), id = row?.dataset.group ?? row?.dataset.grid ?? row?.getAttribute('grid');
    const src = img.getAttribute('src');
    const group = id ? ctx.groups?.find(g => String(g.id) === String(id)) : img.closest('#group_avatar_preview') ? ctx.groups?.find(g => g.avatar_url === src) : null;
    return group?.silly_teyvat_journey?.source?.avatar || null;
}
// Whose avatar this is: a character card, or a persona, which shows the card it plays as.
function cardOf(img, src, ctx) {
    const persona = thumbFile(src, 'persona');
    if (persona) return {known: true, card: linkedCard(ctx, persona)};
    const file = thumbFile(src) || (src.startsWith('data:') ? journeyCard(img, ctx) : null);
    if (!file) return {known: false};
    // A journey the player began as a persona names the persona ("persona:File.png").
    if (typeof file === 'string' && file.startsWith('persona:') && !cardByAvatar(ctx, file)) return {known: true, card: linkedCard(ctx, file.slice('persona:'.length))};
    return {known: true, card: cardByAvatar(ctx, file)};
}
function apply(img, ctx) {
    if (img.closest('.mes')) { applyMessage(img, ctx); return; }
    const src = img.getAttribute('src') || '';
    // Already showing its card: the thumbnail it replaced says whose it is.
    const thumb = img.dataset.giUrl && src === img.dataset.giUrl ? img.dataset.giThumb : src;
    const found = cardOf(img, thumb, ctx);
    if (!found.known) { clear(img); return; }
    const art = found.card ? cardArtFor(ctx, found.card) : null;
    if (!art) {
        if (img.dataset.giUrl && src === img.dataset.giUrl) img.src = img.dataset.giThumb;
        delete img.dataset.giUrl; img.dataset.giThumb = thumb; mark(img, 'frame'); return;
    }
    img.dataset.giThumb = thumb; img.dataset.giUrl = art.url;
    mark(img, art.kind === 'tcg' ? 'tcg' : 'art');
    // Left until it is looked at: a closed drawer or the far end of a long list fetches nothing.
    if (src !== art.url) { img.loading = 'lazy'; img.src = art.url; }
}
// Chat avatars keep their native src: SillyTavern's zoom reads it, and other extensions rewrite it.
// The card is painted behind the invisible thumbnail instead. Review also lines up the player's own
// messages, using their linked card or a frame around their persona.
function applyMessage(img, ctx) {
    const src = img.getAttribute('src') || '', box = img.closest('.avatar');
    const persona = thumbFile(src, 'persona'), card = persona ? linkedCard(ctx, persona) : cardByAvatar(ctx, thumbFile(src));
    const art = card ? cardArtFor(ctx, card) : null;
    box.classList.toggle('gi-mes-card', Boolean(art)); box.classList.toggle('gi-mes-card-tcg', art?.kind === 'tcg');
    if (art) { box.style.setProperty('--gi-mes-card', `url("${art.url}")`); mark(img, null); box.classList.add('gi-card-art'); }
    else { box.style.removeProperty('--gi-mes-card'); mark(img, persona || thumbFile(src) ? 'frame' : null); }
}
function clear(img) {
    if (img.dataset.giUrl && img.getAttribute('src') === img.dataset.giUrl && img.dataset.giThumb) img.src = img.dataset.giThumb;
    delete img.dataset.giThumb; delete img.dataset.giUrl; mark(img, null);
}
// A card as the character list shows it, for menus SillyTavern does not draw.
export function cardPortrait(ctx, card) {
    const box = document.createElement('span'), img = document.createElement('img');
    box.className = 'avatar'; img.alt = ''; img.loading = 'lazy';
    img.src = `/thumbnail?type=avatar&file=${encodeURIComponent(card.avatar)}`;
    box.append(img); apply(img, ctx); return box;
}

export function mountCardArt({getContext, root = document}) {
    let frame = 0;
    function scan() { frame = 0; const ctx = getContext(); for (const img of root.querySelectorAll(TARGETS)) apply(img, ctx); }
    const queue = () => { if (!frame) frame = requestAnimationFrame(scan); };
    const observer = new MutationObserver(queue);
    const panel = root.querySelector('#right-nav-panel') || root.body;
    if (panel) observer.observe(panel, {childList: true, subtree: true, attributes: true, attributeFilter: ['src']});
    const personas = root.querySelector('#persona-management-block');
    if (personas && personas !== panel) observer.observe(personas, {childList: true, subtree: true, attributes: true, attributeFilter: ['src']});
    // The chat streams constantly; only react when the welcome screen's Recent Chats change, or, while every message
    // shows its avatar (Review, the classic chat), when elements arrive outside a message's text. A reply being
    // written changes only its text, timer and token count, and a scan reads every avatar in the page.
    const chat = root.querySelector('#chat');
    const element = node => node.nodeType === 1;
    const recent = new MutationObserver(list => {
        const everyMessage = document.body.classList.contains('gi-history') || document.body.classList.contains('gi-classic');
        if (list.some(m => everyMessage && !m.target.closest?.('.mes_text, .mes_reasoning') && [...m.addedNodes].some(element)
            || m.target.closest?.('.recentChatList') || [...m.addedNodes].some(n => element(n) && (n.matches('.recentChat, .recentChatList') || n.querySelector('.recentChat'))))) queue();
    });
    if (chat) recent.observe(chat, {childList: true, subtree: true});
    let disposed = false;
    // The game's own card art is listed in a file that may arrive after the lists are drawn.
    cardArtReady.then(() => { if (!disposed) scan(); });
    document.body.classList.add('gi-card-art-on'); scan();
    return {
        // Called after a card's art is set or removed in its Profile.
        refresh: scan,
        dispose() {
            disposed = true; observer.disconnect(); recent.disconnect(); cancelAnimationFrame(frame);
            for (const img of root.querySelectorAll(`${TARGETS}, img[data-gi-thumb]`)) clear(img);
            for (const box of root.querySelectorAll('.avatar.gi-mes-card')) { box.classList.remove('gi-mes-card', 'gi-mes-card-tcg', 'gi-card-art'); box.style.removeProperty('--gi-mes-card'); }
            document.body.classList.remove('gi-card-art-on');
        },
    };
}
