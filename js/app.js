// Start Kaiwa · Shadowing Relay – trang thi đấu (Điều khiển / Giám khảo / Màn hình lớn)
import { configured, db, watchAuth, login, logout, resetPassword, errText, ROLES, DEFAULT_SETTINGS, esc, lsGet, lsSet } from "./core.js";

const LAB = { "Chưa biết": "Dễ", "N5": "Dễ", "N4": "Trung bình", "N3": "Trung bình", "N2": "Khó", "N1": "Khó" };
const LVC = { "Dễ": "lv-cb", "Trung bình": "lv-n4", "Khó": "lv-n2", "★": "lv-n1" };
const LVJ = { "Dễ": "やさしい", "Trung bình": "ふつう", "Khó": "むずかしい", "★": "スター" };
const STAR_SHOW = 3;
const VIEWS_BY_ROLE = { admin: ["dieu-khien", "giam-khao", "man-hinh"], control: ["dieu-khien", "man-hinh"], judge: ["giam-khao"], viewer: ["man-hinh"], none: [] };

const S = { me: null, roster: null, bank: null, settings: null, state: null, absent: {}, votes: [], myVote: null, results: [], err: null, ready: false, subs: [], voteSub: null, voteKey: null,
  ui: { confirm: null, sel: {}, loginErr: null, loginMsg: null, busy: false } };
const app = document.getElementById("app");

/* ---------- settings ---------- */
const cfg = () => Object.assign({}, DEFAULT_SETTINGS, S.settings || {});
const MAIN_ROUNDS = () => Number(cfg().mainRounds) || 7;
const K_BASE = () => Number(cfg().kBase) || 23;
const STAR_BONUS = () => Number(cfg().starBonus) || 0;
const STAR_PEN = (lab) => lab === "Trung bình" ? Number(cfg().penTB) || 0 : Number(cfg().penDe) || 0;
const MAX_V1 = () => K_BASE() + STAR_BONUS();
const clampV1 = v => Math.max(0, Math.min(MAX_V1(), v));
const role = () => (S.me && S.me.role) || "none";
const canControl = () => ["admin", "control"].includes(role());
const view = () => { const h = (location.hash || "").slice(1); return (VIEWS_BY_ROLE[role()] || []).includes(h) ? h : "home" };
const fmt = (n, d = 2) => (Math.round(n * Math.pow(10, d)) / Math.pow(10, d)).toFixed(d).replace(".", ",");
const judgeCount = () => Number(S.state && S.state.judgeCount) || 4;
const labelOf = m => LAB[m && m.level] || "Dễ";

