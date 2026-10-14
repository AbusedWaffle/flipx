// Rangliste mod Firebase. Kun denne telefons players/{uid} skrives.
// Hver enhed logger anonymt ind og får et stabilt uid. Tallene gemmes automatisk ved spillets slut.
// Tests (headless/webdriver eller ?nofb=1) må aldrig skrive til den rigtige rangliste.
// Så bruges en lokal mock, og Firebase indlæses slet ikke.
let noFb = false;
try { noFb = !!navigator.webdriver || new URLSearchParams(location.search).has('nofb'); } catch (e) {}
const mock = window.__FLIPX_MOCK || (noFb ? (window.__FLIPX_MOCK = { uid: 'test-uid', players: [], writes: [], offline: true }) : null);
window.flipNoFb = noFb;
let initializeApp, getAuth, signInAnonymously, setPersistence, browserLocalPersistence;
let getFirestore, doc, getDoc, setDoc, serverTimestamp, collection, getDocs, writeBatch, firebaseConfig;
async function loadSdk() {
  const V = 'https://www.gstatic.com/firebasejs/12.19.0/';
  const [a, au, fs, cfg] = await Promise.all([
    import(V + 'firebase-app.js'), import(V + 'firebase-auth.js'), import(V + 'firebase-firestore.js'), import('./firebase-config.js')
  ]);
  ({ initializeApp } = a);
  ({ getAuth, signInAnonymously, setPersistence, browserLocalPersistence } = au);
  ({ getFirestore, doc, getDoc, setDoc, serverTimestamp, collection, getDocs, writeBatch } = fs);
  ({ firebaseConfig } = cfg);
}
const G = window.EnTil;
let db = null;
let authUid = '';
let auth = null;

function cleanBadges(b) { return Array.isArray(b) ? b.filter(k => typeof k === 'string' && /^[a-z0-9]{1,16}$/.test(k)).slice(0, 20) : []; }
function rowOf(id, data) {
  const x = data || {};
  const r = { id: id, name: String(x.name || '').trim(), games: x.games | 0, wins: x.wins | 0 };
  (window.EnTil.COUNTERS || []).forEach(f => { r[f] = Math.max(0, x[f] | 0); });
  return r;
}

// Gamle kodeord-versioner gemte en nøgle her. Den slettes og bruges aldrig.
try { localStorage.removeItem('f7o-kodeord'); } catch (e) {}

function noteFail(e) {
  try { console.warn('FlipX enhed:', (e && e.code) || 'fejl'); } catch (err) {}
  window.flipSaveFail = true;
}

const ready = (async () => {
  if (mock) {
    authUid = mock.uid == null ? 'mock-uid' : String(mock.uid);
    const uid = authUid ? ((mock.links || {})[authUid] || authUid) : '';
    window.flipUid = uid;
    if (!uid) window.flipSaveFail = true;
    if (uid) { try { localStorage.setItem('f7o-uid', JSON.stringify(uid)); } catch (e) {} }
    return uid;
  }
  try { await loadSdk(); } catch (e) { window.flipUid = ''; noteFail(e); return ''; }
  const app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
  try { await setPersistence(auth, browserLocalPersistence); } catch (e) {}
  try {
    await auth.authStateReady();
    // Er enheden stadig logget ind fra den gamle kodeord-version, beholdes det uid, så historikken fortsætter.
    const user = auth.currentUser || (await signInAnonymously(auth)).user;
    authUid = user.uid;
    const prof = await linkedProfile(user.uid);
    window.flipUid = prof;
    try { localStorage.setItem('f7o-uid', JSON.stringify(prof)); } catch (e) {}
    return prof;
  } catch (e) {
    window.flipUid = '';
    noteFail(e);
    return '';
  }
})();

async function loadBoard() {
  await ready;
  if (mock) return (mock.players || []).map(p => rowOf(p.id, p));
  if (!db) throw new Error('ingen database');
  const snap = await getDocs(collection(db, 'players'));
  const rows = [];
  snap.forEach(d => rows.push(rowOf(d.id, d.data())));
  return rows;
}

async function loadPlayers(uids) {
  await ready;
  const out = {};
  const list = (uids || []).filter(Boolean);
  if (mock) {
    list.forEach(u => {
      const p = (mock.players || []).find(x => x.id === u);
      if (p) out[u] = rowOf(u, p);
    });
    return out;
  }
  if (!db) throw new Error('ingen database');
  await Promise.all(list.map(async u => {
    const snap = await getDoc(doc(db, 'players', u));
    if (snap.exists()) {
      const r = rowOf(u, snap.data());
      out[u] = r;
    }
  }));
  return out;
}

