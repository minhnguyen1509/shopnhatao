// Chẩn đoán lãi của đơn nhập (chỉ in số đếm và tỉ lệ, không in tên khách hay số tiền)
const R = (m) => require(require.resolve(m, { paths: [__dirname + '/../functions'] }));
const { initializeApp, cert } = R('firebase-admin/app');
const { getFirestore } = R('firebase-admin/firestore');
initializeApp({ credential: cert(require(process.env.GOOGLE_APPLICATION_CREDENTIALS)) });
const db = getFirestore();
(async () => {
  const [os, cs] = await Promise.all([db.collection('orders').get(), db.collection('costs').get()]);
  const cm = {}; cs.docs.forEach((d) => (cm[d.id] = d.data()));
  const st = { orders: os.size, imported: 0, items: 0, noCost: 0, costZero: 0, costGtPrice: 0, marginBuckets: {}, hhDocs: 0, hhBig: 0, months: {} };
  os.docs.forEach((d) => {
    const o = d.data(); if (o.source !== 'import') return; st.imported++;
    const mk = new Date((o.doneAt || 0) + 7 * 3600e3).toISOString().slice(0, 7); st.months[mk] = (st.months[mk] || 0) + 1;
    const ex = cm['ord-' + d.id]; if (ex) { st.hhDocs++; const hh = (ex.extra || []).reduce((s, x) => s + (+x.amount || 0), 0); if (hh > (+o.total || 0) * 0.5) st.hhBig++; }
    (o.items || []).forEach((it) => {
      st.items++;
      const c = it.kind === 'phone' ? cm['inv-' + it.refId] && cm['inv-' + it.refId].costPrice : cm['acc-' + it.refId] && cm['acc-' + it.refId].cost;
      if (c == null) { st.noCost++; return; }
      if (+c === 0) st.costZero++;
      if (+c > +it.price) st.costGtPrice++;
      const m = it.price ? Math.round((1 - c / it.price) * 10) * 10 : 'x';
      st.marginBuckets[m + '%'] = (st.marginBuckets[m + '%'] || 0) + 1;
    });
  });
  console.log(JSON.stringify(st, null, 1));
})().catch((e) => { console.error(e); process.exit(1); });