/* ---------- derived data ---------- */
function teams() {
  const ts = (S.roster && Array.isArray(S.roster.teams)) ? S.roster.teams : [];
  return ts.map(t => ({ ...t, members: (t.members || []).map(m => ({ ...m, absent: S.absent[m.id] || null })) }));
}
function bankItems() { return (S.bank && Array.isArray(S.bank.items)) ? S.bank.items : [] }
function member(teamId, memberId) { const t = teams().find(t => t.id === teamId); return t ? t.members.find(m => m.id === memberId) : null }
function teamName(id) { const t = teams().find(t => t.id === id); return t ? t.name : id }
function usedIds() { const u = new Set(S.results.map(r => r.sentenceId)); if (S.state && S.state.sentenceId && S.state.status !== "idle") u.add(S.state.sentenceId); return u }
function sentence(id) { return bankItems().find(b => b.id === id) }
function itemLabel(b) { return b.label || LAB[b.level] || "Dễ" }
function itemSet(b) { return b.set || "Thường" }
function levelItems(lab) { return bankItems().filter(b => itemSet(b) === "Thường" && itemLabel(b) === lab) }
function hashStr(x) { let h = 2166136261; for (let i = 0; i < x.length; i++) { h ^= x.charCodeAt(i); h = Math.imul(h, 16777619) } return h >>> 0 }
/* bảng ngôi sao: luôn STAR_SHOW câu Dễ + STAR_SHOW câu Khó chưa dùng, vị trí trộn theo lượt */
function starBoard(turnKey) {
  const used = usedIds(), cur = S.state && S.state.sentenceId;
  const pick = lab => bankItems().filter(b => itemSet(b) === "Ngôi sao" && itemLabel(b) === lab && (!used.has(b.id) || b.id === cur)).slice(0, STAR_SHOW);
  return [...pick("Dễ"), ...pick("Khó")].map(b => ({ b, k: hashStr(String(turnKey) + b.id) })).sort((x, y) => x.k - y.k).map(x => x.b);
}
function starLeft(lab) { const used = usedIds(); return bankItems().filter(b => itemSet(b) === "Ngôi sao" && itemLabel(b) === lab && !used.has(b.id)).length }
function stats() {
  return teams().map(t => {
    const ms = t.members;
    const rs = S.results.filter(r => r.teamId === t.id);
    const excused = ms.filter(m => m.absent === "excused").length;
    const denom = Math.max(ms.length - excused, 0);
    const total = rs.reduce((a, r) => a + (Number(r.points) || 0), 0);
    const avg = denom ? total / denom : 0;
    const starPts = rs.reduce((a, r) => a + (Number(r.starPts) || 0), 0);
    const starUsed = rs.some(r => r.star) || !!(S.state && S.state.star && S.state.teamId === t.id && ["picking", "open"].includes(S.state.status));
    const eligible = ms.filter(m => !m.absent).length;
    const extras = Math.max(0, eligible - MAIN_ROUNDS()), mains = Math.min(MAIN_ROUNDS(), eligible);
    const played = rs.length, inOpening = played < extras;
    return { id: t.id, name: t.name, members: ms, played, denom, total, avg, starPts, starUsed, score: clampV1(avg * K_BASE() + starPts), eligible, extras, mains, inOpening,
      mainDone: Math.max(0, played - extras), playedIds: new Set(rs.map(r => r.memberId)), nextTurn: played + 1 };
  });
}
/* xếp hạng trên màn hình lớn: chốt theo lượt chính đã xong của cả 7 team */
function rankings() {
  const all = stats(); if (!all.length) return { round: 0, rows: [] };
  const maxR = Math.max(0, ...all.map(s => s.mains));
  let R = 0;
  for (let k = 1; k <= maxR; k++) { if (all.every(s => s.played >= s.extras + Math.min(k, s.mains))) R = k; else break }
  const metricAt = (s, k) => {
    const lim = s.extras + Math.min(k, s.mains);
    const rs = S.results.filter(r => r.teamId === s.id && (Number(r.turnIndex) || 0) <= lim);
    const sum = rs.reduce((a, r) => a + (Number(r.points) || 0), 0), sp = rs.reduce((a, r) => a + (Number(r.starPts) || 0), 0);
    const unex = k >= maxR ? s.members.filter(m => m.absent === "unexcused").length : 0;
    const n = rs.length + unex; return clampV1((n ? sum / n : 0) * K_BASE() + sp);
  };
  const rankList = k => {
    const m = all.map(s => ({ id: s.id, name: s.name, v: Math.round(metricAt(s, k) * 1e6) / 1e6 }));
    m.sort((a, b) => b.v - a.v || a.name.localeCompare(b.name, "vi", { numeric: true }));
    m.forEach((x, i) => { x.rank = (i && m[i - 1].v === x.v) ? m[i - 1].rank : i + 1 }); return m;
  };
  const cur = R ? rankList(R) : [], prev = R > 1 ? rankList(R - 1) : [];
  cur.forEach(x => { const pv = prev.find(p => p.id === x.id); x.move = pv ? pv.rank - x.rank : 0 });
  return { round: R, maxRound: maxR, rows: cur, final: R >= maxR && maxR > 0 };
}
const tr = (vi, jp) => `<span class="t-vi">${vi}</span><span class="t-ja">${jp}</span>`;
const lang = () => lsGet("lang") === "ja" ? "ja" : "vi";
function langSwitch(stage) { const l = lang(); return `<div class="lang ${stage ? "lang-stage" : ""}" role="group" aria-label="Ngôn ngữ / 言語"><button data-act="lang" data-l="vi" class="${l === "vi" ? "sel" : ""}" aria-pressed="${l === "vi"}">VI</button><button data-act="lang" data-l="ja" class="${l === "ja" ? "sel" : ""}" aria-pressed="${l === "ja"}">日本語</button></div>` }
const homeBtn = (stage) => stage ? `<a href="#">${tr("Về trang chính", "トップへ")}</a>` : `<a href="#" class="pill">${tr("Về trang chính", "トップへ")}</a>`;
function turnLabel(phase, idx) { return phase === "opening" ? tr("lượt mở màn", "オープニングターン") : (idx >= MAIN_ROUNDS() ? tr("lượt cuối", "最終ターン") : tr("lượt chính " + idx, "本戦 第" + idx + "ターン")) }
function phaseInfo() {
  const all = stats(); if (!all.length) return { kind: "none", label: "", sub: "" };
  const MR = MAIN_ROUNDS();
  const openLeft = all.filter(s => s.inOpening);
  if (openLeft.length) return { kind: "opening", label: "Lượt mở màn", labelJa: "オープニングターン", sub: "Team trên " + MR + " người · không dùng ngôi sao", subJa: (MR + 1) + "名以上のチーム・スター使用不可", teams: openLeft };
  const mainLeft = all.filter(s => s.mainDone < s.mains);
  if (!mainLeft.length) return { kind: "done", label: "Kết thúc vòng 1", labelJa: "第1ラウンド終了", sub: "Đã thi xong toàn bộ lượt", subJa: "全ターン終了", round: MR };
  const round = Math.min(...mainLeft.map(s => s.mainDone + 1));
  if (round >= MR) return { kind: "final", label: "Lượt cuối", labelJa: "最終ターン", sub: "Lượt chính " + MR + "/" + MR + " · cơ hội cuối dùng ngôi sao", subJa: "本戦 " + MR + "/" + MR + "・スター最後のチャンス", round };
  return { kind: "main", label: "Lượt chính " + round + "/" + MR, labelJa: "本戦 第" + round + "/" + MR + "ターン", sub: "Cả " + all.length + " team · mỗi team 1 ngôi sao", subJa: "全" + all.length + "チーム・スターは各チーム1回", round };
}
const closing = {};
function queueAutoClose() {
  const st = S.state; if (!st || st.status !== "open" || !st.turnKey) return;
  if (view() !== "dieu-khien" || !canControl() || closing[st.turnKey]) return;
  if (Object.keys(votesFor(st.turnKey)).length < judgeCount()) return;
  const key = st.turnKey; closing[key] = true;
  setTimeout(() => { const s2 = S.state; if (s2 && s2.status === "open" && s2.turnKey === key && Object.keys(votesFor(key)).length >= judgeCount()) closeTurn(); }, 900);
}
function votesFor(turnKey) { const out = {}; S.votes.filter(v => v.turnKey === turnKey).forEach(v => { out[v.seat] = v.vote }); return out }
const bonusMin = () => Math.ceil(judgeCount() * 0.75);
function pointsFor(st, vmap) {
  const n = judgeCount(); let pass = 0; for (let i = 1; i <= n; i++) if (vmap[i] === "pass") pass++;
  const base = pass / n; let starPts = 0, ok = false;
  if (st.star) { ok = pass >= bonusMin(); starPts = ok ? STAR_BONUS() : -STAR_PEN(st.ownLabel) }
  return { pass, base, starPts, ok, points: base, voted: Object.keys(vmap).length };
}
function progressBar(voted, n, stage) {
  const pct = n ? Math.round(voted / n * 100) : 0;
  return `<div class="prog ${stage ? "stage-prog" : ""}" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><div class="prog-track"><i style="width:${pct}%"></i></div><span>${voted >= n ? tr("Đã chấm xong", "採点完了") : tr("Đang chấm", "採点中")} · ${pct}%</span></div>`;
}