// ---------- gendannelseskode ----------
// Profilen (players/{uid}) tilhører det anonyme uid, der oprettede den. Et andet anonymt uid (ny browser/enhed)
// kan overtage den med koden: recovery/{sha256(kode)} = {uid: profil}, links/{nyt uid} = {uid: profil, h}.
// Reglerne lader et linket uid skrive som profilen. Koden gemmes aldrig i klartekst i Firestore.
async function linkedProfile(au) {
  try { const s = await getDoc(doc(db, 'links', au)); if (s.exists() && s.data().uid) return String(s.data().uid); } catch (e) {}
  return au;
}
const ALPH = 'ABCDEFGHJKMNPQRSTVWXYZ23456789'; // uden 0/O/1/I/L/U
function normCode(c) { return String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
function fmtCode(c) { return normCode(c).replace(/(.{4})(?=.)/g, '$1-'); }
async function codeHash(c) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('flipx:' + normCode(c)));
  return Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2, '0')).join('');
}
// Vis/lav kode for denne profil (16 tegn ≈ 78 bit). Gemmes lokalt pr. profil; recovery-dokumentet skrives én gang.
async function recoveryCode() {
  await ready;
  const uid = window.flipUid; if (!uid) throw new Error('ingen profil');
  const lk = 'f7o-rec-' + uid;
  let c = null; try { c = JSON.parse(localStorage.getItem(lk) || 'null'); } catch (e) {}
  if (c && c.saved) return fmtCode(c.code);
  if (!c) { const r = crypto.getRandomValues(new Uint32Array(16)); c = { code: Array.from(r).map(x => ALPH[x % ALPH.length]).join(''), saved: false }; }
  try { localStorage.setItem(lk, JSON.stringify(c)); } catch (e) {}
  const h = await codeHash(c.code);
  if (mock) { if (mock.noNames) throw Object.assign(new Error('permission-denied'), { code: 'permission-denied' }); (mock.recovery = mock.recovery || {})[h] = { uid: uid }; }
  else await setDoc(doc(db, 'recovery', h), { uid: uid });
  c.saved = true; try { localStorage.setItem(lk, JSON.stringify(c)); } catch (e) {}
  return fmtCode(c.code);
}
// Indtast kode: overtag profilen. Returnerer profilens uid; kaster 'ugyldig' hvis koden ikke findes.
async function redeemCode(code) {
  await ready;
  if (normCode(code).length !== 16) throw new Error('ugyldig');
  const h = await codeHash(code);
  let owner = null;
  if (mock) owner = ((mock.recovery || {})[h] || {}).uid || null;
  else { const s = await getDoc(doc(db, 'recovery', h)); owner = s.exists() ? String(s.data().uid || '') : null; }
  if (!owner) throw new Error('ugyldig');
  if (owner !== authUid) {
    if (mock) (mock.links = mock.links || {})[authUid] = owner;
    else await setDoc(doc(db, 'links', authUid), { uid: owner, h: h });
  }
  window.flipUid = owner;
  try { localStorage.setItem('f7o-uid', JSON.stringify(owner)); localStorage.setItem('f7o-rec-' + owner, JSON.stringify({ code: normCode(code), saved: true })); } catch (e) {}
  return owner;
}
// Serverens navn for profilen (fx omdøbt i konsollen) – appen bruger det i stedet for det lokalt gemte.
async function serverName() {
  await ready;
  const uid = window.flipUid; if (!uid) return '';
  if (mock) { const p = (mock.players || []).find(x => x.id === uid); return p ? String(p.name || '') : ''; }
  try { const s = await getDoc(doc(db, 'players', uid)); return s.exists() ? String(s.data().name || '').trim() : ''; } catch (e) { return ''; }
}

// ---------- unikke navne (names/{nøgle} = {uid}) ----------
// Læsning af names afvises af de gamle regler (v2): så returneres undefined = "ukendt", og alt gemmes som før.
async function nameOwner(key) {
  if (!key) return null;
  if (mock) {
    if (mock.noNames) return undefined;
    const n = (mock.names || {})[key];
    return n ? n.uid : null;
  }
  try { const s = await getDoc(doc(db, 'names', key)); return s.exists() ? String(s.data().uid || '') : null; }
  catch (e) { return undefined; }
}
// Til UI: er navnet taget af et andet uid? (true/false; null = kan ikke tjekkes)
async function checkName(name) {
  await ready;
  const o = await nameOwner(window.EnTil.nameKey(name));
  if (o === undefined) return null;
  return !!o && o !== window.flipUid;
}

