// =====================================================================
// CẤU HÌNH FIREBASE – điền theo hướng dẫn trong README.md (bước 2)
// Firebase Console › Project settings › Your apps › Web app › SDK config
// Thông tin này được phép công khai trên GitHub; dữ liệu được bảo vệ bằng
// Firebase Authentication + Firestore Rules (file firestore.rules).
// =====================================================================
export const firebaseConfig = {
apiKey: "AIzaSyDbuop4-AcG0QhmSFr4SDNPG-sClHBgIdo",
  authDomain: "kaiwa-2683e.firebaseapp.com",
  databaseURL: "https://kaiwa-2683e-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "kaiwa-2683e",
  storageBucket: "kaiwa-2683e.firebasestorage.app",
  messagingSenderId: "666887438042",
  appId: "1:666887438042:web:9385edbc5904fc49e1afe3",
  measurementId: "G-Y67HH0FBG2"
};

// Email chủ sở hữu: luôn có quyền Quản trị, kể cả khi chưa có hồ sơ.
// Phải khớp với danh sách OWNER trong firestore.rules.
export const OWNER_EMAILS = ["l.vienduong@gmail.com"];
