// Trang quản trị: thành viên, ngân hàng câu, tài khoản & quyền, cài đặt, dữ liệu thi
import { configured, db, watchAuth, login, logout, resetPassword, createAccount, errText, ROLES, DEFAULT_SETTINGS, esc } from "./core.js";

const LEVELS = ["Chưa biết", "N5", "N4", "N3", "N2", "N1"];
const LAB = { "Chưa biết": "Dễ", "N5": "Dễ", "N4": "Trung bình", "N3": "Trung bình", "N2": "Khó", "N1": "Khó" };
const SETS = ["Thường", "Ngôi sao", "Dự phòng"];
const LABELS = ["Dễ", "Trung bình", "Khó"];
const A = { me: null, tab: "members", roster: null, bank: null, settings: null, users: [], results: [], draft: null, dirty: false,
  msg: null, err: null, preview: null, bankPreview: null, subs: [], newPw: "", confirm: null };
const app = document.getElementById("app");
const isAdmin = () => A.me && A.me.role === "admin";
const clone = o => JSON.parse(JSON.stringify(o));
const flash = (msg, err) => { A.msg = msg || null; A.err = err || null; render(); if (msg) setTimeout(() => { if (A.msg === msg) { A.msg = null; render() } }, 4000) };
const run = async (fn, okMsg) => { try { await fn(); if (okMsg) flash(okMsg) } catch (e) { flash(null, errText(e)) } };

/* ---------- dữ liệu ---------- */
function subscribe() {
  A.subs.forEach(f => f()); A.subs = [];
  const onErr = e => flash(null, errText(e));
  A.subs.push(db.doc("setup/roster").onSnapshot(s => { A.roster = s.exists ? s.data() : { teams: [] }; if (!A.dirty) A.draft = clone(A.roster); render() }, onErr));
  A.subs.push(db.doc("setup/bank").onSnapshot(s => { A.bank = s.exists ? s.data() : { items: [] }; render() }, onErr));
  A.subs.push(db.doc("setup/settings").onSnapshot(s => { A.settings = s.exists ? s.data() : null; render() }, onErr));
  A.subs.push(db.collection("users").onSnapshot(q => { A.users = q.docs.map(d => ({ uid: d.id, ...d.data() })); render() }, onErr));
  A.subs.push(db.collection("results").onSnapshot(q => { A.results = q.docs.map(d => ({ key: d.id, ...d.data() })); render() }, onErr));
}

/* Đọc bảng dán từ Excel (tab) hoặc CSV, ánh xạ cột theo tên tiêu đề */
function parseTable(text) {
  const lines = text.replace(/\r/g, "").split("\n").filter(l => l.trim());
  if (!lines.length) return { head: [], rows: [] };
  const sep = lines[0].includes("\t") ? "\t" : (lines[0].includes(";") ? ";" : ",");
  const split = l => sep === "," ? l.match(/("([^"]|"")*"|[^,]*)(,|$)/g).map(x => x.replace(/,$/, "").replace(/^"|"$/g, "").replace(/""/g, '"')) : l.split(sep);
  const head = split(lines[0]).map(h => h.trim().toLowerCase());
  return { head, rows: lines.slice(1).map(split) };
}
const col = (head, ...names) => { for (const n of names) { const i = head.findIndex(h => h === n.toLowerCase() || h.startsWith(n.toLowerCase())); if (i >= 0) return i } return -1 };
const normLevel = v => { const s = String(v || "").trim(); if (/chưa/i.test(s)) return "Chưa biết"; const m = s.toUpperCase().match(/N[1-5]/); return m ? m[0] : "" };

