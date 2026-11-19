// Sửa giá vốn cho món nhập từ file mà chưa có giá vốn (Lợi nhuận Shop bỏ trống => lãi shop = 0)
// giá vốn = giá bán − 0 − hoa hồng. Chỉ in số đếm và độ lệch so với số Minh đưa cho tháng 10/2026.
const R = (m) => require(require.resolve(m, { paths: [__dirname + '/../functions'] }));
const { initializeApp, cert } = R('firebase-admin/app');
const { getFirestore } = R('firebase-admin/firestore');
initializeApp({ credential: cert(require(process.env.GOOGLE_APPLICATION_CREDENTIALS)) });
const db = getFirestore();
const vnMonth = (t) => new Date((t || 0) + 7 * 3600e3).toISOString().slice(0, 7);
(async () => {
  const [os, cs] = await Promise.all([db.collection('orders').get(), db.collection('costs').get()]);
  const cm = {}; cs.docs.forEach((d) => (cm[d.id] = d.data()));
  const writes = [];
  os.docs.forEach((d) => {
    const o = d.data(); if (o.source !== 'import') return;
    const items = o.items || [];
    const hh = ((cm['ord-' + d.id] || {}).extra || []).filter((x) => x.kind === 'staff' || x.label === 'Nhân viên').reduce((s, x) => s + (+x.amount || 0), 0);
    const revAll = items.reduce((s, it) => s + (+it.price || 0) * (+it.qty || 1), 0);
    items.forEach((it) => {
      const key = (it.kind === 'phone' ? 'inv-' : 'acc-') + it.refId;
      const has = it.kind === 'phone' ? cm[key] && cm[key].costPrice != null : cm[key] && cm[key].cost != null;
      if (has) return;
      const q = +it.qty || 1, rev = (+it.price || 0) * q;
      const share = revAll ? hh * rev / revAll : hh / items.length;
      const unit = Math.round((rev - share) / q);
      const data = it.kind === 'phone' ? { costPrice: unit } : { cost: unit };
      cm[key] = data; writes.push([key, data]);
    });
  });
  for (let i = 0; i < writes.length; i += 400) {
    const b = db.batch(); writes.slice(i, i + 400).forEach(([k, v]) => b.set(db.doc('costs/' + k), v, { merge: true })); await b.commit();
  }
  // Đối chiếu tháng 10/2026
  let lai = 0, hhSum = 0, n = 0, noCost = 0;
  os.docs.forEach((d) => {
    const o = d.data(); if (!(o.status === 'done' || o.status === 'returned')) return;
    if (vnMonth(o.doneAt || o.createdAt) !== '2026-10') return; n++;
    const ex = (cm['ord-' + d.id] || {}).extra || [];
    const comm = ex.filter((x) => x.kind === 'staff' || x.label === 'Nhân viên').reduce((s, x) => s + (+x.amount || 0), 0);
    const other = ex.reduce((s, x) => s + (+x.amount || 0), 0) - comm;
    let rev = -(+o.discount || 0) - (+o.refundTotal || 0), cogs = 0;
    (o.items || []).forEach((it) => {
      const key = (it.kind === 'phone' ? 'inv-' : 'acc-') + it.refId;
      const c = +it.cost || (it.kind === 'phone' ? +((cm[key] || {}).costPrice || 0) : +((cm[key] || {}).cost || 0));
      if (!c && +it.price) noCost++;
      const q = (+it.qty || 1) - (+it.retQty || 0);
      rev += (+it.price || 0) * (+it.qty || 1); cogs += c * q;
    });
    lai += rev - cogs - other - comm; hhSum += comm;
  });
  console.log(`Đã bổ sung giá vốn cho ${writes.length} món.`);
  console.log(`Tháng 10/2026: ${n} đơn, món còn thiếu giá vốn: ${noCost}`);
  console.log(`Lệch Lãi shop so với file: ${lai - 67150000}`);
  console.log(`Lệch Hoa hồng so với file: ${hhSum - 4350000}`);
})().catch((e) => { console.error(e); process.exit(1); });
