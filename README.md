# MyGallery

<div align="center">

![MyGallery Logo](assets/gallery%20icon%20100x100.png)

**Static Photo Gallery Generator - Bảo mật, Tốc độ cao, Dễ dàng triển khai**

[![Node.js](https://img.shields.io/badge/Node.js-v16+-green.svg)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

</div>

---

## 🌟 Giới thiệu

**MyGallery** là một trình tạo thư viện ảnh tĩnh (Static Photo Gallery Generator) dựa trên Node.js. Dự án cho phép bạn biến thư mục ảnh trên máy tính thành một website gallery chuyên nghiệp, đẹp mắt mà không cần database phức tạp.

### Tại sao chọn MyGallery?

| Ưu điểm | Mô tả |
|---------|-------|
| 🔒 **Bảo mật Album** | Hỗ trợ khóa album bằng mật khẩu (SHA-256) |
| 🚀 **Web Tĩnh** | Toàn bộ output là file tĩnh (HTML/JSON), deploy dễ dàng lên GitHub Pages |
| 🖼️ **Xử lý ảnh** | Tự động tạo thumbnail, resize và tối ưu hóa ảnh với `sharp` |
| 📝 **Metadata** | Quản lý thông tin ảnh (tiêu đề, mô tả, tags) bằng file Markdown |
| 🌍 **Đa ngôn ngữ** | Hỗ trợ Localization (Tiếng Anh, Tiếng Việt...) |
| 📱 **Responsive** | Giao diện hiện đại, tương thích mọi thiết bị với Bootstrap 5 |

---

## ✨ Tính năng

### 📸 Quản lý & Hiển thị
- **Deep Zoom**: Xem ảnh chi tiết với khả năng zoom mượt mà
- **Auto Thumbnail**: Tự động crop và resize thumbnail vuông vức (200x200px)
- **Album Organization**: Tổ chức ảnh theo album và category
- **Split View**: Hỗ trợ cắt ảnh khổ lớn thành 2 phần để hiển thị tối ưu (cho truyện tranh/poster)

### 🛡️ Bảo mật & Riêng tư
- **Album Locking**: Đặt mật khẩu riêng cho từng album hoặc mật khẩu Master cho toàn bộ
- **Client-side Hashing**: Mã hóa mật khẩu ngay tại trình duyệt, an toàn hơn

### ⚙️ Cấu hình linh hoạt
- **Configurable**: Tùy chỉnh tiêu đề, logo, icon qua file JSON
- **Includes**: Album có thể "mượn" ảnh từ album khác mà không cần copy file
- **Smart Titles**: Tự động dùng tên file làm tiêu đề nếu không nhập metadata

### 🖱️ Trải nghiệm người dùng
- **Keyboard Navigation**: Dùng phím mũi tên để chuyển ảnh
- **Copy Metadata**: Sao chép nhanh thông tin ảnh (prompt/mô tả) với một cú click
- **Touch Support**: Hỗ trợ vuốt chạm trên thiết bị di động

---

## 📁 Cấu trúc Dự án

```
MyGallery/
├── albums/                 # Nơi chứa ảnh gốc và metadata
│   ├── Album-Name/
│   │   ├── config.json     # Cấu hình riêng của album
│   │   ├── photo.jpg       # Ảnh gốc
│   │   └── photo.md        # Metadata ảnh (Markdown + YAML)
├── assets/                 # Logo, icon, dictionary
│   ├── dict-en.json        # File ngôn ngữ Tiếng Anh
│   ├── dict-vi.json        # File ngôn ngữ Tiếng Việt
│   └── ...
├── docs/                   # OUTPUT (Website tĩnh sau khi build)
│   ├── data.json           # Dữ liệu toàn bộ gallery
│   ├── thumbnails/         # Ảnh thumbnail đã xử lý
│   └── ...
├── pages/                  # Template HTML
├── scripts/
│   └── build.js            # Script chính để build project
├── gallery.config.json     # Cấu hình toàn cục
├── app.js                  # Logic Frontend
├── style.css               # Stylesheet tùy chỉnh
└── package.json            # Dependencies & Scripts
```

---

## 🚀 Bắt đầu

### Yêu cầu
- [Node.js](https://nodejs.org/) v16+
- npm

### Cài đặt

```bash
# Clone repository
git clone https://github.com/your-username/mygallery.git
cd mygallery

# Cài đặt dependencies
npm install

# Build & Chạy thử
npm run dev
```

Mở trình duyệt tại địa chỉ được cung cấp (thường là `http://localhost:3000`)

---

## ✍️ Quản lý Nội dung

### Tạo Album mới

1. Tạo thư mục trong thư mục `albums/`, ví dụ: `albums/My-Trip/`
2. Thêm ảnh `.jpg` hoặc `.png` vào thư mục đó.
3. (Tùy chọn) Tạo file `config.json` trong thư mục album:

```json
{
    "name": "Chuyến đi Đà Lạt",
    "date": "2025-01-01",
    "category": ["Travel", "2025"],
    "coverImage": "img_01.jpg",
    "locked": false
}
```

### Thêm Metadata cho ảnh

Tạo file `.md` cùng tên với file ảnh (ví dụ: `img_01.jpg` -> `img_01.md`):

```yaml
---
title: "Hoàng hôn trên hồ"
tags: ["lake", "sunset", "chill"]
description: "Ảnh chụp lúc 5h chiều..."
---

Nội dung chi tiết hơn có thể viết ở đây (Hỗ trợ Markdown)
```

### Khóa Album

Để khóa album, thêm `unlockCode` vào `config.json` của album đó:

```json
{
    "locked": true,
    "unlockCode": "mat-khau-bi-mat"
}
```

---

## ⚙️ Cấu hình Hệ thống (`gallery.config.json`)

```json
{
    "projectName": "My Gallery",
    "browserIcon": "assets/icon.png",
    "projectLogo": "assets/logo.png",
    "dictionary": "assets/dict-vi.json",
    "masterCode": "mat-khau-quan-tri",
    "defaultCategoryCover": "assets/default.jpg"
}
```

| Trường | Mô tả |
|--------|-------|
| `projectName` | Tên hiển thị trên thanh tiêu đề |
| `dictionary` | Đường dẫn file ngôn ngữ (vi/en) |
| `masterCode` | Mật khẩu mở khóa mọi album |

---

## 🌐 Deploy

### GitHub Pages (Khuyên dùng)

Dự án này đã được cấu hình để build ra thư mục `docs`, rất thuận tiện cho GitHub Pages.

1. **Build dự án**:
   ```bash
   npm run build
   ```
2. **Push lên GitHub**.
3. Vào **Settings** > **Pages** trên GitHub repo.
4. Chọn **Source** là `Deploy from a branch`.
5. Chọn branch `main` (hoặc master) và folder `/docs`.
6. Lưu lại và tận hưởng!

---

## 🔧 Tech Stack

- **Core**: Node.js
- **Image Processing**: Sharp (High performance)
- **Frontend**: Vanilla JS, Bootstrap 5
- **Icons**: Ionicons
- **Localization**: Custom JSON dictionary

---

## 📄 License

MIT License - Tự do sử dụng và tùy biến.

---
<div align="center">

**MyGallery Project**

</div>