function parseRoster(text) {
  const { head, rows } = parseTable(text);
  const ti = col(head, "team", "nhóm"), ni = col(head, "họ và tên", "họ tên", "tên", "name"), li = col(head, "trình độ", "level", "cấp");
  if (ti < 0 || ni < 0 || li < 0) throw new Error("Không tìm thấy đủ cột Team / Họ và tên / Trình độ ở dòng tiêu đề.");
  const old = A.roster && A.roster.teams || [];
  const map = new Map(); const bad = [];
  rows.forEach((r, i) => {
    const t = String(r[ti] || "").trim(), n = String(r[ni] || "").trim(), lv = normLevel(r[li]);
    if (!t || !n) return; if (!lv) bad.push(`dòng ${i + 2}: "${r[li] || ""}"`);
    if (!map.has(t)) map.set(t, []); map.get(t).push({ name: n, level: lv || "Chưa biết" });
  });
  const teams = [...map.entries()].map(([name, ms], k) => {
    const ot = old.find(o => o.name === name); const tid = ot ? ot.id : "t" + (k + 1) + Math.random().toString(36).slice(2, 5);
    return { id: tid, name, members: ms.map((m, j) => { const om = ot && (ot.members || []).find(x => x.name === m.name); return { id: om ? om.id : tid + "m" + (j + 1) + Math.random().toString(36).slice(2, 4), name: m.name, level: m.level } }) };
  });
  return { teams, bad };
}
function parseBank(text) {
  const { head, rows } = parseTable(text);
  const c = { id: col(head, "id"), set: col(head, "bộ"), label: col(head, "nhãn"), level: col(head, "cấp gốc", "cấp độ"), jp: col(head, "câu tiếng nhật", "tiếng nhật", "jp"),
    hira: col(head, "phiên âm", "hiragana"), ro: col(head, "romaji"), vn: col(head, "nghĩa tiếng việt", "nghĩa", "vn") };
  if (c.id < 0 || c.jp < 0) throw new Error("Cần tối thiểu cột ID và Câu tiếng Nhật ở dòng tiêu đề.");
  const items = []; const seen = new Set();
  for (const r of rows) {
    const id = String(r[c.id] || "").trim(), jp = String(r[c.jp] || "").trim(); if (!id || !jp || seen.has(id)) continue; seen.add(id);
    const level = c.level >= 0 ? normLevel(r[c.level]) : "";
    let label = c.label >= 0 ? String(r[c.label] || "").trim() : ""; if (!LABELS.includes(label)) label = LAB[level] || "Dễ";
    let set = c.set >= 0 ? String(r[c.set] || "").trim() : ""; if (!SETS.includes(set)) set = "Thường";
    items.push({ id, set, label, level, jp, hira: c.hira >= 0 ? String(r[c.hira] || "").trim() : "", ro: c.ro >= 0 ? String(r[c.ro] || "").trim() : "", vn: c.vn >= 0 ? String(r[c.vn] || "").trim() : "" });
  }
  return items;
}
function countBank(items) { const o = {}; for (const s of SETS) for (const l of LABELS) o[s + "|" + l] = 0; items.forEach(b => { o[b.set + "|" + b.label] = (o[b.set + "|" + b.label] || 0) + 1 }); return o }

