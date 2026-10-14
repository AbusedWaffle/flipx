// Rangliste mod Firebase. Kun denne telefons players/{uid} skrives.
// Hver enhed logger anonymt ind og får et stabilt uid. Tallene gemmes automatisk ved spillets slut.
// Tests (headless/webdriver eller ?nofb=1) må aldrig skrive til den rigtige rangliste.
// Så bruges en lokal mock, og Firebase indlæses slet ikke.
let noFb = false;
try { noFb = !!navigator.webdriver || new URLSearchParams(location.search).has('nofb'); } catch (e) {}
const mock = window.__FLIPX_MOCK || (noFb ? (window.__FLIPX_MOCK = { uid: 'test-uid', players: [], writes: [], offline: true }) : null);
window.flipNoFb = noFb;
let initializeApp, getAuth, signInAnonymously, setPersistence, browserLocalPersistence;
let getFirestore, doc, getDoc, setDoc, serverTimestamp, collection, getDocs, firebaseConfig;
async function loadSdk() {
  const V = 'https://www.gstatic.com/firebasejs/12.19.0/';
  const [a, au, fs, cfg] = await Promise.all([
    import(V + 'firebase-app.js'), import(V + 'firebase-auth.js'), import(V + 'firebase-firestore.js'), import('./firebase-config.js')
  ]);
  ({ initializeApp } = a);
  ({ getAuth, signInAnonymously, setPersistence, browserLocalPersistence } = au);
  ({ getFirestore, doc, getDoc, setDoc, serverTimestamp, collection, getDocs } = fs);
  ({ firebaseConfig } = cfg);
}
const G = window.EnTil;
let db = null;
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
    const uid = mock.uid == null ? 'mock-uid' : String(mock.uid);
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
    window.flipUid = user.uid;
    try { localStorage.setItem('f7o-uid', JSON.stringify(user.uid)); } catch (e) {}
    return user.uid;
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

// Gem ét afsluttet spil. pend = ventende tællere (inkl. dette spil). Først skrives alt (navn, spil, sejre og tællere).
// Afviser reglerne tællerne (før de nye regler er publiceret), skrives den gamle form (kun navn, spil, sejre) med de
// SAMME tal, beregnet ud fra den SAMME læsning – så spil/sejre tælles aldrig dobbelt, og tællerne venter lokalt.
async function record(uid, name, won, pend) {
  await ready;
  if (!uid || uid !== window.flipUid) throw new Error('kan kun skrive egen række');
  if (!mock && (!auth || !auth.currentUser || auth.currentUser.uid !== uid)) throw new Error('kan kun skrive egen række');
  const E = window.EnTil;
  const prev = mock
    ? ((mock.players || []).find(p => p.id === uid) || { games: 0, wins: 0, name: '' })
    : await (async () => {
      const snap = await getDoc(doc(db, 'players', uid));
      return snap.exists() ? snap.data() : { games: 0, wins: 0, name: '' };
    })();
  const next = E.nextCareer(prev, !!won, name);
  if (!next.name) throw new Error('tomt navn');
  const ap = E.applyCounters(prev, pend || {}, !!won);
  const keep = Array.isArray(prev.badges) ? prev.badges.slice(0, 20) : null; // gammelt felt (v21) – må ikke forsvinde
  const full = Object.assign({ name: next.name, games: next.games, wins: next.wins }, ap.counters);
  const legacy = { name: next.name, games: next.games, wins: next.wins };
  E.COUNTERS.forEach(f => { if (f in prev) legacy[f] = prev[f] | 0; }); // gemte tællere røres ikke
  if (keep) { full.badges = keep; legacy.badges = keep; }
  const write = async data => {
    if (mock) {
      mock.writes = mock.writes || [];
      if (mock.legacyRules && E.COUNTERS.some(f => f in data)) { const e = new Error('permission-denied'); e.code = 'permission-denied'; throw e; }
      mock.writes.push(Object.assign({ uid: uid, won: !!won }, data));
      let row = (mock.players || []).find(p => p.id === uid);
      if (!row) { row = { id: uid }; mock.players.push(row); }
      E.COUNTERS.forEach(f => { delete row[f]; });
      Object.assign(row, data);
      return;
    }
    await setDoc(doc(db, 'players', uid), Object.assign({}, data, { updatedAt: serverTimestamp() }));
  };
  try {
    await write(full);
    return Object.assign({ legacy: false, rest: ap.rest }, full);
  } catch (e) {
    if (!(e && /permission/.test(String(e.code || e.message)))) throw e;
    await write(legacy);
    return Object.assign({ legacy: true, rest: pend || {} }, legacy);
  }
}

window.FlipLive = { ready: ready, loadBoard: loadBoard, loadPlayers: loadPlayers, record: record };
ready.then(uid => {
  if (uid) { if (window.onFlipUid) window.onFlipUid(uid); }
  else if (window.onFlipNoProfile) window.onFlipNoProfile();
}).catch(e => {
  try { console.warn('FlipX rangliste:', e && e.code ? e.code : 'init'); } catch (err) {}
  if (window.onFlipBoardFail) window.onFlipBoardFail();
});
