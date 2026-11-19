// Chẩn đoán hoa hồng: chỉ in số lượng và tháng, không in số tiền hay tên
const R = (m) => require(require.resolve(m, { paths: [__dirname + '/../functions'] }));
const { initializeApp, cert } = R('firebase-admin/app');
const { getFirestore } = R('firebase-admin/firestore');
initializeApp({ credential: cert(require(process.env.GOOGLE_APPLICATION_CREDENTIALS)) });
const db = getFirestore();
(async () => {
  const cs = await db.collection('costs').get();
  const ord = cs.docs.filter((d) => d.id.startsWith('ord-'));
  console.log('costs ord-* docs:', ord.length);
  for (const d of ord) {
    const id = d.id.slice(4); const o = await db.doc('orders/' + id).get();
    const x = d.data(); const ex = Array.isArray(x.extra) ? x.extra : [];
    const st = ex.filter((e) => e.kind === 'staff' || e.label === 'Nhân viên');
    const t = o.exists ? new Date((o.data().doneAt || o.data().createdAt || 0) + 7 * 3600e3).toISOString().slice(0, 7) : '-';
    console.log(`order ${o.exists ? 'FOUND' : 'MISSING'} status=${o.exists ? o.data().status : '-'} month=${t} staffRows=${st.length} hasAmount=${st.some((e) => +e.amount > 0)} amountType=${st.map((e) => typeof e.amount).join(',')} extraIsArray=${Array.isArray(x.extra)}`);
  }
  const os = await db.collection('orders').get();
  const months = {}; os.docs.forEach((d) => { const o = d.data(); const t = new Date((o.doneAt || o.createdAt || 0) + 7 * 3600e3).toISOString().slice(0, 7); months[t + ' ' + o.status] = (months[t + ' ' + o.status] || 0) + 1; });
  console.log('orders by month/status:', JSON.stringify(months));
})().catch((e) => { console.error(e.message); process.exit(1); });