/* ---------- views ---------- */
const tabs = [["members", "Thành viên"], ["bank", "Ngân hàng câu"], ["accounts", "Tài khoản & quyền"], ["settings", "Cài đặt"], ["data", "Dữ liệu thi"]];
function shell(body) {
  return `<div class="wrap" style="display:flex;flex-direction:column;gap:16px">
    <div class="topbar"><div><div class="eyebrow">Start Kaiwa Contest</div><h1>Trang quản trị</h1></div>
      <div class="row"><span class="who-am-i">${esc(A.me.name)} · Quản trị</span><a class="pill" href="index.html">Về trang chính</a><button data-act="logout">Đăng xuất</button></div></div>
    ${A.err ? `<div class="err">${esc(A.err)}</div>` : ""}${A.msg ? `<div class="ok">${esc(A.msg)}</div>` : ""}
    <div class="tabs" role="tablist">${tabs.map(([k, v]) => `<button role="tab" aria-selected="${A.tab === k}" class="${A.tab === k ? "sel" : ""}" data-act="tab" data-tab="${k}">${v}</button>`).join("")}</div>
    ${body}</div>`;
}
function vMembers() {
  const d = A.draft || { teams: [] }; const total = d.teams.reduce((a, t) => a + (t.members || []).length, 0);
  let h = `<div class="panel"><div class="row" style="justify-content:space-between"><h2>Danh sách thành viên (${d.teams.length} team · ${total} người)</h2>
    <div class="row">${A.dirty ? `<span class="pill" style="background:var(--star-soft)">Có thay đổi chưa lưu</span><button data-act="m-revert">Bỏ thay đổi</button>` : ""}<button class="primary" data-act="m-save" ${A.dirty ? "" : "disabled"}>Lưu danh sách</button></div></div>
    ${A.results.length ? `<div class="warn">Đã có ${A.results.length} lượt thi được ghi. Đổi tên vẫn an toàn; xóa thành viên đã thi sẽ làm lệch điểm team.</div>` : ""}
    <div class="teamgrid" style="grid-template-columns:repeat(auto-fill,minmax(320px,1fr))">`;
  d.teams.forEach((t, ti) => {
    h += `<div class="tcard"><div class="row"><input aria-label="Tên team" value="${esc(t.name)}" data-act="t-name" data-t="${ti}" style="flex:1"><button class="danger" data-act="t-del" data-t="${ti}" title="Xóa team">Xóa team</button></div>
      <div class="tablebox"><table><thead><tr><th>Họ và tên</th><th>Trình độ</th><th></th></tr></thead><tbody>
      ${(t.members || []).map((m, mi) => `<tr><td><input aria-label="Họ và tên" value="${esc(m.name)}" data-act="m-name" data-t="${ti}" data-m="${mi}"></td>
        <td><select aria-label="Trình độ" data-act="m-level" data-t="${ti}" data-m="${mi}">${LEVELS.map(l => `<option ${l === m.level ? "selected" : ""}>${l}</option>`).join("")}</select></td>
        <td><button data-act="m-del" data-t="${ti}" data-m="${mi}" aria-label="Xóa ${esc(m.name)}">✕</button></td></tr>`).join("")}
      </tbody></table></div><button data-act="m-add" data-t="${ti}">+ Thêm thành viên</button></div>`;
  });
  h += `</div><button data-act="t-add">+ Thêm team</button></div>`;
  h += `<div class="panel"><h2>Nhập nhanh từ Excel</h2>
    <p class="note">Copy vùng dữ liệu (kèm dòng tiêu đề) từ sheet <b>DS Team</b> trong file WBS, hoặc bảng bất kỳ có cột <b>Team</b>, <b>Họ và tên</b>, <b>Trình độ</b>, rồi dán vào ô dưới. Danh sách mới sẽ thay toàn bộ bản nháp; thành viên trùng tên giữ nguyên mã để không mất kết quả.</p>
    <textarea id="rosterPaste" placeholder="Team&#9;STT&#9;Họ và tên&#9;Trình độ&#10;Team 1&#9;1&#9;Nguyễn Văn A&#9;N3"></textarea>
    <div class="row"><button data-act="m-parse">Đọc dữ liệu</button>${A.preview ? `<span>${A.preview.teams.length} team · ${A.preview.teams.reduce((a, t) => a + t.members.length, 0)} người${A.preview.bad.length ? ` · <span style="color:var(--fail)">trình độ không rõ: ${esc(A.preview.bad.slice(0, 5).join(", "))}</span>` : ""}</span><button class="primary" data-act="m-apply">Đưa vào bản nháp</button>` : ""}</div></div>`;
  return h;
}
function vBank() {
  const items = (A.bank && A.bank.items) || []; const cnt = countBank(items);
  const used = new Set(A.results.map(r => r.sentenceId));
  let h = `<div class="panel"><h2>Ngân hàng câu vòng 1 (${items.length} câu)</h2>
    <div class="tablebox"><table><thead><tr><th>Bộ</th>${LABELS.map(l => `<th class="num">${l}</th>`).join("")}<th class="num">Tổng</th></tr></thead><tbody>
    ${SETS.map(s => `<tr><td>${s}</td>${LABELS.map(l => `<td class="num">${cnt[s + "|" + l]}</td>`).join("")}<td class="num"><b>${LABELS.reduce((a, l) => a + cnt[s + "|" + l], 0)}</b></td></tr>`).join("")}</tbody></table></div>
    <p class="note">Bảng ngôi sao cần tối thiểu 3 câu Dễ + 3 câu Khó; nên có 10 + 10 để luôn giữ tỷ lệ 50-50 cho 7 lượt sao.</p></div>
    <div class="panel"><h2>Nhập ngân hàng câu từ Excel</h2>
    <p class="note">Copy toàn bộ sheet <b>Ngan hang cau</b> (file Ngan_hang_cau_V1.xlsx, kèm dòng tiêu đề) rồi dán vào đây. Cột cần có: ID, Bộ, Nhãn, Câu tiếng Nhật; nên có Phiên âm (hiragana), Romaji, Nghĩa tiếng Việt. Thao tác này thay toàn bộ ngân hàng câu hiện tại.</p>
    <div class="warn">Không đưa file ngân hàng câu lên GitHub: nội dung câu chỉ nằm trong cơ sở dữ liệu và chỉ tài khoản đã cấp quyền mới đọc được.</div>
    <textarea id="bankPaste" placeholder="ID&#9;Bộ&#9;Nhãn&#9;Cấp gốc&#9;Chủ đề&#9;Câu tiếng Nhật&#9;Phiên âm (hiragana)&#9;Romaji&#9;Nghĩa tiếng Việt"></textarea>
    <div class="row"><button data-act="b-parse">Đọc dữ liệu</button>${A.bankPreview ? `<span>Đọc được ${A.bankPreview.length} câu</span><button class="primary" data-act="b-apply">Lưu thay ngân hàng hiện tại</button>` : ""}</div></div>
    <div class="panel"><h2>Danh sách câu</h2><div class="tablebox"><table><thead><tr><th>ID</th><th>Bộ</th><th>Nhãn</th><th>Câu tiếng Nhật</th><th>Nghĩa</th><th></th></tr></thead><tbody>
    ${items.map(b => `<tr><td>${esc(b.id)}${used.has(b.id) ? ' <span class="pill">đã dùng</span>' : ""}</td><td>${esc(b.set)}</td><td>${esc(b.label)}</td><td class="jp" style="font-weight:500">${esc(b.jp)}</td><td class="note">${esc(b.vn)}</td>
      <td>${A.confirm === "b:" + b.id ? `<button class="danger" data-act="b-del2" data-id="${esc(b.id)}">Xóa</button>` : `<button data-act="b-del" data-id="${esc(b.id)}" aria-label="Xóa câu ${esc(b.id)}">✕</button>`}</td></tr>`).join("")}</tbody></table></div></div>`;
  return h;
}
function roleOpts(cur) { return Object.entries(ROLES).map(([k, v]) => `<option value="${k}" ${k === cur ? "selected" : ""}>${v.vi}</option>`).join("") }
function vAccounts() {
  const seats = {}; A.users.filter(u => u.role === "judge" && u.seat).forEach(u => { seats[u.seat] = (seats[u.seat] || 0) + 1 });
  const dup = Object.entries(seats).filter(([, n]) => n > 1).map(([s]) => s);
  let h = `<div class="panel"><h2>Tạo tài khoản</h2>
    <p class="note">Quyền: <b>Quản trị</b> – toàn bộ, kể cả trang này · <b>MC / Thư ký</b> – điều khiển lượt thi và màn hình lớn · <b>Giám khảo</b> – chỉ chấm điểm ở ghế được gán · <b>Màn hình lớn</b> – chỉ xem (dùng cho máy chiếu).</p>
    <form id="newUser" class="form-grid">
      <div class="field"><label for="nu-email">Email</label><input id="nu-email" type="email" required></div>
      <div class="field"><label for="nu-name">Tên hiển thị</label><input id="nu-name" required placeholder="VD: Giám khảo 1 – Anh A"></div>
      <div class="field"><label for="nu-pw">Mật khẩu ban đầu</label><div class="row" style="flex-wrap:nowrap"><input id="nu-pw" required minlength="6" value="${esc(A.newPw)}" style="flex:1"><button type="button" data-act="genpw">Tạo</button></div></div>
      <div class="field"><label for="nu-role">Vị trí / quyền</label><select id="nu-role">${roleOpts("judge")}</select></div>
      <div class="field"><label for="nu-seat">Ghế giám khảo</label><select id="nu-seat"><option value="">–</option>${[1, 2, 3, 4, 5].map(n => `<option>${n}</option>`).join("")}</select></div>
      <button class="primary" type="submit">Tạo tài khoản</button>
    </form><p class="note">Gửi email và mật khẩu ban đầu cho người dùng qua kênh riêng; họ có thể đổi bằng "Quên mật khẩu" ở trang đăng nhập.</p></div>`;
  h += `<div class="panel"><h2>Tài khoản (${A.users.length})</h2>${dup.length ? `<div class="err">Ghế giám khảo bị trùng: ${dup.join(", ")}. Mỗi ghế chỉ một người.</div>` : ""}
    <div class="tablebox"><table><thead><tr><th>Email</th><th>Tên hiển thị</th><th>Vị trí / quyền</th><th>Ghế</th><th></th></tr></thead><tbody>
    ${A.users.sort((a, b) => (a.role || "").localeCompare(b.role || "") || (a.seat || 0) - (b.seat || 0)).map(u => `<tr>
      <td>${esc(u.email)}${u.uid === A.me.user.uid ? ' <span class="pill">bạn</span>' : ""}</td>
      <td><input aria-label="Tên hiển thị" data-act="u-name" data-uid="${u.uid}" value="${esc(u.name || "")}"></td>
      <td><select aria-label="Quyền" data-act="u-role" data-uid="${u.uid}">${roleOpts(u.role || "none")}</select></td>
      <td><select aria-label="Ghế" data-act="u-seat" data-uid="${u.uid}" ${u.role === "judge" ? "" : "disabled"}><option value="">–</option>${[1, 2, 3, 4, 5].map(n => `<option ${Number(u.seat) === n ? "selected" : ""}>${n}</option>`).join("")}</select></td>
      <td><div class="row" style="flex-wrap:nowrap"><button data-act="u-reset" data-email="${esc(u.email)}">Gửi email đổi mật khẩu</button></div></td></tr>`).join("")}</tbody></table></div>
    <p class="note">Thu hồi quyền: chọn "Chưa cấp quyền". Muốn xóa hẳn tài khoản đăng nhập, vào Firebase Console › Authentication.</p></div>`;
  return h;
}
function vSettings() {
  const s = Object.assign({}, DEFAULT_SETTINGS, A.settings || {});
  const f = (id, label, val, type = "text", extra = "") => `<div class="field"><label for="${id}">${label}</label><input id="${id}" type="${type}" value="${esc(val)}" ${extra}></div>`;
  return `<div class="panel"><h2>Cài đặt chương trình</h2><form id="settingsForm" class="form-grid">
    ${f("s-title", "Tiêu đề hiển thị", s.title)}${f("s-date", "Ngày thi", s.eventDate)}
    ${f("s-main", "Số lượt chính", s.mainRounds, "number", 'min="1" max="20"')}${f("s-k", "Hệ số điểm nền (TB × hệ số)", s.kBase, "number", 'min="0" step="0.5"')}
    ${f("s-bonus", "Thưởng ngôi sao thành công", s.starBonus, "number", 'min="0" step="0.5"')}${f("s-ptb", "Phạt sao – người Trung bình", s.penTB, "number", 'min="0" step="0.5"')}
    ${f("s-pde", "Phạt sao – người Dễ", s.penDe, "number", 'min="0" step="0.5"')}
    <button class="primary" type="submit">Lưu cài đặt</button></form>
    <p class="note">Điểm tối đa vòng 1 = hệ số điểm nền + thưởng ngôi sao = <b>${Number(s.kBase) + Number(s.starBonus)}</b>. Số giám khảo chỉnh ở trang Điều khiển. Ngôi sao thành công khi ≥ 3/4 giám khảo Đạt.</p></div>`;
}
function vData() {
  const r = A.results.length;
  return `<div class="panel"><h2>Xuất dữ liệu</h2><p class="note">${r} lượt đã ghi.</p>
    <div class="row"><button data-act="exp-results" ${r ? "" : "disabled"}>Tải kết quả từng lượt (CSV)</button><button data-act="exp-roster">Tải danh sách thành viên (CSV)</button></div></div>
    <div class="panel"><h2>Xóa dữ liệu thi thử</h2><p class="note">Xóa toàn bộ kết quả, phiếu chấm, danh sách vắng mặt và đưa lượt thi về trạng thái chờ. Danh sách thành viên, ngân hàng câu, tài khoản giữ nguyên.</p>
    <div class="row">${A.confirm === "reset" ? `<span class="note">Chắc chắn xóa?</span><button class="danger" data-act="reset2">Xóa hết</button><button data-act="noconfirm">Không</button>` : `<button class="danger" data-act="reset">Xóa kết quả thi thử</button>`}</div></div>`;
}
function renderLogin() {
  app.innerHTML = `<div class="wrap"><div class="panel login"><div class="eyebrow">Start Kaiwa Contest</div><h1>Đăng nhập quản trị</h1>
    ${A.err ? `<div class="err">${esc(A.err)}</div>` : ""}
    <form id="loginForm" class="form-grid" style="grid-template-columns:1fr"><div class="field"><label for="em">Email</label><input id="em" type="email" autocomplete="username" required></div>
    <div class="field"><label for="pw">Mật khẩu</label><input id="pw" type="password" autocomplete="current-password" required></div><button class="primary" type="submit">Đăng nhập</button></form>
    <a href="index.html">Về trang chính</a></div></div>`;
}
function render() {
  if (!configured) { app.innerHTML = `<div class="wrap"><div class="panel login"><h1>Chưa cấu hình</h1><p>Điền <code>js/firebase-config.js</code> theo README.md.</p></div></div>`; return }
  if (!A.authKnown) { app.innerHTML = `<div class="wrap"><p class="muted">Đang tải…</p></div>`; return }
  if (!A.me) return renderLogin();
  if (!isAdmin()) { app.innerHTML = `<div class="wrap"><div class="panel login"><h1>Không có quyền</h1><p>Trang này chỉ dành cho tài khoản Quản trị.</p><div class="row"><a class="pill" href="index.html">Về trang chính</a><button data-act="logout">Đăng xuất</button></div></div></div>`; return }
  const body = { members: vMembers, bank: vBank, accounts: vAccounts, settings: vSettings, data: vData }[A.tab]();
  const ae = document.activeElement, keep = ae && ae.id && ae.tagName === "TEXTAREA" ? { id: ae.id, v: ae.value } : null;
  app.innerHTML = shell(body);
  if (keep) { const t = document.getElementById(keep.id); if (t) t.value = keep.v }
}

