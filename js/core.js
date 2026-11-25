// Kết nối Firebase dùng chung cho index.html (thi đấu) và admin.html (quản trị)
import { initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, sendPasswordResetEmail, createUserWithEmailAndPassword }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, doc, collection, onSnapshot, setDoc, deleteDoc, getDoc, getDocs, writeBatch }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig, OWNER_EMAILS } from "./firebase-config.js";

export const configured = !!(firebaseConfig && firebaseConfig.apiKey && !String(firebaseConfig.apiKey).startsWith("DIEN_"));
let app = null, auth = null, fs = null;
if (configured) { app = initializeApp(firebaseConfig); auth = getAuth(app); fs = getFirestore(app); }

export const ROLES = {
  admin:   { vi: "Quản trị",      ja: "管理者" },
  control: { vi: "MC / Thư ký",   ja: "司会・書記" },
  judge:   { vi: "Giám khảo",     ja: "審査員" },
  viewer:  { vi: "Màn hình lớn",  ja: "メインスクリーン" },
  none:    { vi: "Chưa cấp quyền", ja: "権限なし" }
};

/* Lớp truy cập dữ liệu gọn: db.doc("setup/roster").onSnapshot / set / delete, db.collection("results").onSnapshot */
export const db = {
  doc(path) {
    const ref = doc(fs, path);
    return {
      onSnapshot: (cb, err) => onSnapshot(ref, s => cb({ exists: s.exists(), id: s.id, data: () => s.data() }), err),
      set: (v) => setDoc(ref, v),
      merge: (v) => setDoc(ref, v, { merge: true }),
      delete: () => deleteDoc(ref)
    };
  },
  collection(path) {
    const ref = collection(fs, path);
    return {
      onSnapshot: (cb, err) => onSnapshot(ref, q => cb({ docs: q.docs.map(d => ({ id: d.id, data: () => d.data() })) }), err),
      list: async () => (await getDocs(ref)).docs.map(d => ({ id: d.id, ...d.data() }))
    };
  },
  async deleteAll(path) {
    const snap = await getDocs(collection(fs, path));
    let batch = writeBatch(fs), n = 0;
    for (const d of snap.docs) { batch.delete(d.ref); n++; if (n % 400 === 0) { await batch.commit(); batch = writeBatch(fs); } }
    await batch.commit(); return n;
  }
};

const isOwnerEmail = (e) => !!e && OWNER_EMAILS.map(x => x.toLowerCase()).includes(String(e).toLowerCase());

/* Theo dõi đăng nhập + hồ sơ quyền (users/{uid}). cb nhận {user, profile, role, seat, name} hoặc {user:null} */
export function watchAuth(cb) {
  if (!configured) { cb({ user: null, unconfigured: true }); return; }
  let unsubProfile = null;
  onAuthStateChanged(auth, (user) => {
    if (unsubProfile) { unsubProfile(); unsubProfile = null; }
    if (!user) { cb({ user: null }); return; }
    const owner = isOwnerEmail(user.email);
    unsubProfile = onSnapshot(doc(fs, "users/" + user.uid), (s) => {
      const p = s.exists() ? s.data() : null;
      const role = owner ? "admin" : (p && ROLES[p.role] ? p.role : "none");
      cb({ user, profile: p, role, seat: p && p.seat ? Number(p.seat) : 0, name: (p && p.name) || (p && p.loginId) || user.email, owner });
    }, () => cb({ user, profile: null, role: owner ? "admin" : "none", seat: 0, name: user.email, owner }));
  });
}
/* ---------- Đăng nhập bằng ID (VD: Thuky) ----------
   Firebase chỉ hỗ trợ email, nên mỗi ID được gắn với một email nội bộ <id>@startkaiwa.local (không cần hộp thư thật).
   Bảng logins/{id} ghi email nội bộ đang dùng của từng ID (đổi khi Quản trị cấp mật khẩu mới).
   Chủ sở hữu vẫn đăng nhập bằng email thật. */
