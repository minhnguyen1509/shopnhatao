const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { setGlobalOptions } = require('firebase-functions/v2');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const { OWNER_EMAILS, STAFF_DOMAIN, REGION } = require('./config');

initializeApp();
const db = getFirestore();
const auth = getAuth();
setGlobalOptions({ region: REGION, maxInstances: 5, memory: '256MiB' });

/* ---------- helpers ---------- */
const now = () => Date.now();
const str = (v, max = 200) => String(v == null ? '' : v).trim().slice(0, max);
const normPhone = (p) => String(p || '').replace(/\D/g, '').replace(/^84/, '0');
function mkCode(prefix) {
  const d = new Date(Date.now() + 7 * 3600e3); // giờ VN
  const ymd = String(d.getUTCFullYear()).slice(2) + String(d.getUTCMonth() + 1).padStart(2, '0') + String(d.getUTCDate()).padStart(2, '0');
  return prefix + ymd + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
}
function needPhone(p) {
  const x = normPhone(p);
  if (x.length < 9 || x.length > 11) throw new HttpsError('invalid-argument', 'Số điện thoại chưa đúng, bạn kiểm tra lại nhé.');
  return x;
}
function needName(n) {
  const x = str(n, 80);
  if (x.length < 2) throw new HttpsError('invalid-argument', 'Bạn nhập họ tên giúp shop nhé.');
  return x;
}
async function settings() {
  const s = await db.doc('settings/shop').get();
  return s.exists ? s.data() : {};
}
async function requireOwner(req) {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Bạn cần đăng nhập.');
  const me = await db.doc('staff/' + req.auth.uid).get();
  const d = me.exists ? me.data() : null;
  if (!d || d.status === 'off' || d.perm !== 'owner') throw new HttpsError('permission-denied', 'Chỉ chủ shop được thực hiện thao tác này.');
  return d;
}
const usernameOk = (u) => /^[a-z0-9._]{3,30}$/.test(u || '');

/* ---------- chủ shop: tạo tài khoản lần đầu ---------- */
exports.bootstrapOwner = onCall(async (req) => {
  if (!req.auth || !req.auth.token.email) throw new HttpsError('unauthenticated', 'Bạn cần đăng nhập.');
  const email = String(req.auth.token.email).toLowerCase();
  if (!OWNER_EMAILS.map((e) => e.toLowerCase()).includes(email)) throw new HttpsError('permission-denied', 'Email này chưa được khai báo là chủ shop.');
  const ref = db.doc('staff/' + req.auth.uid);
  const s = await ref.get();
  if (!s.exists) {
    await ref.set({ name: req.auth.token.name || 'Chủ shop', email, username: '', perm: 'owner', role: 'Quản lý', status: 'on', rate: 25000, startDate: '', phone: '', note: '', createdAt: now() });
  }
  return { ok: true };
});

/* ---------- quản lý nhân viên (chỉ chủ shop) ---------- */
exports.createStaff = onCall(async (req) => {
  await requireOwner(req);
  const d = req.data || {};
  const username = str(d.username, 30).toLowerCase();
  if (!usernameOk(username)) throw new HttpsError('invalid-argument', 'Tên đăng nhập 3–30 ký tự: chữ thường không dấu, số, dấu chấm.');
  if (String(d.password || '').length < 6) throw new HttpsError('invalid-argument', 'Mật khẩu cần ít nhất 6 ký tự.');
  const dup = await db.collection('staff').where('username', '==', username).limit(1).get();
  if (!dup.empty) throw new HttpsError('already-exists', 'Tên đăng nhập đã có người dùng.');
  let user;
  try {
    user = await auth.createUser({ email: `${username}@${STAFF_DOMAIN}`, password: String(d.password), displayName: str(d.name, 80) });
  } catch (e) {
    if (e.code === 'auth/email-already-exists') throw new HttpsError('already-exists', 'Tên đăng nhập đã có người dùng.');
    throw new HttpsError('internal', 'Chưa tạo được tài khoản: ' + e.message);
  }
  await db.doc('staff/' + user.uid).set({
    name: needName(d.name), username, perm: d.perm === 'owner' ? 'owner' : 'staff', role: str(d.role, 40) || 'Bán hàng',
    phone: normPhone(d.phone), startDate: str(d.startDate, 10), status: d.status === 'off' ? 'off' : 'on',
    note: str(d.note, 300), rate: Math.max(0, Math.round(+d.rate || 25000)), createdAt: now(),
  });
  if (d.status === 'off') await auth.updateUser(user.uid, { disabled: true });
  return { id: user.uid };
});