/* ---------- store ---------- */
function unsubAll() { S.subs.forEach(f => { try { f() } catch (e) { } }); S.subs = []; if (S.voteSub) { S.voteSub(); S.voteSub = null; S.voteKey = null } }
function subscribe() {
  unsubAll();
  const onErr = e => { S.err = e && e.code === "permission-denied" ? "Tài khoản này chưa có quyền xem dữ liệu thi." : "Mất kết nối dữ liệu (" + (e && e.code || "lỗi") + "). Tải lại trang để kết nối lại."; render() };
  S.subs.push(db.doc("setup/roster").onSnapshot(s => { S.roster = s.exists ? s.data() : null; S.ready = true; render() }, onErr));
  S.subs.push(db.doc("setup/bank").onSnapshot(s => { S.bank = s.exists ? s.data() : null; render() }, onErr));
  S.subs.push(db.doc("setup/settings").onSnapshot(s => { S.settings = s.exists ? s.data() : null; render() }, onErr));
  S.subs.push(db.doc("game/state").onSnapshot(s => { S.state = s.exists ? s.data() : null; syncMyVote(); render(); queueAutoClose() }, onErr));
  S.subs.push(db.doc("game/absent").onSnapshot(s => { S.absent = s.exists ? (s.data() || {}) : {}; render() }, onErr));
  S.subs.push(db.collection("results").onSnapshot(q => { S.results = q.docs.map(d => Object.assign({ key: d.id }, d.data())); render() }, onErr));
  if (role() !== "judge") S.subs.push(db.collection("votes").onSnapshot(q => { S.votes = q.docs.map(d => d.data()); render(); queueAutoClose() }, onErr));
}
/* giám khảo chỉ đọc được phiếu của chính mình: theo dõi đúng 1 tài liệu theo lượt hiện tại */
function syncMyVote() {
  if (role() !== "judge") return;
  const st = S.state, seat = S.me.seat;
  const key = st && st.turnKey && seat ? st.turnKey + "_j" + seat : null;
  if (key === S.voteKey) return;
  if (S.voteSub) { S.voteSub(); S.voteSub = null }
  S.voteKey = key; S.myVote = null;
  if (key) S.voteSub = db.doc("votes/" + key).onSnapshot(s => { S.myVote = s.exists ? s.data().vote : null; render() }, () => { });
}
async function write(fn) {
  try { await fn() } catch (e) { S.err = errText(e); render() }
}
async function setState(patch) {
  const cur = S.state || { judgeCount: 4, status: "idle" };
  await write(() => db.doc("game/state").set(Object.assign({}, cur, patch, { updatedAt: Date.now() })));
}

