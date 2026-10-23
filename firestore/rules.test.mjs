// ============================================================
// Tests für die Firestore-Regeln (Clips + Schach-Profil)
// ============================================================
// Läuft gegen den Firestore-Emulator, nicht gegen die echte Datenbank:
//   cd firestore && npm ci && npm test
// Auf GitHub laufen die Tests automatisch, bevor die Regeln veröffentlicht
// werden (.github/workflows/firestore-rules.yml).
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';
import { arrayUnion, arrayRemove, doc, setDoc, getDoc, updateDoc, deleteDoc, writeBatch, increment, serverTimestamp, collection, getDocs, Bytes } from 'firebase/firestore';

const env = await initializeTestEnvironment({ projectId: 'demo-clips', firestore: { rules: readFileSync(new URL('../web/boersentycoon/firestore.rules', import.meta.url), 'utf8'), host: '127.0.0.1', port: 8080 } });
const ADMIN = 'stark.liam2011@gmail.com';
const db = (uid, email) => env.authenticatedContext(uid, { email }).firestore();
const admin = db('admin', ADMIN), anna = db('anna', 'anna@x.de'), ben = db('ben', 'ben@x.de'), eve = db('eve', 'eve@x.de');

const key = (n) => n.replace(/[A-Z]+/g, c => c.toLowerCase());
const joinB = (d, uid, name, code, extraNameDoc = true) => {
  const b = writeBatch(d);
  if (extraNameDoc) b.set(doc(d, 'clipsNames/' + key(name)), { uid });
  const m = { name, nameKey: key(name), joinedAt: serverTimestamp() };
  if (code) m.code = code;
  b.set(doc(d, 'clipsMembers/' + uid), m);
  return b.commit();
};
let n = 0;
async function t(name, p, ok) { n++; try { await (ok ? assertSucceeds(p) : assertFails(p)); console.log('ok  ', name); } catch (e) { console.log('FAIL', name, e.message); process.exitCode = 1; } }