// Gem ét afsluttet spil. pend = ventende tællere (inkl. dette spil). Først skrives alt (navn, spil, sejre og tællere).
// Afviser reglerne tællerne (før de nye regler er publiceret), skrives den gamle form (kun navn, spil, sejre) med de
// SAMME tal, beregnet ud fra den SAMME læsning – så spil/sejre tælles aldrig dobbelt, og tællerne venter lokalt.
// Navne: ønsket navn gemmes kun, hvis det er ledigt (eller vores). Er det taget af en anden, beholdes det gamle navn
// (eller et ledigt "Navn 2" for en ny spiller), og resultatet får nameTaken, så appen kan bede om et andet navn.
// Kan names ikke bruges (gamle regler), gemmes som før uden navnetjek – statistikken må aldrig gå tabt pga. navne.
async function record(uid, name, won, pend) {
  await ready;
  if (!uid || uid !== window.flipUid) throw new Error('kan kun skrive egen række');
  if (!mock && (!auth || !auth.currentUser || auth.currentUser.uid !== authUid)) throw new Error('kan kun skrive egen række');
  const E = window.EnTil;
  const exists = mock ? !!(mock.players || []).find(p => p.id === uid) : null;
  let had = exists;
  const prev = mock
    ? ((mock.players || []).find(p => p.id === uid) || { games: 0, wins: 0, name: '' })
    : await (async () => {
      const snap = await getDoc(doc(db, 'players', uid));
      had = snap.exists();
      return had ? snap.data() : { games: 0, wins: 0, name: '' };
    })();
  const want = E.nextCareer(prev, !!won, name).name;
  if (!want) throw new Error('tomt navn');
  const oldName = had ? String(prev.name || '') : '';
  // ---- navnevalg ----
  let useName = want, claim = null, release = null, nameTaken = false, namesOk = true;
  const wk = E.nameKey(want), wo = await nameOwner(wk);
  if (wo === undefined) namesOk = false;
  else if (!wo || wo === uid) { if (!wo) claim = wk; }
  else {
    nameTaken = true;
    if (had && oldName) { useName = oldName; } // behold det gamle navn (overgang) – stats gemmes stadig
    else {
      for (let n = 2; n < 100 && !claim; n++) {
        const cand = (want.slice(0, 13) + ' ' + n), ck = E.nameKey(cand), co = await nameOwner(ck);
        if (!co || co === uid) { useName = cand; if (!co) claim = ck; }
      }
    }
    if (useName === oldName) { // gammelt navn: gør krav på det, hvis det er ledigt
      const ok = E.nameKey(oldName), oo = await nameOwner(ok);
      if (!oo) claim = ok;
    }
  }
  if (namesOk && had && oldName && E.nameKey(oldName) !== E.nameKey(useName)) {
    const ok = E.nameKey(oldName); if ((await nameOwner(ok)) === uid) release = ok;
  }
  const next = E.nextCareer(prev, !!won, useName);
  const ap = E.applyCounters(prev, pend || {}, !!won);
  const keep = Array.isArray(prev.badges) ? prev.badges.slice(0, 20) : null; // gammelt felt (v21) – må ikke forsvinde
  const full = Object.assign({ name: next.name, games: next.games, wins: next.wins }, ap.counters);
  const legacy = { name: next.name, games: next.games, wins: next.wins };
  E.COUNTERS.forEach(f => { if (f in prev) legacy[f] = prev[f] | 0; }); // gemte tællere røres ikke
  if (keep) { full.badges = keep; legacy.badges = keep; }
  const perm = e => e && /permission/.test(String(e.code || e.message));
  const write = async (data, withNames) => {
    if (mock) {
      mock.writes = mock.writes || [];
      if (mock.legacyRules && E.COUNTERS.some(f => f in data)) { const e = new Error('permission-denied'); e.code = 'permission-denied'; throw e; }
      if (withNames && (claim || release) && mock.noNames) { const e = new Error('permission-denied'); e.code = 'permission-denied'; throw e; }
      mock.writes.push(Object.assign({ uid: uid, won: !!won }, data));
      let row = (mock.players || []).find(p => p.id === uid);
      if (!row) { row = { id: uid }; mock.players.push(row); }
      E.COUNTERS.forEach(f => { delete row[f]; });
      Object.assign(row, data);
      if (withNames) { mock.names = mock.names || {}; if (release) delete mock.names[release]; if (claim) mock.names[claim] = { uid: uid }; }
      return;
    }
    const pdata = Object.assign({}, data, { updatedAt: serverTimestamp() });
    if (!withNames || (!claim && !release)) return setDoc(doc(db, 'players', uid), pdata);
    const b = writeBatch(db);
    b.set(doc(db, 'players', uid), pdata);
    if (claim) b.set(doc(db, 'names', claim), { uid: uid });
    if (release) b.delete(doc(db, 'names', release));
    await b.commit();
  };
  const attempt = async withNames => {
    try { await write(full, withNames); return Object.assign({ legacy: false, rest: ap.rest }, full); }
    catch (e) { if (!perm(e)) throw e; await write(legacy, withNames); return Object.assign({ legacy: true, rest: pend || {} }, legacy); }
  };
  let res;
  try { res = await attempt(namesOk); }
  catch (e) {
    if (!perm(e) || !namesOk || (!claim && !release)) throw e;
    // names-skrivningen afvist (fx regler uden names): gem som før, uden navnekrav
    res = await attempt(false);
  }
  if (nameTaken) { res.nameTaken = true; res.wanted = want; }
  return res;
}

window.FlipLive = { ready: ready, loadBoard: loadBoard, loadPlayers: loadPlayers, record: record, checkName: checkName, recoveryCode: recoveryCode, redeemCode: redeemCode, serverName: serverName };
ready.then(uid => {
  if (uid) { if (window.onFlipUid) window.onFlipUid(uid); }
  else if (window.onFlipNoProfile) window.onFlipNoProfile();
}).catch(e => {
  try { console.warn('FlipX rangliste:', e && e.code ? e.code : 'init'); } catch (err) {}
  if (window.onFlipBoardFail) window.onFlipBoardFail();
});