exports.updateStaff = onCall(async (req) => {
  await requireOwner(req);
  const d = req.data || {};
  const id = str(d.id, 128);
  const ref = db.doc('staff/' + id);
  const cur = await ref.get();
  if (!cur.exists) throw new HttpsError('not-found', 'Không tìm thấy nhân viên.');
  const old = cur.data();
  const upd = {
    name: needName(d.name), role: str(d.role, 40), phone: normPhone(d.phone), startDate: str(d.startDate, 10),
    note: str(d.note, 300), rate: Math.max(0, Math.round(+d.rate || 25000)), updatedAt: now(),
  };
  const self = id === req.auth.uid;
  if (!self) {
    if (d.perm) upd.perm = d.perm === 'owner' ? 'owner' : 'staff';
    upd.status = d.status === 'off' ? 'off' : 'on';
  }
  const authUpd = {};
  if (d.username !== undefined && !old.email) {
    const username = str(d.username, 30).toLowerCase();
    if (!usernameOk(username)) throw new HttpsError('invalid-argument', 'Tên đăng nhập 3–30 ký tự: chữ thường không dấu, số, dấu chấm.');
    if (username !== old.username) {
      const dup = await db.collection('staff').where('username', '==', username).limit(1).get();
      if (!dup.empty) throw new HttpsError('already-exists', 'Tên đăng nhập đã có người dùng.');
      upd.username = username;
      authUpd.email = `${username}@${STAFF_DOMAIN}`;
    }
  }
  if (d.password) {
    if (String(d.password).length < 6) throw new HttpsError('invalid-argument', 'Mật khẩu cần ít nhất 6 ký tự.');
    authUpd.password = String(d.password);
  }
  if (!self) authUpd.disabled = upd.status === 'off';
  authUpd.displayName = upd.name;
  try { await auth.updateUser(id, authUpd); } catch (e) {
    if (e.code === 'auth/email-already-exists') throw new HttpsError('already-exists', 'Tên đăng nhập đã có người dùng.');
    throw new HttpsError('internal', 'Chưa cập nhật được tài khoản: ' + e.message);
  }
  if (!self && (upd.status === 'off' || authUpd.password)) await auth.revokeRefreshTokens(id);
  await ref.set(upd, { merge: true });
  return { ok: true };
});

exports.deleteStaff = onCall(async (req) => {
  await requireOwner(req);
  const id = str((req.data || {}).id, 128);
  if (!id || id === req.auth.uid) throw new HttpsError('invalid-argument', 'Không thể xóa tài khoản đang đăng nhập.');
  try { await auth.deleteUser(id); } catch (e) { if (e.code !== 'auth/user-not-found') throw new HttpsError('internal', e.message); }
  await db.doc('staff/' + id).delete();
  return { ok: true };
});

/* ---------- khách lẻ (không cần đăng nhập) ---------- */
exports.placeDeposit = onCall(async (req) => {
  const d = req.data || {};
  const name = needName(d.name), phone = needPhone(d.phone), note = str(d.note, 300);
  const unitId = str(d.unitId, 128);
  const st = await settings();
  const deposit = Math.max(0, Math.round(+st.deposit || 500000));
  const code = mkCode('DH');
  await db.runTransaction(async (tx) => {
    const uref = db.doc('inventory/' + unitId);
    const u = await tx.get(uref);
    if (!u.exists || u.data().status !== 'instock') throw new HttpsError('failed-precondition', 'Máy này vừa có người đặt, bạn chọn máy khác nhé.');
    const x = u.data();
    tx.set(db.doc('orders/' + code), {
      code, source: 'web', customerName: name, phone, note,
      items: [{ kind: 'phone', refId: unitId, name: `${x.model || ''} ${x.storage || ''} ${x.color || ''}`.trim(), imei: x.imei || '', price: +x.price || 0, cost: 0, qty: 1, warrantyMonths: +x.warrantyMonths || 0 }],
      total: +x.price || 0, deposit, status: 'pending', createdAt: now(),
    });
    tx.update(uref, { status: 'reserved', orderCode: code });
  });
  return { code, deposit };
});