await t('unauthenticated cannot join', joinB(env.unauthenticatedContext().firestore(), 'nobody', 'Nobody'), false);
await t('admin cannot join without name claim', setDoc(doc(admin, 'clipsMembers/admin'), { name: 'Admin', nameKey: 'admin', joinedAt: serverTimestamp() }), false);
await t('admin joins', joinB(admin, 'admin', 'Admin'), true);
await t('extra code field rejected', joinB(anna, 'anna', 'Anna', 'ABCDEFGH'), false);
await t('anna joins without code', joinB(anna, 'anna', 'Anna'), true);
await t('ben cannot take ANNA', joinB(ben, 'ben', 'ANNA'), false);
await t('ben cannot reserve a name alone', setDoc(doc(ben, 'clipsNames/zzz'), { uid: 'ben' }), false);
await t('ben joins (umlaut)', joinB(ben, 'ben', 'BÖRG'), true);
await t('ben name key lowercased', getDoc(doc(ben, 'clipsNames/bÖrg')).then(d => { if (d.data().uid !== 'ben') throw new Error('x'); }), true);
await t('anna cannot join as someone else', joinB(anna, 'xx', 'Fake'), false);
await t('anna cannot read ban list', getDocs(collection(anna, 'clipsBanned')), false);
await t('anna cannot ban', setDoc(doc(anna, 'clipsBanned/ben'), { name: 'x', at: serverTimestamp() }), false);
await t('eve cannot list members', getDocs(collection(eve, 'clipsMembers')), false);
await t('anna lists members', getDocs(collection(anna, 'clipsMembers')), true);
await t('anna cannot rename without claim', updateDoc(doc(anna, 'clipsMembers/anna'), { name: 'Anni', nameKey: 'anni' }), false);
await t('anna cannot rename to ben name', (() => { const b = writeBatch(anna); b.update(doc(anna, 'clipsMembers/anna'), { name: 'BÖRG', nameKey: 'bÖrg' }); return b.commit(); })(), false);
await t('anna cannot delete ben name', deleteDoc(doc(anna, 'clipsNames/bÖrg')), false);
await t('anna cannot release own name while using it', deleteDoc(doc(anna, 'clipsNames/anna')), false);
await t('anna renames', (() => { const b = writeBatch(anna); b.set(doc(anna, 'clipsNames/anni'), { uid: 'anna' }); b.delete(doc(anna, 'clipsNames/anna')); b.update(doc(anna, 'clipsMembers/anna'), { name: 'Anni', nameKey: 'anni' }); return b.commit(); })(), true);
await t('anna changes casing only', updateDoc(doc(anna, 'clipsMembers/anna'), { name: 'ANNI' }), true);
await t('anna casing with key', updateDoc(doc(anna, 'clipsMembers/anna'), { name: 'ANNI', nameKey: 'anni' }), true);
await t('name with slash rejected', (() => { const b = writeBatch(anna); b.set(doc(anna, 'clipsNames/a b'), { uid: 'anna' }); b.update(doc(anna, 'clipsMembers/anna'), { name: 'a/b', nameKey: 'a b' }); return b.commit(); })(), false);
await t('anna sets photo', updateDoc(doc(anna, 'clipsMembers/anna'), { photo: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==' }), true);
await t('anna bad photo', updateDoc(doc(anna, 'clipsMembers/anna'), { photo: 'javascript:alert(1)' }), false);
await t('anna huge photo', updateDoc(doc(anna, 'clipsMembers/anna'), { photo: 'data:image/jpeg;base64,' + 'A'.repeat(90000) }), false);
await t('anna removes photo', updateDoc(doc(anna, 'clipsMembers/anna'), { photo: null }), true);
await env.withSecurityRulesDisabled(c => setDoc(doc(c.firestore(), 'clipsMembers/old'), { name: 'Oldie', code: 'ABCDEFGH' }));
const old = db('old', 'old@x.de');
await t('legacy member photo without name', updateDoc(doc(old, 'clipsMembers/old'), { photo: null }), true);
await t('legacy member migrates name', (() => { const b = writeBatch(old); b.set(doc(old, 'clipsNames/oldie'), { uid: 'old' }); b.update(doc(old, 'clipsMembers/old'), { name: 'Oldie', nameKey: 'oldie' }); return b.commit(); })(), true);
await t('anna cannot rename ben', updateDoc(doc(anna, 'clipsMembers/ben'), { photo: null }), false);

const vid = (o = {}) => ({ owner: 'anna', caption: 'hi', type: 'video/mp4', size: 10, chunks: 1, duration: 3, thumb: null, likes: 0, comments: 0, ready: false, createdAt: serverTimestamp(), ...o });
await t('eve cannot post', setDoc(doc(eve, 'clipsVideos/v0'), vid({ owner: 'eve' })), false);
await t('anna cannot post as ben', setDoc(doc(anna, 'clipsVideos/v0'), vid({ owner: 'ben' })), false);
await t('anna cannot post with likes', setDoc(doc(anna, 'clipsVideos/v0'), vid({ likes: 5 })), false);
await t('anna posts', setDoc(doc(anna, 'clipsVideos/v1'), vid()), true);
await t('ben cannot add chunk', setDoc(doc(ben, 'clipsVideos/v1/chunks/00'), { data: Bytes.fromUint8Array(new Uint8Array(10)) }), false);
await t('anna adds chunk', setDoc(doc(anna, 'clipsVideos/v1/chunks/00'), { data: Bytes.fromUint8Array(new Uint8Array(900 * 1024)) }), true);
await t('anna cannot add huge chunk', setDoc(doc(anna, 'clipsVideos/v1/chunks/01'), { data: Bytes.fromUint8Array(new Uint8Array(1000000)) }), false);
await t('ben cannot set ready', updateDoc(doc(ben, 'clipsVideos/v1'), { ready: true }), false);
await t('anna sets ready', updateDoc(doc(anna, 'clipsVideos/v1'), { ready: true }), true);
await t('anna cannot add chunk after ready', setDoc(doc(anna, 'clipsVideos/v1/chunks/01'), { data: Bytes.fromUint8Array(new Uint8Array(10)) }), false);
await t('anna cannot fake likes', updateDoc(doc(anna, 'clipsVideos/v1'), { likes: 100 }), false);
await t('ben reads chunk', getDoc(doc(ben, 'clipsVideos/v1/chunks/00')), true);
await t('eve cannot read video', getDoc(doc(eve, 'clipsVideos/v1')), false);
await t('eve cannot read chunk', getDoc(doc(eve, 'clipsVideos/v1/chunks/00')), false);

const like = (d, uid, add) => { const b = writeBatch(d); const r = doc(d, 'clipsVideos/v1'); if (add) b.set(doc(d, `clipsVideos/v1/likes/${uid}`), { at: serverTimestamp() }); else b.delete(doc(d, `clipsVideos/v1/likes/${uid}`)); b.update(r, { likes: increment(add ? 1 : -1) }); return b.commit(); };
await t('ben likes', like(ben, 'ben', true), true);
await t('ben cannot like twice', like(ben, 'ben', true), false);
await t('ben cannot bump counter alone', updateDoc(doc(ben, 'clipsVideos/v1'), { likes: increment(1) }), false);
await t('ben cannot like as anna', like(ben, 'anna', true), false);
await t('ben unlikes', like(ben, 'ben', false), true);
await t('ben likes again', like(ben, 'ben', true), true);
await t('eve cannot like', like(eve, 'eve', true), false);

const cm = (d, uid) => { const b = writeBatch(d); const r = doc(d, 'clipsVideos/v1'); b.set(doc(collection(d, 'clipsVideos/v1/comments'), 'c-' + uid + (n)), { uid, text: 'cool', createdAt: serverTimestamp() }); b.update(r, { comments: increment(1) }); return b.commit(); };
await t('ben comments', cm(ben, 'ben'), true);
await t('ben cannot comment as anna', cm(ben, 'anna'), false);
await t('eve cannot comment', cm(eve, 'eve'), false);
const cs = await getDocs(collection(ben, 'clipsVideos/v1/comments'));
const cid = cs.docs[0].id;
{ const b = writeBatch(anna); b.delete(doc(anna, 'clipsVideos/v1/comments/' + cid)); b.update(doc(anna, 'clipsVideos/v1'), { comments: increment(-1) }); await t('owner deletes comment', b.commit(), true); }

await t('ben cannot delete video', deleteDoc(doc(ben, 'clipsVideos/v1')), false);
{ const b = writeBatch(anna); b.delete(doc(anna, 'clipsVideos/v1/chunks/00')); b.delete(doc(anna, 'clipsVideos/v1/likes/ben')); await t('anna cleans up children', b.commit(), true); }
await t('anna deletes video', deleteDoc(doc(anna, 'clipsVideos/v1')), true);

await t('ben cannot kick anna', deleteDoc(doc(ben, 'clipsMembers/anna')), false);
await t('admin kicks + bans ben', (() => { const b = writeBatch(admin); b.delete(doc(admin, 'clipsMembers/ben')); b.delete(doc(admin, 'clipsNames/bÖrg')); b.set(doc(admin, 'clipsBanned/ben'), { name: 'BÖRG', at: serverTimestamp() }); return b.commit(); })(), true);
await t('ben reads own ban', getDoc(doc(ben, 'clipsBanned/ben')), true);
await t('ben cannot unban himself', deleteDoc(doc(ben, 'clipsBanned/ben')), false);
await t('admin lists bans', getDocs(collection(admin, 'clipsBanned')), true);
await t('name free again', joinB(anna, 'anna', 'x', null, false).catch(() => {}).then(() => getDoc(doc(anna, 'clipsNames/bÖrg'))).then(d => { if (d.exists()) throw new Error('still there'); }), true);
await t('kicked ben cannot read', getDocs(collection(ben, 'clipsVideos')), false);
await t('banned ben cannot rejoin', joinB(ben, 'ben', 'Ben'), false);
await t('admin unbans ben', deleteDoc(doc(admin, 'clipsBanned/ben')), true);
await t('ben rejoins after unban', joinB(ben, 'ben', 'Ben'), true);
await t('eve (new account) joins', joinB(eve, 'eve', 'Eve'), true);
await t('300 chunks ok', setDoc(doc(anna, 'clipsVideos/v40'), vid({ chunks: 300 })), true);
await t('chunk 150 ok', setDoc(doc(anna, 'clipsVideos/v40/chunks/150'), { data: Bytes.fromUint8Array(new Uint8Array(10)) }), true);
await t('chunk 1000 rejected', setDoc(doc(anna, 'clipsVideos/v40/chunks/1000'), { data: Bytes.fromUint8Array(new Uint8Array(10)) }), false);
await t('301 chunks rejected', setDoc(doc(anna, 'clipsVideos/v41'), vid({ chunks: 301 })), false);
// existing chess rules still fine
await t('chess profile write own', setDoc(doc(ben, 'chessProfiles/ben'), { name: 'Ben', friendCode: 'AAAAAA' }), true);
await t('anna writes own seen', setDoc(doc(anna, 'clipsSeen/anna'), { ids: { v1: 123 } }, { merge: true }), true);
await t('anna reads own seen', getDoc(doc(anna, 'clipsSeen/anna')), true);
await t('admin cannot read anna seen', getDoc(doc(admin, 'clipsSeen/anna')), false);
await t('ben cannot write anna seen', setDoc(doc(ben, 'clipsSeen/anna'), { ids: {} }), false);
await t('seen extra field rejected', setDoc(doc(anna, 'clipsSeen/anna'), { ids: {}, x: 1 }), false);
await t('anna follows admin', updateDoc(doc(anna, 'clipsMembers/anna'), { following: arrayUnion('admin') }), true);
await t('anna unfollows admin', updateDoc(doc(anna, 'clipsMembers/anna'), { following: arrayRemove('admin') }), true);
await t('anna cannot edit admin following', updateDoc(doc(anna, 'clipsMembers/admin'), { following: ['anna'] }), false);
await t('following must be list', updateDoc(doc(anna, 'clipsMembers/anna'), { following: 'x' }), false);
await t('following max 500', updateDoc(doc(anna, 'clipsMembers/anna'), { following: Array.from({ length: 501 }, (_, i) => 'u' + i) }), false);
const link = (o = {}) => ({ owner: 'anna', caption: 'yt', kind: 'link', provider: 'youtube', embedId: 'dQw4w9WgXcQ', url: 'https://youtu.be/dQw4w9WgXcQ', thumb: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg', chunks: 0, likes: 0, comments: 0, ready: true, createdAt: serverTimestamp(), ...o });
await t('anna posts youtube link', setDoc(doc(anna, 'clipsVideos/l1'), link()), true);
await t('anna posts tiktok link', setDoc(doc(anna, 'clipsVideos/l2'), link({ provider: 'tiktok', embedId: '6718335390845095173' })), true);
await t('link bad provider', setDoc(doc(anna, 'clipsVideos/l3'), link({ provider: 'vimeo' })), false);
await t('link bad id', setDoc(doc(anna, 'clipsVideos/l4'), link({ embedId: '../x' })), false);
await t('link with chunks', setDoc(doc(anna, 'clipsVideos/l5'), link({ chunks: 3 })), false);
await t('link not ready', setDoc(doc(anna, 'clipsVideos/l6'), link({ ready: false })), false);
await t('link as other owner', setDoc(doc(anna, 'clipsVideos/l7'), link({ owner: 'admin' })), false);
await t('link with likes', setDoc(doc(anna, 'clipsVideos/l8'), link({ likes: 5 })), false);
await t('no chunks into link video', setDoc(doc(anna, 'clipsVideos/l1/chunks/00'), { data: Bytes.fromUint8Array(new Uint8Array(10)) }), false);
await t('admin likes link video', (() => { const b = writeBatch(admin); b.set(doc(admin, 'clipsVideos/l1/likes/admin'), { at: serverTimestamp() }); b.update(doc(admin, 'clipsVideos/l1'), { likes: increment(1) }); return b.commit(); })(), true);
await t('anna deletes link video', (() => { const b = writeBatch(anna); b.delete(doc(anna, 'clipsVideos/l1/likes/admin')); return b.commit().then(() => deleteDoc(doc(anna, 'clipsVideos/l1'))); })(), true);
await env.withSecurityRulesDisabled(c => setDoc(doc(c.firestore(), 'clipsVideos/r1'), { owner: 'anna', caption: 'x', ready: true, chunks: 1, likes: 0, comments: 0 }));
const rep = (d, uid, reason = 'nsfw', vid = 'r1') => { const b = writeBatch(d); b.set(doc(d, `clipsReports/${vid}_${uid}`), { videoId: vid, owner: 'anna', reporter: uid, reason, at: serverTimestamp() }); b.update(doc(d, 'clipsVideos/' + vid), { reports: increment(1) }); return b.commit(); };
await t('admin reports video', rep(admin, 'admin'), true);
await t('cannot report twice', rep(admin, 'admin'), false);
await t('report needs counter', setDoc(doc(eve, 'clipsReports/r1_eve'), { videoId: 'r1', owner: 'anna', reporter: 'eve', reason: 'nsfw', at: serverTimestamp() }), false);
await t('counter needs report', updateDoc(doc(eve, 'clipsVideos/r1'), { reports: increment(1) }), false);
await t('report as other user', (() => { const b = writeBatch(eve); b.set(doc(eve, 'clipsReports/r1_ben'), { videoId: 'r1', owner: 'anna', reporter: 'ben', reason: 'nsfw', at: serverTimestamp() }); b.update(doc(eve, 'clipsVideos/r1'), { reports: increment(1) }); return b.commit(); })(), false);
await t('bad reason', rep(eve, 'eve', 'spam'), false);
await t('eve reports', rep(eve, 'eve', 'violence'), true);
await t('eve cannot read reports', getDoc(doc(eve, 'clipsReports/r1_eve')), false);
await t('owner cannot reset reports', updateDoc(doc(anna, 'clipsVideos/r1'), { reports: 0 }), false);
await t('eve cannot delete report', deleteDoc(doc(eve, 'clipsReports/r1_eve')), false);
await t('admin reads reports', getDocs(collection(admin, 'clipsReports')), true);
await t('admin approves (reset + delete)', (() => { const b = writeBatch(admin); b.delete(doc(admin, 'clipsReports/r1_eve')); b.delete(doc(admin, 'clipsReports/r1_admin')); b.update(doc(admin, 'clipsVideos/r1'), { reports: 0 }); return b.commit(); })(), true);
await t('admin cannot set reports to 5', updateDoc(doc(admin, 'clipsVideos/r1'), { reports: 5 }), false);
await env.cleanup();
console.log(process.exitCode ? `\nFehlgeschlagen (${n} Tests)` : `\nAlle ${n} Tests bestanden.`);
