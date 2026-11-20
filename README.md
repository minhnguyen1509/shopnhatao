# Shop Nhà Táo – shopnhatao.com

Website bán hàng cho khách + trang quản trị nội bộ (kho máy theo IMEI/Serial, đơn hàng, bán tại quầy, sửa chữa, nhân viên, chấm công, bảng lương, báo cáo).

## Cấu trúc
| Thư mục / file | Vai trò |
|---|---|
| `public/index.html` | Toàn bộ giao diện web khách (`/`) và trang quản trị (`/quan-tri`) |
| `public/firebase-config.js` | Cấu hình Firebase web app (công khai) |
| `functions/` | Cloud Functions: đặt cọc, giữ phụ kiện, đặt lịch sửa, tra bảo hành, quản lý tài khoản nhân viên |
| `functions/config.js` | Email chủ shop |
| `firestore.rules`, `storage.rules` | Phân quyền dữ liệu và ảnh |
| `.github/workflows/deploy.yml` | Tự đưa web lên Firebase mỗi khi có thay đổi trên nhánh `main` |

## Phân quyền
- **Khách (không đăng nhập):** xem máy, phụ kiện, bảng giá; đặt cọc / đặt lịch / tra bảo hành qua Cloud Functions.
- **Nhân viên:** đơn hàng, bán tại quầy, kho (không thấy giá nhập), sửa chữa, tự chấm công.
- **Chủ shop:** toàn quyền, gồm giá nhập (`costs`), bảng lương (`payroll`), nhân viên, cài đặt.

## Đăng nhập
- Chủ shop: email trong `functions/config.js` (tạo trong Firebase Console → Authentication).
- Nhân viên: tên đăng nhập + mật khẩu do chủ shop tạo trong tab **Nhân viên**.

## Deploy
Push lên nhánh `main` → GitHub Actions tự deploy. Cần secret `FIREBASE_SERVICE_ACCOUNT` (nội dung file JSON khóa dịch vụ).

## Thư viện bên thứ ba

- Xóa phông ảnh sản phẩm: [@imgly/background-removal](https://github.com/imgly/background-removal-js) (AGPL-3.0), tải từ CDN khi dùng. Mã nguồn web này công khai tại repo này.
- Đọc ảnh HEIC: heic-to, heic2any.