export const ID_DOMAIN = "startkaiwa.local";
export const normId = (s) => String(s || "").trim().toLowerCase();
export const validId = (id) => /^[a-z0-9][a-z0-9._-]{1,29}$/.test(id);
const idEmail = (id, n) => (n > 1 ? id + "." + n : id) + "@" + ID_DOMAIN;
export async function login(idOrEmail, pw) {
  const raw = String(idOrEmail || "").trim();
  if (raw.includes("@")) return signInWithEmailAndPassword(auth, raw, pw);
  const id = normId(raw);
  if (!validId(id)) throw { code: "auth/invalid-id" };
  let email = idEmail(id, 1);
  try { const s = await getDoc(doc(fs, "logins/" + id)); if (s.exists() && s.data().email) email = s.data().email } catch (e) { }
  return signInWithEmailAndPassword(auth, email, pw);
}
export const logout = () => signOut(auth);
export const resetPassword = (email) => sendPasswordResetEmail(auth, email.trim());

/* Tạo tài khoản đăng nhập theo ID mà không làm admin bị đăng xuất (dùng một app Firebase phụ).
   Nếu email nội bộ của ID đã bị dùng (tài khoản cũ đã xóa / đã cấp lại mật khẩu) thì dùng <id>.2, <id>.3… */
export async function createAccount(id, password) {
  const sec = initializeApp(firebaseConfig, "tao-tai-khoan-" + Date.now());
  try {
    const secAuth = getAuth(sec);
    for (let n = 1; n <= 30; n++) {
      const email = idEmail(id, n);
      try {
        const cred = await createUserWithEmailAndPassword(secAuth, email, password);
        await signOut(secAuth);
        return { uid: cred.user.uid, email };
      } catch (e) { if (!e || e.code !== "auth/email-already-in-use") throw e; }
    }
    throw { code: "auth/too-many-versions" };
  } finally { await deleteApp(sec); }
}
export const getDocOnce = async (path) => { const s = await getDoc(doc(fs, path)); return s.exists() ? s.data() : null };

export function errText(e) {
  const c = (e && e.code) || "";
  const map = {
    "auth/invalid-credential": "ID hoặc mật khẩu không đúng.",
    "auth/wrong-password": "ID hoặc mật khẩu không đúng.",
    "auth/invalid-id": "ID chỉ gồm chữ không dấu, số, dấu chấm, gạch ngang hoặc gạch dưới (2–30 ký tự).",
    "auth/too-many-versions": "ID này đã được cấp lại quá nhiều lần. Hãy dùng ID khác.",
    "auth/user-not-found": "Không tìm thấy tài khoản.",
    "auth/too-many-requests": "Đăng nhập sai quá nhiều lần, thử lại sau ít phút.",
    "auth/email-already-in-use": "ID này đã có tài khoản. Hãy sửa quyền ở bảng bên dưới.",
    "auth/weak-password": "Mật khẩu cần ít nhất 6 ký tự.",
    "auth/invalid-email": "ID không hợp lệ.",
    "permission-denied": "Tài khoản này không có quyền thực hiện thao tác này.",
    "unavailable": "Mất kết nối mạng, thử lại sau vài giây."
  };
  return map[c] || ("Có lỗi xảy ra (" + (c || (e && e.message) || "không rõ") + ").");
}

export const DEFAULT_SETTINGS = { title: "Start Kaiwa · Shadowing Relay", eventDate: "08/01/2027", mainRounds: 7, starBonus: 2, penTB: 2, penDe: 0, kBase: 23 };
export const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const lsGet = k => { try { return localStorage.getItem(k) } catch (e) { return null } };
export const lsSet = (k, v) => { try { localStorage.setItem(k, v) } catch (e) { } };

/* Ô mật khẩu có nút con mắt để hiện/ẩn */
export const pwField = (id, label, extra = "") => `<div class="field"><label for="${id}">${label}</label><div class="pw-wrap"><input id="${id}" type="password" ${extra}><button type="button" class="eye" data-act="pw-eye" data-for="${id}" aria-label="Hiện mật khẩu" aria-pressed="false" title="Hiện / ẩn mật khẩu">👁</button></div></div>`;
export function toggleEye(btn) {
  const el = document.getElementById(btn.dataset.for); if (!el) return;
  const show = el.type === "password"; el.type = show ? "text" : "password";
  btn.setAttribute("aria-pressed", String(show)); btn.setAttribute("aria-label", show ? "Ẩn mật khẩu" : "Hiện mật khẩu");
  btn.classList.toggle("on", show); el.focus();
}
