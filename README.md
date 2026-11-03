# Start Kaiwa · Shadowing Relay – trang chấm điểm vòng 1

Website tĩnh (HTML/CSS/JS), đăng lên **GitHub Pages**. Dữ liệu lưu realtime trên **Firebase** (gói miễn phí Spark). Có đăng nhập và phân quyền theo vị trí.

| Trang | Ai dùng | Làm gì |
|---|---|---|
| `index.html` | Mọi tài khoản | Đăng nhập, sau đó chỉ thấy đúng các trang được cấp quyền |
| `index.html#dieu-khien` | MC / Thư ký, Quản trị | Chọn người chơi, ngôi sao, ô câu; chốt kết quả; ghi vắng mặt |
| `index.html#giam-khao` | Giám khảo | **Chỉ chấm** Đạt / Không đạt ở ghế được gán |
| `index.html#man-hinh` | Màn hình lớn, MC / Thư ký, Quản trị | Màn hình máy chiếu: câu, ngôi sao, kết quả lượt, xếp hạng |
| `admin.html` | Quản trị | Nhập thành viên, ngân hàng câu, tạo tài khoản và phân quyền, cài đặt điểm, xuất CSV, xóa dữ liệu thi thử |

## Cấu trúc thư mục

```
index.html            trang thi đấu
admin.html            trang quản trị
css/style.css
js/firebase-config.js cấu hình Firebase (cần điền)
js/core.js            kết nối Firebase, đăng nhập, phân quyền
js/app.js             logic thi đấu
js/admin.js           logic quản trị
firestore.rules       quy tắc bảo mật dữ liệu (dán vào Firebase)
tests/                kiểm thử quy tắc bảo mật (tùy chọn, cho team kỹ thuật)
```

## Cài đặt lần đầu (khoảng 20 phút)

### 1. Tạo Firebase project
1. Vào https://console.firebase.google.com → **Add project** (tắt Google Analytics cũng được).
2. **Build › Authentication › Get started › Sign-in method** → bật **Email/Password**.
3. **Authentication › Users › Add user** → tạo tài khoản chủ sở hữu (email trong `OWNER_EMAILS`) và mật khẩu.
4. **Build › Firestore Database › Create database** → chọn vùng `asia-southeast1` (Singapore) → **production mode**.
5. **Firestore › Rules** → xóa nội dung cũ, dán toàn bộ file `firestore.rules` → **Publish**.
   Nếu chủ sở hữu không phải `votu.quynh@sbifpt.com`, sửa email trong hàm `isOwner()`.

### 2. Lấy cấu hình web
1. **Project settings (bánh răng) › General › Your apps › Web (`</>`)** → đặt tên app → **Register**.
2. Copy đoạn `firebaseConfig` → dán vào `js/firebase-config.js` (thay các giá trị `DIEN_...`).
3. Sửa `OWNER_EMAILS` cho khớp email chủ sở hữu ở bước 1.3.

> Cấu hình này **được phép công khai** trên GitHub. Dữ liệu được bảo vệ bởi đăng nhập và `firestore.rules`.

### 3. Đưa lên GitHub Pages
1. Tạo repository mới trên GitHub (Public) → **Add file › Upload files** → kéo toàn bộ thư mục này lên → **Commit**.
2. **Settings › Pages › Build and deployment** → Source: **Deploy from a branch**, Branch: `main` / `/ (root)` → **Save**.
3. Sau 1–2 phút trang chạy ở `https://<tên-github>.github.io/<tên-repo>/`.
4. Quay lại Firebase: **Authentication › Settings › Authorized domains › Add domain** → thêm `<tên-github>.github.io`.

### 4. Nhập dữ liệu (trang `admin.html`)
1. Đăng nhập bằng tài khoản chủ sở hữu.
2. **Thành viên**: mở file WBS, sheet **DS Team** → bôi đen từ dòng tiêu đề đến hết danh sách → Copy → dán vào ô "Nhập nhanh từ Excel" → **Đọc dữ liệu** → **Đưa vào bản nháp** → kiểm tra → **Lưu danh sách**. Có thể sửa tên, trình độ, thêm/xóa người trực tiếp.
3. **Ngân hàng câu**: mở `Ngan_hang_cau_V1.xlsx`, sheet **Ngan hang cau** → Ctrl+A, Copy → dán → **Đọc dữ liệu** → **Lưu**.
4. **Tài khoản & quyền**: tạo tài khoản cho 4 giám khảo (gán ghế 1–4), MC / thư ký, máy chiếu (quyền Màn hình lớn). Gửi email + mật khẩu ban đầu cho từng người qua kênh riêng.
5. **Cài đặt**: tiêu đề, ngày thi, số lượt chính, thưởng/phạt ngôi sao, hệ số điểm nền.

## Ngày thi
- Máy thư ký: đăng nhập tài khoản MC / Thư ký → **Điều khiển**.
- Máy chiếu: đăng nhập tài khoản Màn hình lớn → **Màn hình lớn** (F11 để toàn màn hình).
- 4 giám khảo: đăng nhập trên điện thoại/laptop → **Chấm điểm**. Ghế đã được gán sẵn, không cần chọn.
- Khi đủ phiếu của tất cả giám khảo, trang Điều khiển tự chốt lượt.
- Sau buổi thi: **admin.html › Dữ liệu thi › Tải kết quả từng lượt (CSV)**.
- Trước ngày thi, sau buổi chạy thử: **Dữ liệu thi › Xóa kết quả thi thử**.

## Phân quyền

| Quyền | Đọc dữ liệu thi | Điều khiển lượt | Chấm phiếu | Nhập dữ liệu, quản lý tài khoản |
|---|---|---|---|---|
| Quản trị | ✓ | ✓ | – | ✓ |
| MC / Thư ký | ✓ | ✓ | – | – |
| Giám khảo | ✓ (chỉ phiếu của mình) | – | ✓ chỉ ghế được gán, chỉ lượt đang mở | – |
| Màn hình lớn | ✓ | – | – | – |
| Chưa cấp quyền / người lạ | – | – | – | – |

Quy tắc trên được kiểm soát ở máy chủ (`firestore.rules`), không chỉ ở giao diện.

## Lưu ý bảo mật
- **Không** đưa file Excel ngân hàng câu, danh sách thành viên lên GitHub. Nội dung chỉ nằm trong Firestore, chỉ tài khoản đã cấp quyền mới đọc được.
- Thu hồi quyền: trong `admin.html` chọn "Chưa cấp quyền". Xóa hẳn tài khoản: Firebase Console › Authentication.
- Người dùng tự đổi mật khẩu bằng nút **Quên mật khẩu** ở trang đăng nhập (email gửi từ Firebase, có thể rơi vào thư rác).

## Chạy thử trên máy
```
python -m http.server 8000
```
Mở http://localhost:8000 (localhost đã có sẵn trong Authorized domains của Firebase).

## Kiểm thử quy tắc bảo mật (tùy chọn)
Cần Node.js 18+ và Java 11+:
```
cd tests
npm install
npx firebase emulators:exec --only firestore --project demo-sk "node rules.test.mjs"
```
