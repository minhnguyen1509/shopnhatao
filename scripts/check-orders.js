// In thông tin tối thiểu (không có tên/SĐT khách) của các đơn gần nhất để kiểm tra
const R = (m) => require(require.resolve(m, { paths: [__dirname + '/../functions'] }));
const { initializeApp, cert } = R('firebase-admin/app');
const { getFirestore } = R('firebase-admin/firestore');
initializeApp({ credential: cert(require(process.env.GOOGLE_APPLICATION_CREDENTIALS)) });
const db = getFirestore();
(async () => {
  const s = await db.collection('orders').get();
  const L = s.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (b.imported || b.createdAt || 0) - (a.imported || a.createdAt || 0)).slice(0, 15);
  const iso = (t) => (t ? new Date(t + 7 * 3600e3).toISOString().slice(0, 16).replace('T', ' ') : String(t));
  console.log('Tổng số đơn:', s.size);
  L.forEach((o) => console.log([o.id.slice(0, 14), o.source, o.status, 'doneAt=' + iso(o.doneAt), 'created=' + iso(o.createdAt), 'imported=' + iso(o.imported), 'total=' + o.total, 'items=' + (o.items || []).length, 'prices=' + (o.items || []).map((i) => i.price).join('/')].join(' | ')));
})().catch((e) => { console.error(e); process.exit(1); });
