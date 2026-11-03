// =====================================================================
// CẤU HÌNH FIREBASE – điền theo hướng dẫn trong README.md (bước 2)
// Firebase Console › Project settings › Your apps › Web app › SDK config
// Thông tin này được phép công khai trên GitHub; dữ liệu được bảo vệ bằng
// Firebase Authentication + Firestore Rules (file firestore.rules).
// =====================================================================
export const firebaseConfig = {
  apiKey: "DIEN_API_KEY",
  authDomain: "DIEN_PROJECT_ID.firebaseapp.com",
  projectId: "DIEN_PROJECT_ID",
  storageBucket: "DIEN_PROJECT_ID.appspot.com",
  messagingSenderId: "DIEN_SENDER_ID",
  appId: "DIEN_APP_ID"
};

// Email chủ sở hữu: luôn có quyền Quản trị, kể cả khi chưa có hồ sơ.
// Phải khớp với danh sách OWNER trong firestore.rules.
export const OWNER_EMAILS = ["l.vienduong@gmail.com"];