/* ---------- control actions ---------- */
function newKey() { return "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6) }
function sel(teamId) { if (!S.ui.sel[teamId]) S.ui.sel[teamId] = { member: null, star: false }; return S.ui.sel[teamId] }
function starAllowed(t, m) { return !!m && !t.inOpening && !t.starUsed && labelOf(m) !== "Khó" }
async function openBoard(teamId) {
  const u = sel(teamId), st = stats().find(s => s.id === teamId), m = member(teamId, u.member);
  if (!st || !m) return;
  const star = !!u.star && starAllowed(st, m);
  if (!st.inOpening && stats().some(s => s.inOpening)) return;
  { const ph = phaseInfo(); if (!st.inOpening && ph.round && st.mainDone >= ph.round) return; }
  await setState({ status: "picking", turnKey: newKey(), teamId, memberId: u.member, ownLevel: m.level, ownLabel: labelOf(m), playLevel: star ? "★" : labelOf(m),
    star, turnIndex: st.nextTurn, phase: st.inOpening ? "opening" : "main", mainIndex: st.inOpening ? 0 : st.mainDone + 1, sentenceId: null });
  S.ui.sel[teamId] = { member: null, star: false };
}
async function pickTile(id) { if (S.state && S.state.status === "picking") await setState({ status: "open", sentenceId: id }) }
async function pickRandom() {
  const used = usedIds(); const pool = (S.state.star ? starBoard(S.state.turnKey) : levelItems(S.state.playLevel)).filter(b => !used.has(b.id));
  if (!pool.length) return; await pickTile(pool[Math.floor(Math.random() * pool.length)].id);
}
async function closeTurn() {
  const st = S.state; if (!st || st.status !== "open") return;
  const vm = votesFor(st.turnKey), p = pointsFor(st, vm), sn = sentence(st.sentenceId);
  const doc = { turnKey: st.turnKey, teamId: st.teamId, memberId: st.memberId, ownLevel: st.ownLevel, ownLabel: st.ownLabel || "", playLevel: st.playLevel, star: !!st.star,
    starType: st.star && sn ? itemLabel(sn) : "", starPts: p.starPts, turnIndex: st.turnIndex, phase: st.phase || "main", mainIndex: st.mainIndex || 0,
    sentenceId: st.sentenceId, votes: vm, pass: p.pass, judges: judgeCount(), points: p.points, base: p.base, at: Date.now() };
  await write(() => db.doc("results/" + st.turnKey).set(doc));
  await setState({ status: "closed" });
}
async function nextTurn() { await setState({ status: "idle" }) }
async function cancelTurn() {
  const st = S.state; if (!st) return;
  for (const v of S.votes.filter(v => v.turnKey === st.turnKey)) { await write(() => db.doc("votes/" + st.turnKey + "_j" + v.seat).delete()) }
  await setState({ status: "idle", sentenceId: null });
}
async function undoResult(key) { await write(() => db.doc("results/" + key).delete()) }
async function setAbsent(memberId, val) {
  const next = Object.assign({}, S.absent); if (val) next[memberId] = val; else delete next[memberId];
  await write(() => db.doc("game/absent").set(next));
}

/* ---------- judge ---------- */
async function castVote(v) {
  const st = S.state, seat = Number(S.me.seat); if (!st || st.status !== "open" || !seat) return;
  S.myVote = v; render();
  await write(() => db.doc("votes/" + st.turnKey + "_j" + seat).set({ turnKey: st.turnKey, seat, vote: v, at: Date.now() }));
}

/* ---------- views ---------- */
function lvPill(lv) { return `<span class="pill lv ${LVC[lv] || ""}">${tr(lv === "★" ? "★ Ngôi sao" : esc(lv), LVJ[lv] || esc(lv))}</span>` }
const sgn = v => (v > 0 ? "+" : v < 0 ? "−" : "±") + fmt(Math.abs(v), 0);
function starMsg(st, p) {
  if (p.ok) return tr("★ Ngôi sao thành công · " + sgn(STAR_BONUS()) + " điểm", "★ スター成功・" + sgn(STAR_BONUS()) + "点");
  return p.starPts < 0 ? tr("Ngôi sao chưa thành công · " + sgn(p.starPts) + " điểm", "スター失敗・" + sgn(p.starPts) + "点") : tr("Ngôi sao chưa thành công · không bị trừ (người mới)", "スター失敗・減点なし（初級者）");
}
function banner() { return S.err ? `<div class="err">${esc(S.err)}</div>` : "" }
function whoAmI() {
  const r = ROLES[role()] || ROLES.none;
  return `<span class="who-am-i">${esc(S.me.name)} · ${tr(r.vi, r.ja)}${role() === "judge" && S.me.seat ? tr(" · ghế " + S.me.seat, "・席" + S.me.seat) : ""}</span>`;
}
function emptyState() { return `<div class="panel"><h2>Chưa có dữ liệu thi</h2><p class="muted">Danh sách thành viên và ngân hàng câu sẽ hiện ở đây sau khi Quản trị nạp dữ liệu ở trang Quản trị.</p></div>` }

function renderSetupNeeded() {
  app.innerHTML = `<div class="wrap"><div class="panel login"><h1>Chưa cấu hình</h1><p>Mở file <code>js/firebase-config.js</code> và điền cấu hình Firebase theo README.md.</p></div></div>`;
}
function renderLogin() {
  document.body.classList.remove("stage-mode");
  const u = S.ui;
  app.innerHTML = `<div class="wrap"><div class="panel login">
    ${langSwitch(false)}
    <div class="eyebrow">Contest Start Kaiwa</div><h1>${tr("Đăng nhập", "ログイン")}</h1>
    <p class="note">${tr("Dùng tài khoản do BTC cấp. Giám khảo, MC, thư ký và màn hình lớn mỗi vị trí một tài khoản.", "運営から発行されたアカウントでログインしてください。")}</p>
    ${u.loginErr ? `<div class="err">${esc(u.loginErr)}</div>` : ""}${u.loginMsg ? `<div class="ok">${esc(u.loginMsg)}</div>` : ""}
    <form id="loginForm" class="form-grid" style="grid-template-columns:1fr">
      <div class="field"><label for="em">Email</label><input id="em" type="email" autocomplete="username" required></div>
      <div class="field"><label for="pw">${tr("Mật khẩu", "パスワード")}</label><input id="pw" type="password" autocomplete="current-password" required></div>
      <button class="primary" type="submit" ${u.busy ? "disabled" : ""}>${tr("Đăng nhập", "ログイン")}</button>
    </form>
    <button data-act="forgot" type="button">${tr("Quên mật khẩu", "パスワードを忘れた場合")}</button>
  </div></div>`;
}
function renderNoRole() {
  app.innerHTML = `<div class="wrap"><div class="panel login"><h1>${tr("Chưa được cấp quyền", "権限がありません")}</h1>
    <p>${esc(S.me.name)}</p><p class="muted">${tr("Tài khoản đã đăng nhập nhưng chưa được Quản trị gán vị trí. Liên hệ BTC.", "管理者に権限の付与を依頼してください。")}</p>
    <button data-act="logout">${tr("Đăng xuất", "ログアウト")}</button></div></div>`;
}
function renderHome() {
  document.body.classList.remove("stage-mode");
  const views = VIEWS_BY_ROLE[role()] || [];
  const st = { "dieu-khien": [tr("MC · Thư ký", "司会・書記"), tr("Điều khiển", "進行管理"), tr("Chọn team, người chơi, ngôi sao, câu; chốt kết quả từng lượt.", "チーム・出場者・スター・文を選び、各ターンの結果を確定します。")],
    "giam-khao": [tr("Giám khảo", "審査員"), tr("Chấm điểm", "採点"), tr("Xem câu đang đọc và bấm Đạt / Không đạt.", "読み上げ中の文を見て「合格／不合格」を押します。")],
    "man-hinh": [tr("Máy chiếu", "プロジェクター"), tr("Màn hình lớn", "メインスクリーン"), tr("Câu, ngôi sao, kết quả lượt và xếp hạng các team.", "文・スター・ターン結果・順位を表示します。")] };
  const ph = phaseInfo(), c = cfg();
  app.innerHTML = `<div class="wrap" style="display:flex;flex-direction:column;gap:18px">
    <div class="topbar"><div>${langSwitch(false)}<div class="eyebrow">Contest ${esc(c.eventDate)} · ${tr("Vòng 1", "第1ラウンド")}</div><h1>${esc(c.title)}</h1></div>
      <div class="row">${whoAmI()}${role() === "admin" ? `<a class="pill" href="admin.html">${tr("Trang quản trị", "管理画面")}</a>` : ""}<button data-act="logout">${tr("Đăng xuất", "ログアウト")}</button></div></div>
    ${banner()}
    ${ph.label ? `<div class="panel" style="flex-direction:row;align-items:center;gap:12px;flex-wrap:wrap"><span class="eyebrow">${tr("Đang diễn ra", "進行中")}</span><b>${tr(ph.label, ph.labelJa)}</b><span class="note">${tr(ph.sub, ph.subJa)}</span></div>` : ""}
    <div class="stations">${views.map(v => `<a class="station" href="#${v}"><span class="eyebrow">${st[v][0]}</span><b>${st[v][1]}</b><span class="muted">${st[v][2]}</span></a>`).join("")}</div>
    <div class="panel"><h2>${tr("Luật tính điểm", "採点ルール")}</h2>
      <p class="note t-vi">Mỗi thành viên lên đúng 1 lượt, chọn câu theo nhãn trình độ: Dễ (Chưa biết, N5), Trung bình (N4, N3), Khó (N2). Team trên ${MAIN_ROUNDS()} người thi phần người dư trước ở lượt mở màn; sau đó các team thi ${MAIN_ROUNDS()} lượt chính. Điểm lượt = số giám khảo Đạt ÷ ${judgeCount()}. Ngôi sao hi vọng: mỗi team 1 lần, chỉ ở lượt chính, người N2 không được cầm; người cầm sao bốc 1 trong 6 ô (luôn 3 Dễ + 3 Khó). Từ ${bonusMin()}/${judgeCount()} giám khảo Đạt: +${STAR_BONUS()}; chưa đạt: người Trung bình −${STAR_PEN("Trung bình")}, người Dễ −${STAR_PEN("Dễ")}. Điểm vòng 1 = điểm trung bình × ${K_BASE()} + điểm ngôi sao (tối đa ${MAX_V1()}). Phiếu của từng giám khảo không được công khai.</p>
      <p class="note jp t-ja" style="font-weight:500">各メンバーは1回ずつ出場し、レベル別（やさしい：入門・N5／ふつう：N4・N3／むずかしい：N2）の文を選びます。得点 = 合格の審査員数 ÷ ${judgeCount()}。スターは各チーム1回・本戦のみ・N2は使用不可。スター保持者は6枚（やさしい3＋むずかしい3）から1枚を選びます。${bonusMin()}名以上合格で+${STAR_BONUS()}点、不合格の場合、ふつうレベルは−${STAR_PEN("Trung bình")}点、やさしいレベルは−${STAR_PEN("Dễ")}点。第1ラウンド得点 = 平均 × ${K_BASE()} + スター点（満点${MAX_V1()}）。</p></div>
  </div>`;
}
function renderControl() {
  document.body.classList.remove("stage-mode");
  const head = `<div class="topbar"><div><div class="eyebrow">${tr("Vòng 1", "第1ラウンド")} · Shadowing Relay</div><h1>${tr("Điều khiển", "進行管理")}</h1></div>
    <div class="row">${langSwitch(false)}${whoAmI()}<a href="#man-hinh" class="pill">${tr("Mở màn hình lớn", "メインスクリーン")}</a>${homeBtn(false)}</div></div>`;
  if (!S.roster || !S.bank) { app.innerHTML = `<div class="wrap" style="display:flex;flex-direction:column;gap:16px">${head}${banner()}${S.ready ? emptyState() : '<p class="muted">Đang kết nối…</p>'}</div>`; return }
  const st = S.state || { status: "idle" }, u = S.ui, all = stats(), used = usedIds(), MR = MAIN_ROUNDS();
  const busy = st.status === "picking" || st.status === "open";
  const opening = all.some(s => s.inOpening);
  const openLeft = all.filter(s => s.inOpening);
  const mainLeft = all.filter(s => !s.inOpening && s.mainDone < s.mains);
  const round = opening ? 0 : (mainLeft.length ? Math.min(...mainLeft.map(s => s.mainDone + 1)) : MR);
  let h = `<div class="wrap" style="display:flex;flex-direction:column;gap:16px">${head}${banner()}`;
  h += `<div class="panel"><div class="row" style="justify-content:space-between"><h2>${opening ? tr("Lượt mở màn", "オープニングターン") + " · " + openLeft.map(s => esc(s.name)).join(", ") : (round >= MR ? tr("Lượt cuối · lượt chính " + MR + "/" + MR, "最終ターン（本戦 " + MR + "/" + MR + "）") : tr("Lượt chính " + round + "/" + MR, "本戦 第" + round + "/" + MR + "ターン"))} ${tr(" · chọn người lên vạch", " · 出場者を選択")}</h2>
    <span class="note">${opening ? "Lượt mở màn dành cho team trên " + MR + " người, không dùng ngôi sao. Lượt chính: mỗi team 1 ngôi sao." : "Ngôi sao (mỗi team 1 lần, không cho N2): từ " + bonusMin() + "/" + judgeCount() + " Đạt +" + STAR_BONUS() + "; chưa đạt: TB −" + STAR_PEN("Trung bình") + ", Dễ −" + STAR_PEN("Dễ") + ". Bảng sao còn " + starLeft("Dễ") + " Dễ / " + starLeft("Khó") + " Khó."}</span></div><div class="teamgrid">`;
  for (const t of all) {
    const x = sel(t.id), m = x.member ? member(t.id, x.member) : null;
    const finished = t.members.every(mm => t.playedIds.has(mm.id) || mm.absent);
    const waitMain = opening && !t.inOpening && !finished;
    const doneRound = !opening && round > 0 && t.mainDone >= round;
    const blocked = waitMain || (doneRound && !finished);
    const starOK = starAllowed(t, m);
    if (!starOK) x.star = false;
    const isCur = busy && st.teamId === t.id;
    h += `<div class="tcard ${isCur ? "live" : ""} ${doneRound || finished || blocked ? "done" : ""}"><div class="row" style="justify-content:space-between"><b>${esc(t.name)}</b><span class="note">${t.played}/${t.members.length} · ${t.inOpening ? "mở màn " + (t.played + 1) + "/" + t.extras : "chính " + Math.min(t.mainDone + 1, t.mains) + "/" + t.mains} · ${t.starUsed ? '<span class="star">★</span> đã dùng' : '<span class="star">★</span> còn 1'}</span></div>`;
    if (finished) h += `<p class="note">Đã thi hết thành viên.</p>`;
    else {
      if (waitMain) h += `<p class="note"><b>${t.extras ? "Đã xong lượt mở màn" : "Không có lượt mở màn"}</b> · chờ các team còn lại xong mở màn để vào lượt chính 1.</p>`;
      if (doneRound) h += `<p class="note"><b>Đã xong ${round >= MR ? "lượt cuối" : "lượt chính " + round}</b> · chờ các team còn lại xong lượt này.</p>`;
      h += `<div class="chips">${t.members.map(mm => { const dn = t.playedIds.has(mm.id), ab = mm.absent;
        return `<button data-act="member" data-team="${esc(t.id)}" data-id="${esc(mm.id)}" class="chip ${x.member === mm.id ? "sel" : ""} ${dn ? "done" : ""}" ${dn || ab || busy || blocked ? "disabled" : ""} title="${esc(mm.level)}">${esc(mm.name)} <small>${esc(mm.level === "Chưa biết" ? "CB" : mm.level)}${ab ? " · vắng" : ""}</small></button>` }).join("")}</div>`;
      if (m && !blocked) {
        const why = t.inOpening ? "Lượt mở màn không dùng sao" : t.starUsed ? "Team đã dùng ngôi sao" : labelOf(m) === "Khó" ? "Người N2 không được cầm sao" : "";
        h += `<div class="row"><button data-act="star" data-team="${esc(t.id)}" class="${x.star ? "sel" : ""}" ${!starOK || busy ? "disabled" : ""}><span class="star">★</span> ${x.star ? tr("Có sao", "スターあり") : tr("Sao", "スター")}</button>${lvPill(x.star ? "★" : labelOf(m))}${why ? `<span class="note">${why}</span>` : ""}</div>
          <button class="primary" data-act="open" data-team="${esc(t.id)}" ${busy ? "disabled" : ""}>${tr("Lên vạch · mở bảng câu", "スタート")}</button>`;
      }
    }
    h += `</div>`;
  }
  h += `</div></div>`;
  h += `<div class="grid2"><div style="display:flex;flex-direction:column;gap:16px;min-width:0"><div class="panel"><h2>${tr("Lượt đang thi", "実施中のターン")}</h2>`;
  if (st.status === "idle" || !st.turnKey) h += `<p class="muted">Chưa có lượt nào đang mở. Chọn người chơi ở một team phía trên.</p>`;
  else {
    const cm = member(st.teamId, st.memberId), vm = votesFor(st.turnKey), p = pointsFor(st, vm), sn = st.sentenceId ? sentence(st.sentenceId) : null;
    h += `<div class="current"><div class="row"><b>${esc(teamName(st.teamId))}</b><span>${esc(cm ? cm.name : "")}</span>${lvPill(st.playLevel)}<span class="note">${turnLabel(st.phase, st.mainIndex)}</span></div>`;
    if (st.status === "picking" && st.star) {
      const items = starBoard(st.turnKey);
      h += `<p class="note">Bảng ngôi sao: ${items.filter(b => itemLabel(b) === "Dễ").length} Dễ + ${items.filter(b => itemLabel(b) === "Khó").length} Khó, trộn vị trí. Người chơi đọc số ô; bấm đúng ô đó.</p><div class="tiles">${items.map((b, i) => `<button data-act="tile" data-id="${esc(b.id)}">★${i + 1}</button>`).join("")}</div>
        <div class="row"><button data-act="random">${tr("Bốc ngẫu nhiên", "ランダム")}</button><button data-act="cancel" class="danger">${tr("Hủy lượt", "取消")}</button></div>`;
    } else if (st.status === "picking") {
      const items = levelItems(st.playLevel);
      h += `<p class="note">Người chơi đọc số ô; bấm đúng ô đó.</p><div class="tiles">${items.map((b, i) => `<button data-act="tile" data-id="${esc(b.id)}" class="${used.has(b.id) ? "used" : ""}" ${used.has(b.id) ? "disabled" : ""} title="${esc(b.id)}">${i + 1}</button>`).join("")}</div>
        <div class="row"><button data-act="random">${tr("Bốc ngẫu nhiên", "ランダム")}</button><button data-act="cancel" class="danger">${tr("Hủy lượt", "取消")}</button></div>`;
    } else if (sn) {
      h += `${st.star ? `<div class="row">${tr("Bốc trúng câu", "引いた文")} ${lvPill(itemLabel(sn))}</div>` : ""}<div class="jp sentence-j">${esc(sn.jp)}</div><div class="note">${esc(sn.id)} · ${esc(sn.vn)}</div>${progressBar(p.voted, judgeCount(), false)}`;
      if (st.status === "open") h += `<div class="row"><button class="primary" data-act="close">${p.voted < judgeCount() ? tr("Chốt (phiếu thiếu tính Không đạt)", "確定（未投票は不合格扱い）") : tr("Chốt kết quả", "結果を確定")}</button><button data-act="cancel" class="danger">${tr("Hủy lượt", "取消")}</button></div>`;
      else h += `<div class="row"><b>Đã chốt: ${p.pass}/${judgeCount()} Đạt · điểm lượt ${fmt(p.points)}${st.star ? " · ngôi sao " + sgn(p.starPts) : ""}</b><button class="primary" data-act="next">${tr("Lượt tiếp theo", "次へ")}</button></div>`;
    }
    h += `</div>`;
  }
  h += `</div></div>`;
  const ranked = [...all].sort((a, b) => b.score - a.score);
  h += `<div style="display:flex;flex-direction:column;gap:16px;min-width:0"><div class="panel"><h2>${tr("Bảng điểm chi tiết", "詳細スコア")}</h2><p class="note">Chỉ hiện ở màn hình điều khiển. Màn hình lớn chỉ hiện thứ hạng, cập nhật khi các team xong mỗi lượt. Điểm = TB × ${K_BASE()} + sao.</p><div class="tablebox"><table><thead><tr><th>Team</th><th class="num">Đã thi</th><th class="num">TB</th><th class="num">Sao</th><th class="num">/${MAX_V1()}</th></tr></thead><tbody>
    ${ranked.map(s => `<tr><td>${esc(s.name)}</td><td class="num">${s.played}/${s.denom}</td><td class="num">${fmt(s.avg)}</td><td class="num">${s.starUsed ? sgn(s.starPts) : "–"}</td><td class="num"><b>${fmt(s.score)}</b></td></tr>`).join("")}</tbody></table></div></div>`;
  h += `<div class="panel"><h2>${tr("Cài đặt lượt thi", "設定")}</h2><div class="row"><label for="jc">Số giám khảo</label><select id="jc" data-act="jc">${[2, 3, 4, 5].map(n => `<option ${n === judgeCount() ? "selected" : ""}>${n}</option>`).join("")}</select></div>`;
  const absT = all.find(s => s.id === u.absTeam);
  h += `<div class="row"><label for="abst">Vắng mặt của</label><select id="abst" data-act="absteam"><option value="">Chọn team</option>${all.map(s => `<option value="${esc(s.id)}" ${u.absTeam === s.id ? "selected" : ""}>${esc(s.name)}</option>`).join("")}</select></div>`;
  if (absT) h += `<div class="tablebox"><table><tbody>${absT.members.map(mm => `<tr><td>${esc(mm.name)}</td><td><select data-act="absent" data-id="${esc(mm.id)}" aria-label="Vắng mặt ${esc(mm.name)}"><option value="" ${!mm.absent ? "selected" : ""}>Có mặt</option><option value="excused" ${mm.absent === "excused" ? "selected" : ""}>Vắng có phép</option><option value="unexcused" ${mm.absent === "unexcused" ? "selected" : ""}>Vắng không phép (0 điểm)</option></select></td></tr>`).join("")}</tbody></table></div>`;
  h += `</div>`;
  const hist = [...S.results].sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, 12);
  h += `<div class="panel"><h2>${tr("Lượt gần đây", "最近のターン")}</h2>${hist.length ? `<div class="tablebox"><table><tbody>${hist.map(r => { const mm = member(r.teamId, r.memberId); return `<tr><td>${esc(teamName(r.teamId))}<div class="note">${esc(mm ? mm.name : "")}</div></td><td>${lvPill(r.star ? (r.starType || "★") : r.playLevel)}${r.star ? ' <span class="star">★</span>' : ""}</td><td class="num">${r.pass}/${r.judges} · ${fmt(r.points)}${r.star ? " · ★" + sgn(Number(r.starPts) || 0) : ""}</td><td>${u.confirm === r.key ? `<button class="danger" data-act="undo2" data-id="${esc(r.key)}">Xóa</button>` : `<button data-act="undo" data-id="${esc(r.key)}">Hủy</button>`}</td></tr>` }).join("")}</tbody></table></div>` : `<p class="muted">Chưa có lượt nào.</p>`}</div>`;
  h += `</div></div></div>`;
  app.innerHTML = h;
}
function renderJudge() {
  document.body.classList.remove("stage-mode");
  const seat = Number(S.me.seat) || 0, st = S.state || { status: "idle" };
  let h = `<div class="wrap judge" style="display:flex;flex-direction:column;gap:16px"><div class="topbar"><div><div class="eyebrow">${tr("Vòng 1 · Giám khảo", "第1ラウンド 審査員")}</div><h1>${seat ? tr("Giám khảo " + seat, "審査員 " + seat) : tr("Giám khảo", "審査員")}</h1></div><div class="row">${langSwitch(false)}${homeBtn(false)}</div></div>${banner()}`;
  if (role() === "admin" && !seat) h += `<div class="warn">${tr("Tài khoản Quản trị chỉ xem trước giao diện. Để chấm, đăng nhập bằng tài khoản giám khảo đã được gán ghế.", "管理者はプレビューのみ。採点は審査員アカウントで行ってください。")}</div>`;
  else if (!seat) h += `<div class="err">${tr("Tài khoản chưa được gán số ghế giám khảo. Liên hệ BTC.", "審査員席が未設定です。運営に連絡してください。")}</div>`;
  if (st.status !== "open" || !st.sentenceId) {
    h += `<div class="panel"><h2>${st.status === "closed" ? tr("Đã chốt lượt", "ターン確定") : tr("Chờ lượt tiếp theo", "次のターンを待っています")}</h2><p class="muted">${tr("Câu sẽ hiện ở đây khi MC mở lượt.", "司会がターンを開始すると、ここに文が表示されます。")}</p></div>`;
  } else {
    const sn = sentence(st.sentenceId), cm = member(st.teamId, st.memberId), mine = S.myVote;
    h += `<div class="panel"><div class="row"><b>${esc(teamName(st.teamId))}</b><span>${esc(cm ? cm.name : "")}</span>${lvPill(st.star && sn ? itemLabel(sn) : st.playLevel)}${st.star ? '<span class="star">★ ' + tr("ngôi sao", "スター") + '</span>' : ""}</div>
      <div class="jp sentence-j">${esc(sn ? sn.jp : "")}</div>${sn && sn.hira ? `<div class="jp muted" style="font-weight:500">${esc(sn.hira)}</div>` : ""}<div class="note t-vi">${esc(sn ? sn.vn : "")}</div></div>
      <div class="bigbtns"><button class="p ${mine === "pass" ? "sel" : ""}" data-act="vote" data-v="pass" ${!seat ? "disabled" : ""}>${tr("Đạt", "合格")}</button><button class="f ${mine === "fail" ? "sel" : ""}" data-act="vote" data-v="fail" ${!seat ? "disabled" : ""}>${tr("Không đạt", "不合格")}</button></div>
      <p class="note">${mine ? tr("Đã ghi phiếu. Có thể đổi cho đến khi MC chốt.", "投票済みです。司会が確定するまで変更できます。") : tr("Bấm sau khi người chơi đọc xong.", "出場者が読み終わってから押してください。")}</p>`;
  }
  app.innerHTML = h + "</div>";
}
let lastStageKey = "";
function renderStage() {
  document.body.classList.add("stage-mode");
  const st = S.state || { status: "idle" };
  const key = (st.turnKey || "") + st.status; const flash = key !== lastStageKey; lastStageKey = key;
  let main = "";
  if (!S.roster) main = `<div class="card"><div class="s-hira">${S.ready ? tr("Đang chờ BTC nạp dữ liệu thi", "データ準備中") : tr("Đang kết nối…", "接続中…")}</div></div>`;
  else if (st.status === "idle" || !st.turnKey) {
    main = `<div class="card ${flash ? "flash" : ""}"><div class="eyebrow" style="color:var(--stage-muted)">${tr("Sẵn sàng", "スタンバイ")}</div><div class="s-jp">次の方、どうぞ！</div><div class="s-hira">${tr("Mời người chơi tiếp theo lên vạch", "次の出場者はラインへどうぞ")}</div></div>`;
  } else {
    const cm = member(st.teamId, st.memberId);
    main = `<div class="who"><div><div class="team">${esc(teamName(st.teamId))} · ${turnLabel(st.phase, st.mainIndex)}</div><div class="name">${esc(cm ? cm.name : "")}</div></div>${lvPill(st.playLevel)}${st.star ? '<span class="bigstar" aria-label="Ngôi sao hi vọng">★</span>' : ""}</div>`;
    if (st.status === "picking") {
      const used = usedIds();
      main += st.star ? `<div class="card ${flash ? "flash" : ""}"><div class="eyebrow" style="color:var(--stage-muted)">${tr("Ngôi sao hi vọng · 3 câu Dễ + 3 câu Khó · chọn một ô", "スター・やさしい3＋むずかしい3・1枚選んでください")}</div><div class="tiles">${starBoard(st.turnKey).map((b, i) => `<div class="tile">★${i + 1}</div>`).join("")}</div></div>`
        : `<div class="card ${flash ? "flash" : ""}"><div class="eyebrow" style="color:var(--stage-muted)">${tr("Chọn một ô", "タイルを1つ選んでください")} · ${tr(esc(st.playLevel), LVJ[st.playLevel] || "")}</div><div class="tiles">${levelItems(st.playLevel).map((b, i) => `<div class="tile ${used.has(b.id) ? "used" : ""}">${i + 1}</div>`).join("")}</div></div>`;
    } else {
      const sn = sentence(st.sentenceId) || {}, vm = votesFor(st.turnKey), p = pointsFor(st, vm);
      const sl = itemLabel(sn), showHira = sl !== "Khó", showRo = sl === "Dễ";
      main += `<div class="card ${flash ? "flash" : ""}">${st.star ? `<div class="row">${tr("Bốc trúng", "引いた文")} ${lvPill(sl)}</div>` : ""}<div class="s-jp">${esc(sn.jp)}</div>${showHira && sn.hira ? `<div class="s-hira">${esc(sn.hira)}</div>` : ""}${showRo && sn.ro ? `<div class="s-ro">${esc(sn.ro)}</div>` : ""}
        <div class="row"><button data-act="tts" style="background:transparent;color:var(--stage-ink);border-color:var(--stage-muted)">▶ ${tr("Nghe mẫu", "お手本")}</button></div></div>`;
      if (st.status === "open") main += progressBar(p.voted, judgeCount(), true);
      else {
        const msg = st.star ? starMsg(st, p) : tr("Câu đúng nhãn trình độ", "自分のレベルの文");
        main += `<div class="result ${flash ? "flash" : ""}"><div class="pts ${p.points > 0 ? "good" : "zero"}">+${fmt(p.points)}${st.star ? `<span class="star" style="font-size:.5em"> ★${sgn(p.starPts)}</span>` : ""}</div><div><div class="team" style="color:var(--stage-ink)">${tr(p.pass + "/" + judgeCount() + " giám khảo Đạt", "審査員" + judgeCount() + "名中" + p.pass + "名が合格")}</div><div class="team" style="color:var(--stage-muted)">${msg}</div></div></div>`;
      }
    }
  }
  const rk = rankings();
  const arrow = m => m > 0 ? `<span class="mv up" aria-label="Tăng ${m} bậc">▲${m}</span>` : m < 0 ? `<span class="mv down" aria-label="Giảm ${-m} bậc">▼${-m}</span>` : `<span class="mv same" aria-label="Giữ nguyên">–</span>`;
  const nav = `<nav class="stage-nav" aria-label="Chuyển trang">${homeBtn(true)}${canControl() ? `<a href="#dieu-khien">${tr("Điều khiển", "進行")}</a>` : ""}${langSwitch(true)}</nav>`;
  const board = `<div class="board">${nav}<h2>${rk.round ? (rk.final ? tr("Xếp hạng chung cuộc vòng 1", "第1ラウンド 最終順位") : tr("Xếp hạng sau lượt chính " + rk.round, "本戦 第" + rk.round + "ターン終了時の順位")) : tr("Xếp hạng", "順位")}</h2>${rk.round ? rk.rows.map(x => `<div class="brow ${x.rank === 1 ? "lead" : ""}"><div class="rk">${x.rank}</div><div class="tn">${esc(x.name)}</div>${rk.round > 1 ? arrow(x.move) : ""}</div>`).join("") : `<p style="color:var(--stage-muted)">${tr("Xếp hạng hiện sau khi các team thi xong lượt chính 1.", "本戦第1ターンが全チーム終了すると順位を表示します。")}</p>`}</div>`;
  const ph = phaseInfo();
  app.innerHTML = `<div class="stage"><div class="main"><div class="brand"><h1>${esc(cfg().title)}</h1>${ph.label ? `<div class="phase phase-${ph.kind}"><b>${tr(ph.label, ph.labelJa)}</b><span>${tr(ph.sub, ph.subJa)}</span></div>` : `<span class="eyebrow">Contest ${esc(cfg().eventDate)}</span>`}</div>${S.err ? `<div class="err" style="color:var(--ink)">${esc(S.err)}</div>` : ""}${main}</div>${board}</div>`;
}
function render() {
  document.body.classList.toggle("lang-ja", lang() === "ja");
  document.title = (S.settings && S.settings.title) || "Start Kaiwa · Shadowing Relay";
  if (!configured) return renderSetupNeeded();
  if (!S.me) return S.authKnown ? renderLogin() : (app.innerHTML = `<div class="wrap"><p class="muted">Đang tải…</p></div>`);
  if (role() === "none") return renderNoRole();
  const v = view();
  if (v === "dieu-khien") renderControl(); else if (v === "giam-khao") renderJudge(); else if (v === "man-hinh") renderStage(); else renderHome();
}