exports.placeAccOrder = onCall(async (req) => {
  const d = req.data || {};
  const name = needName(d.name), phone = needPhone(d.phone), note = str(d.note, 300);
  const a = await db.doc('accessories/' + str(d.accId, 128)).get();
  if (!a.exists || !(+a.data().qty > 0)) throw new HttpsError('failed-precondition', 'Phụ kiện này tạm hết hàng.');
  const x = a.data();
  const qty = Math.max(1, Math.min(Math.round(+d.qty || 1), +x.qty || 1, 20));
  const code = mkCode('DH');
  await db.doc('orders/' + code).set({
    code, source: 'web', customerName: name, phone, note,
    items: [{ kind: 'acc', refId: a.id, name: x.name || '', imei: '', price: +x.price || 0, cost: 0, qty, warrantyMonths: 0 }],
    total: (+x.price || 0) * qty, deposit: 0, status: 'pending', createdAt: now(),
  });
  return { code };
});

exports.bookRepair = onCall(async (req) => {
  const d = req.data || {};
  const name = needName(d.name), phone = needPhone(d.phone);
  const device = str(d.device, 80);
  if (!device) throw new HttpsError('invalid-argument', 'Bạn nhập dòng máy giúp shop nhé.');
  const code = mkCode('SC');
  await db.doc('repairs/' + code).set({
    code, source: 'web', customerName: name, phone, device, imei: '',
    issue: str(d.issue, 200) + (d.note ? ' – ' + str(d.note, 200) : ''), wish: str(d.wish, 100),
    kind: 'inhouse', partner: '', quote: 0, cost: 0, status: 'booked', createdAt: now(), note: '',
  });
  return { code };
});

exports.warrantyLookup = onCall(async (req) => {
  const q = str((req.data || {}).q, 40);
  const qp = normPhone(q);
  const tail = q.replace(/\s/g, '').toUpperCase();
  const byPhone = /^[+\d\s.]+$/.test(q) && qp.length >= 9 && qp.length <= 11;
  const byImei = !byPhone && tail.length >= 5;
  if (!byPhone && !byImei) throw new HttpsError('invalid-argument', 'Nhập đủ số điện thoại hoặc ít nhất 5 ký tự cuối của Serial/IMEI.');
  const items = [], repairs = [];
  const endsT = (s) => String(s || '').toUpperCase().endsWith(tail);
  const warrantyEnd = (o, it) => { if (!it.warrantyMonths) return null; const dd = new Date(o.doneAt || o.createdAt); dd.setMonth(dd.getMonth() + (+it.warrantyMonths)); return dd.getTime(); };
  const pushOrder = (o) => (o.items || []).forEach((it) => {
    if (it.kind !== 'phone') return;
    if (byImei && !endsT(it.imei)) return;
    items.push({ name: it.name, date: o.doneAt || o.createdAt, end: warrantyEnd(o, it), tail: String(it.imei || '').slice(-5) });
  });
  if (byPhone) {
    const os = await db.collection('orders').where('phone', '==', qp).limit(30).get();
    os.forEach((s) => { const o = s.data(); if (o.status === 'done') pushOrder(o); });
    const rs = await db.collection('repairs').where('phone', '==', qp).limit(20).get();
    rs.forEach((s) => { const r = s.data(); repairs.push({ device: r.device, issue: r.issue, status: r.status, createdAt: r.createdAt }); });
  } else {
    const os = await db.collection('orders').where('status', '==', 'done').orderBy('doneAt', 'desc').limit(500).get();
    os.forEach((s) => pushOrder(s.data()));
    const rs = await db.collection('repairs').orderBy('createdAt', 'desc').limit(300).get();
    rs.forEach((s) => { const r = s.data(); if (endsT(r.imei)) repairs.push({ device: r.device, issue: r.issue, status: r.status, createdAt: r.createdAt }); });
  }
  return { items: items.slice(0, 10), repairs: repairs.slice(0, 10) };
});

