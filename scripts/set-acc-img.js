// Gắn ảnh nhóm cho phụ kiện theo tiền tố tên (chỉ gắn cho món chưa có ảnh)
const R = (m) => require(require.resolve(m, { paths: [__dirname + '/../functions'] }));
const { initializeApp, cert } = R('firebase-admin/app');
const { getFirestore } = R('firebase-admin/firestore');
const map = require('./acc-img.json');
initializeApp({ credential: cert(require(process.env.GOOGLE_APPLICATION_CREDENTIALS)) });
const db = getFirestore();
(async () => {
  const snap = await db.collection('accessories').get();
  let set = 0, had = 0, none = [];
  const batch = db.batch();
  snap.forEach((d) => {
    const a = d.data(); const name = String(a.name || '').trim();
    const m = map.find((x) => name.startsWith(x.prefix));
    if (!m) { none.push(name); return; }
    if ((Array.isArray(a.imgs) && a.imgs.length) || a.img) { had++; return; }
    batch.update(d.ref, { imgs: [m.img], img: '' }); set++;
  });
  if (set) await batch.commit();
  console.log(`Tổng ${snap.size} phụ kiện · gắn ảnh ${set} · đã có ảnh sẵn ${had} · không có ảnh nhóm ${none.length}`);
  console.log('Không có ảnh nhóm:', none.join(' | '));
})().catch((e) => { console.error(e); process.exit(1); });