/* ---------- events ---------- */
app.addEventListener("click", e => {
  const b = e.target.closest("[data-act]"); if (!b || b.tagName === "SELECT") return;
  const a = b.dataset.act, u = S.ui;
  if (a === "member") { const x = sel(b.dataset.team); x.member = x.member === b.dataset.id ? null : b.dataset.id; x.star = false; render() }
  else if (a === "star") { const x = sel(b.dataset.team); x.star = !x.star; render() }
  else if (a === "open") openBoard(b.dataset.team);
  else if (a === "tile") pickTile(b.dataset.id);
  else if (a === "random") pickRandom();
  else if (a === "close") closeTurn();
  else if (a === "next") nextTurn();
  else if (a === "cancel") cancelTurn();
  else if (a === "undo") { u.confirm = b.dataset.id; render() }
  else if (a === "undo2") { u.confirm = null; undoResult(b.dataset.id) }
  else if (a === "lang") { lsSet("lang", b.dataset.l); render() }
  else if (a === "vote") castVote(b.dataset.v);
  else if (a === "logout") logout();
  else if (a === "forgot") {
    const em = (document.getElementById("em") || {}).value || "";
    if (!em) { u.loginErr = "Nhập email trước rồi bấm Quên mật khẩu."; u.loginMsg = null; render(); return }
    resetPassword(em).then(() => { u.loginMsg = "Đã gửi email đặt lại mật khẩu (nếu email có tài khoản)."; u.loginErr = null; render() }).catch(err => { u.loginErr = errText(err); render() });
  }
  else if (a === "tts") { const sn = S.state && sentence(S.state.sentenceId); try { const t = new SpeechSynthesisUtterance(sn ? sn.jp : ""); t.lang = "ja-JP"; t.rate = .9; speechSynthesis.cancel(); speechSynthesis.speak(t) } catch (err) { } }
});
app.addEventListener("change", e => {
  const s = e.target; if (!s.dataset || !s.dataset.act) return;
  if (s.dataset.act === "jc") setState({ judgeCount: Number(s.value) });
  if (s.dataset.act === "absent") setAbsent(s.dataset.id, s.value);
  if (s.dataset.act === "absteam") { S.ui.absTeam = s.value || null; render() }
});
app.addEventListener("submit", async e => {
  if (e.target.id !== "loginForm") return;
  e.preventDefault();
  const em = document.getElementById("em").value, pw = document.getElementById("pw").value;
  const u = S.ui; u.busy = true; u.loginErr = null; u.loginMsg = null;
  try { await login(em, pw) } catch (err) { u.loginErr = errText(err) }
  u.busy = false; render();
});
window.addEventListener("hashchange", render);

watchAuth(info => {
  S.authKnown = true;
  const prevUid = S.me && S.me.user && S.me.user.uid, prevRole = S.me && S.me.role;
  if (!info.user) { unsubAll(); S.me = null; S.roster = S.bank = S.state = null; S.results = []; S.votes = []; render(); return }
  S.me = info; S.err = null;
  if (info.role === "none") { unsubAll(); render(); return }
  if (info.user.uid !== prevUid || info.role !== prevRole || !S.subs.length) subscribe();
  syncMyVote(); render();
});
render();
