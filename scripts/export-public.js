// Xuất dữ liệu công khai (không có giá nhập) để làm bản xem trước
const R = (m) => require(require.resolve(m, { paths: [__dirname + '/../functions'] }));
const { initializeApp, cert } = R('firebase-admin/app');
const { getFirestore } = R('firebase-admin/firestore');
initializeApp({ credential: cert(require(process.env.GOOGLE_APPLICATION_CREDENTIALS)) });
const db = getFirestore();
(async () => {
  const out = {};
  for (const c of ['inventory', 'accessories', 'services', 'photos', 'settings']) {
    const s = await db.collection(c).get();
    out[c] = s.docs.map((d) => ({ id: d.id, ...d.data() }));
    if (c === 'inventory') out[c].forEach((x) => { delete x.costPrice; delete x.source; });
    if (c === 'accessories') out[c].forEach((x) => { delete x.cost; });
  }
  require('fs').writeFileSync('public-data.json', JSON.stringify(out));
  console.log(Object.entries(out).map(([k, v]) => k + ':' + v.length).join(' '));
})().catch((e) => { console.error(e); process.exit(1); });