/* ---------- gửi phiếu bảo hành qua email (Gmail SMTP) ---------- */
const nodemailer = require('nodemailer');
const MAIL_FROM = 'hm.istore25@gmail.com';
const LOGO_URL = 'https://shopnhatao-b8f59.web.app/logo-mark.webp';
async function requireStaff(req) {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Bạn cần đăng nhập.');
  const me = await db.doc('staff/' + req.auth.uid).get();
  const d = me.exists ? me.data() : null;
  if (!d || d.status === 'off') throw new HttpsError('permission-denied', 'Tài khoản không có quyền.');
  return d;
}
const h = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const vnd = (n) => (Math.round(+n || 0)).toLocaleString('vi-VN').replace(/,/g, '.');
const mdLine = (s) => h(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
function policyHtml(t) {
  const out = []; let ul = false;
  String(t || '').split('\n').forEach((l) => {
    const x = l.trim(); if (!x) return;
    if (x.startsWith('- ')) { if (!ul) { out.push('<ul style="margin:4px 0 8px;padding-left:20px">'); ul = true; } out.push('<li style="margin:2px 0">' + mdLine(x.slice(2)) + '</li>'); return; }
    if (ul) { out.push('</ul>'); ul = false; }
    if (x.startsWith('## ')) out.push('<h2 style="font-size:18px;text-align:center;margin:0 0 10px">' + mdLine(x.slice(3)) + '</h2>');
    else if (x.startsWith('### ')) out.push('<p style="margin:10px 0 2px"><b>' + mdLine(x.slice(4)) + '</b></p>');
    else out.push('<p style="margin:6px 0">' + mdLine(x) + '</p>');
  });
  if (ul) out.push('</ul>');
  return out.join('');
}
function invoiceEmail(o, shop, conds, withPolicy) {
  const td = 'border:1px solid #333;padding:6px 8px;';
  const rows = (o.items || []).map((it, i) => `<tr><td style="${td}text-align:center">${i + 1}</td><td style="${td}">${h(it.name)}${(+it.qty || 1) > 1 ? ' (x' + (+it.qty) + ')' : ''}</td><td style="${td}text-align:center;font-size:12px">${h(it.imei || '')}</td><td style="${td}text-align:center">${h(conds[i] || it.cond || '')}</td><td style="${td}text-align:center">${it.warrantyMonths ? h(it.warrantyMonths) + ' tháng' : ''}</td><td style="${td}text-align:right">${vnd(it.price)}</td><td style="${td}text-align:right">${vnd((+it.price || 0) * (+it.qty || 1))}</td></tr>`).join('');
  const d = new Date((o.doneAt || o.createdAt || Date.now()) + 7 * 3600e3);
  const th = td + 'background:#f3f3f3;text-align:center;';
  const cus = o.customerName && o.customerName !== 'Khách lẻ' ? o.customerName : '';
  return `<div style="font-family:'Times New Roman',Times,serif;color:#111;font-size:14px;max-width:720px;margin:0 auto;line-height:1.45">
<table role="presentation" style="width:100%;border-collapse:collapse"><tr><td style="width:96px;vertical-align:top"><img src="${LOGO_URL}" alt="${h(shop.name)}" width="84" style="display:block;border-radius:8px"></td>
<td style="text-align:center;vertical-align:top"><div style="font-size:18px;font-weight:bold">${h(String(shop.name || '').toUpperCase())}</div><div style="font-weight:bold">${h(shop.company)}</div><div>${h(shop.address)}</div><div>Mobile: ${h(shop.phones)}</div>${shop.email ? `<div>Email: ${h(shop.email)}</div>` : ''}</td></tr></table>
<h1 style="text-align:center;font-size:22px;margin:22px 0 2px">${h(shop.title || 'PHIẾU BẢO HÀNH')}</h1><div style="text-align:center;font-size:12px;margin-bottom:16px">Số: ${h(o.code)}</div>
<div>Tên khách hàng: ${h(cus)}</div><div>Địa chỉ: ${h(o.customerAddress || '')}</div><div style="margin-bottom:12px">Điện thoại: ${h(o.phone || '')}</div>
<table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr><th style="${th}">STT</th><th style="${th}">Sản phẩm</th><th style="${th}">Serial</th><th style="${th}">Tình trạng</th><th style="${th}">Bảo hành</th><th style="${th}">Đơn giá</th><th style="${th}">Thành tiền</th></tr></thead>
<tbody>${rows}</tbody><tfoot><tr><td colspan="6" style="${td}text-align:right;font-weight:bold">Tổng cộng:</td><td style="${td}text-align:right;font-weight:bold">${vnd(o.total)}</td></tr></tfoot></table>
<table role="presentation" style="width:100%;margin-top:18px"><tr><td></td><td style="width:45%;text-align:center"><div>Ngày ${d.getUTCDate()} tháng ${d.getUTCMonth() + 1} năm ${d.getUTCFullYear()}</div><b>Người bán hàng</b><div style="margin-top:28px">${h(String(o.staff || '').toUpperCase())}</div></td></tr></table>
${withPolicy && shop.policy ? `<hr style="border:0;border-top:1px solid #ccc;margin:26px 0 18px">${policyHtml(shop.policy)}` : ''}
<p style="margin-top:22px;font-size:12px;color:#666">Email này được gửi tự động từ ${h(shop.name)} khi bạn mua hàng. Cần hỗ trợ, bạn trả lời email này hoặc gọi ${h(shop.phones)}.</p></div>`;
}

exports.setMailPassword = onCall(async (req) => {
  await requireOwner(req);
  const pass = String((req.data || {}).pass || '').replace(/\s/g, '');
  if (pass.length !== 16) throw new HttpsError('invalid-argument', 'Mật khẩu ứng dụng Gmail gồm 16 ký tự.');
  const t = nodemailer.createTransport({ host: 'smtp.gmail.com', port: 465, secure: true, auth: { user: MAIL_FROM, pass } });
  try { await t.verify(); } catch (e) {
    throw new HttpsError('failed-precondition', 'Gmail không chấp nhận mật khẩu này. Kiểm tra đã bật xác minh 2 bước và tạo đúng Mật khẩu ứng dụng cho ' + MAIL_FROM + '.');
  }
  await db.doc('private/mail').set({ user: MAIL_FROM, pass, updatedAt: now() });
  await db.doc('settings/shop').set({ mailReady: true }, { merge: true });
  return { ok: true };
});

exports.sendInvoiceEmail = onCall(async (req) => {
  const me = await requireStaff(req);
  const data = req.data || {};
  const to = str(data.to, 120).toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) throw new HttpsError('invalid-argument', 'Email khách chưa đúng.');
  const os = await db.doc('orders/' + str(data.orderId, 80)).get();
  if (!os.exists) throw new HttpsError('not-found', 'Không tìm thấy đơn hàng.');
  const o = os.data();
  const cred = await db.doc('private/mail').get();
  if (!cred.exists) throw new HttpsError('failed-precondition', 'Chủ shop chưa nhập Mật khẩu ứng dụng Gmail trong Cài đặt.');
  const st = await settings();
  const s = data.shop || {};
  const shop = {
    name: str(s.name || st.name || 'Shop Nhà Táo', 80), company: str(s.company, 120), address: str(s.address || st.address, 200),
    phones: str(s.phones || st.phone, 80), email: str(s.email || MAIL_FROM, 80), title: str(s.title || 'PHIẾU BẢO HÀNH', 60), policy: str(s.policy, 8000),
  };
  const conds = Array.isArray(data.conds) ? data.conds.map((x) => str(x, 40)) : [];
  const t = nodemailer.createTransport({ host: 'smtp.gmail.com', port: 465, secure: true, auth: { user: cred.data().user, pass: cred.data().pass } });
  try {
    await t.sendMail({
      from: `"${shop.name}" <${cred.data().user}>`, to, replyTo: cred.data().user,
      subject: `${shop.title} ${o.code || ''} - ${shop.name}`.trim(),
      html: invoiceEmail(o, shop, conds, !!data.policy),
    });
  } catch (e) {
    console.error('sendMail', e);
    throw new HttpsError('internal', 'Gửi email không thành công: ' + (e.responseCode === 535 ? 'Gmail từ chối mật khẩu ứng dụng, chủ shop nhập lại trong Cài đặt.' : (e.message || 'lỗi không rõ')));
  }
  await os.ref.update({ customerEmail: to, mailedAt: now(), mailedBy: me.name || '' });
  return { ok: true };
});
