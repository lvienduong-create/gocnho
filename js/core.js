// Kết nối Firebase dùng chung cho index.html (thi đấu) và admin.html (quản trị)
import { initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, sendPasswordResetEmail, createUserWithEmailAndPassword }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, doc, collection, onSnapshot, setDoc, deleteDoc, getDocs, writeBatch }
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
      cb({ user, profile: p, role, seat: p && p.seat ? Number(p.seat) : 0, name: (p && p.name) || user.email, owner });
    }, () => cb({ user, profile: null, role: owner ? "admin" : "none", seat: 0, name: user.email, owner }));
  });
}
export const login = (email, pw) => signInWithEmailAndPassword(auth, email.trim(), pw);
export const logout = () => signOut(auth);
export const resetPassword = (email) => sendPasswordResetEmail(auth, email.trim());

/* Tạo tài khoản mới mà không làm admin bị đăng xuất: dùng một app Firebase phụ */
export async function createAccount(email, password) {
  const sec = initializeApp(firebaseConfig, "tao-tai-khoan-" + Date.now());
  try {
    const secAuth = getAuth(sec);
    const cred = await createUserWithEmailAndPassword(secAuth, email.trim(), password);
    const uid = cred.user.uid;
    await signOut(secAuth);
    return uid;
  } finally { await deleteApp(sec); }
}

export function errText(e) {
  const c = (e && e.code) || "";
  const map = {
    "auth/invalid-credential": "Email hoặc mật khẩu không đúng.",
    "auth/wrong-password": "Email hoặc mật khẩu không đúng.",
    "auth/user-not-found": "Không tìm thấy tài khoản.",
    "auth/too-many-requests": "Đăng nhập sai quá nhiều lần, thử lại sau ít phút.",
    "auth/email-already-in-use": "Email này đã có tài khoản. Hãy sửa quyền ở bảng bên dưới.",
    "auth/weak-password": "Mật khẩu cần ít nhất 6 ký tự.",
    "auth/invalid-email": "Email không hợp lệ.",
    "permission-denied": "Tài khoản này không có quyền thực hiện thao tác này.",
    "unavailable": "Mất kết nối mạng, thử lại sau vài giây."
  };
  return map[c] || ("Có lỗi xảy ra (" + (c || (e && e.message) || "không rõ") + ").");
}

export const DEFAULT_SETTINGS = { title: "Start Kaiwa · Shadowing Relay", eventDate: "08/01/2027", mainRounds: 7, starBonus: 2, penTB: 2, penDe: 0, kBase: 23 };
export const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const lsGet = k => { try { return localStorage.getItem(k) } catch (e) { return null } };
export const lsSet = (k, v) => { try { localStorage.setItem(k, v) } catch (e) { } };