/* ---------- CSV ---------- */
function download(name, rows) {
  const csv = "﻿" + rows.map(r => r.map(v => { const s = String(v == null ? "" : v); return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s }).join(",")).join("\n");
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function memberInfo(tid, mid) { const t = (A.roster.teams || []).find(t => t.id === tid); const m = t && (t.members || []).find(m => m.id === mid); return { team: t ? t.name : tid, name: m ? m.name : mid, level: m ? m.level : "" } }

/* ---------- events ---------- */
const markDirty = () => { A.dirty = true };
app.addEventListener("input", e => {
  const s = e.target, a = s.dataset && s.dataset.act; if (!a || !A.draft) return;
  const t = A.draft.teams[Number(s.dataset.t)];
  if (a === "t-name") { t.name = s.value; markDirty() }
  if (a === "m-name") { t.members[Number(s.dataset.m)].name = s.value; markDirty() }
  if (A.dirty && !document.querySelector('[data-act="m-revert"]')) { const pos = s.selectionStart; render(); const el = document.querySelector(`[data-act="${a}"][data-t="${s.dataset.t}"]${s.dataset.m ? `[data-m="${s.dataset.m}"]` : ""}`); if (el) { el.focus(); try { el.setSelectionRange(pos, pos) } catch (x) { } } }
});
app.addEventListener("change", e => {
  const s = e.target, a = s.dataset && s.dataset.act; if (!a) return;
  if (a === "m-level") { A.draft.teams[Number(s.dataset.t)].members[Number(s.dataset.m)].level = s.value; markDirty(); render() }
  const u = A.users.find(x => x.uid === s.dataset.uid);
  if (a === "u-role" && u) { const patch = { role: s.value }; if (s.value !== "judge") patch.seat = null; run(() => db.doc("users/" + u.uid).merge(patch), "Đã cập nhật quyền cho " + u.email) }
  if (a === "u-seat" && u) run(() => db.doc("users/" + u.uid).merge({ seat: s.value ? Number(s.value) : null }), "Đã gán ghế " + (s.value || "–") + " cho " + u.email);
  if (a === "u-name" && u) run(() => db.doc("users/" + u.uid).merge({ name: s.value.trim() }), "Đã đổi tên hiển thị");
});
app.addEventListener("click", e => {
  const b = e.target.closest("[data-act]"); if (!b || b.tagName === "SELECT" || b.tagName === "INPUT") return;
  const a = b.dataset.act, d = A.draft;
  if (a === "tab") { A.tab = b.dataset.tab; A.err = A.msg = null; A.confirm = null; render() }
  else if (a === "logout") logout();
  else if (a === "t-add") { d.teams.push({ id: "t" + Date.now().toString(36), name: "Team " + (d.teams.length + 1), members: [] }); markDirty(); render() }
  else if (a === "t-del") { d.teams.splice(Number(b.dataset.t), 1); markDirty(); render() }
  else if (a === "m-add") { const t = d.teams[Number(b.dataset.t)]; t.members.push({ id: t.id + "m" + Date.now().toString(36), name: "", level: "Chưa biết" }); markDirty(); render() }
  else if (a === "m-del") { d.teams[Number(b.dataset.t)].members.splice(Number(b.dataset.m), 1); markDirty(); render() }
  else if (a === "m-revert") { A.draft = clone(A.roster); A.dirty = false; render() }
  else if (a === "m-save") {
    const clean = { teams: d.teams.map(t => ({ id: t.id, name: t.name.trim(), members: t.members.filter(m => m.name.trim()).map(m => ({ id: m.id, name: m.name.trim(), level: m.level })) })), updatedAt: Date.now() };
    run(async () => { await db.doc("setup/roster").set(clean); A.dirty = false }, "Đã lưu danh sách thành viên");
  }
  else if (a === "m-parse") { try { A.preview = parseRoster(document.getElementById("rosterPaste").value); A.err = null } catch (x) { A.preview = null; A.err = x.message } render() }
  else if (a === "m-apply") { A.draft = { teams: A.preview.teams }; A.preview = null; markDirty(); flash("Đã đưa vào bản nháp. Kiểm tra rồi bấm Lưu danh sách.") }
  else if (a === "b-parse") { try { A.bankPreview = parseBank(document.getElementById("bankPaste").value); A.err = null } catch (x) { A.bankPreview = null; A.err = x.message } render() }
  else if (a === "b-apply") { const items = A.bankPreview; run(async () => { await db.doc("setup/bank").set({ items, updatedAt: Date.now() }); A.bankPreview = null }, "Đã lưu " + items.length + " câu") }
  else if (a === "b-del") { A.confirm = "b:" + b.dataset.id; render() }
  else if (a === "b-del2") { const items = A.bank.items.filter(x => x.id !== b.dataset.id); A.confirm = null; run(() => db.doc("setup/bank").set({ items, updatedAt: Date.now() }), "Đã xóa câu " + b.dataset.id) }
  else if (a === "genpw") { const ch = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"; A.newPw = Array.from(crypto.getRandomValues(new Uint32Array(10)), x => ch[x % ch.length]).join(""); const el = document.getElementById("nu-pw"); if (el) el.value = A.newPw }
  else if (a === "u-reset") run(() => resetPassword(b.dataset.email), "Đã gửi email đổi mật khẩu tới " + b.dataset.email);
  else if (a === "exp-results") {
    const rows = [["Team", "Thành viên", "Trình độ", "Giai đoạn", "Lượt chính", "Nhãn câu", "Ngôi sao", "Loại câu sao", "ID câu", "Số GK Đạt", "Số GK", "Điểm lượt", "Điểm sao", "Thời gian"]];
    [...A.results].sort((x, y) => (x.at || 0) - (y.at || 0)).forEach(r => { const m = memberInfo(r.teamId, r.memberId); rows.push([m.team, m.name, m.level, r.phase === "opening" ? "Mở màn" : "Chính", r.mainIndex || "", r.playLevel, r.star ? "Có" : "", r.starType || "", r.sentenceId, r.pass, r.judges, r.points, r.starPts || 0, new Date(r.at || 0).toLocaleString("vi-VN")]) });
    download("ket-qua-vong-1.csv", rows);
  }
  else if (a === "exp-roster") { const rows = [["Team", "Họ và tên", "Trình độ", "Mã"]]; (A.roster.teams || []).forEach(t => (t.members || []).forEach(m => rows.push([t.name, m.name, m.level, m.id]))); download("danh-sach-thanh-vien.csv", rows) }
  else if (a === "reset") { A.confirm = "reset"; render() }
  else if (a === "noconfirm") { A.confirm = null; render() }
  else if (a === "reset2") { A.confirm = null; run(async () => { const n1 = await db.deleteAll("results"); const n2 = await db.deleteAll("votes"); await db.doc("game/absent").set({}); await db.doc("game/state").set({ status: "idle", judgeCount: 4, updatedAt: Date.now() }); flash(`Đã xóa ${n1} kết quả và ${n2} phiếu chấm.`) }) }
});
app.addEventListener("submit", async e => {
  e.preventDefault(); const id = e.target.id; const v = x => document.getElementById(x).value;
  if (id === "loginForm") { try { await login(v("em"), v("pw")) } catch (x) { flash(null, errText(x)) } }
  if (id === "newUser") {
    const email = v("nu-email").trim(), name = v("nu-name").trim(), pw = v("nu-pw"), role = v("nu-role"), seat = v("nu-seat");
    if (role === "judge" && !seat) return flash(null, "Giám khảo cần được gán số ghế.");
    run(async () => { const uid = await createAccount(email, pw); await db.doc("users/" + uid).set({ email, name, role, seat: role === "judge" ? Number(seat) : null, createdAt: Date.now() }); A.newPw = ""; e.target.reset() }, "Đã tạo tài khoản " + email);
  }
  if (id === "settingsForm") {
    const num = x => Number(v(x));
    const s = { title: v("s-title").trim() || DEFAULT_SETTINGS.title, eventDate: v("s-date").trim(), mainRounds: num("s-main") || 7, kBase: num("s-k"), starBonus: num("s-bonus"), penTB: num("s-ptb"), penDe: num("s-pde"), updatedAt: Date.now() };
    run(() => db.doc("setup/settings").set(s), "Đã lưu cài đặt");
  }
});
window.addEventListener("beforeunload", e => { if (A.dirty) { e.preventDefault(); e.returnValue = "" } });

watchAuth(info => {
  A.authKnown = true;
  if (!info.user) { A.subs.forEach(f => f()); A.subs = []; A.me = null; render(); return }
  const was = A.me && A.me.role; A.me = info;
  if (info.role === "admin" && (was !== "admin" || !A.subs.length)) subscribe();
  render();
});
render();
