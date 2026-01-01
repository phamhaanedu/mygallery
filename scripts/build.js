const fs = require('fs');
const path = require('path');
const MarkdownIt = require('markdown-it');
const md = new MarkdownIt();
const sharp = require('sharp');
const matter = require('gray-matter');

const ROOT = path.resolve(__dirname, '..'); // MyGallery root
const ALBUMS_DIR = path.join(ROOT, 'albums');
const PUBLIC_DIR = path.join(ROOT, 'public');
const THUMB_DIR = path.join(PUBLIC_DIR, 'thumbnails');
const SPLIT_DIR = path.join(PUBLIC_DIR, 'split');
const DATA_FILE = path.join(PUBLIC_DIR, 'data.json');

function ensureDir(p) {
    if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

ensureDir(PUBLIC_DIR);
ensureDir(THUMB_DIR);
ensureDir(SPLIT_DIR);

function processAlbum(albumPath) {
    const albumId = path.basename(albumPath);
    const configPath = path.join(albumPath, 'config.json');
    let cfg = {};
    if (fs.existsSync(configPath)) {
        try { cfg = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch (e) { console.error('Invalid JSON in', configPath); }
    }
    const images = [];
    const files = fs.readdirSync(albumPath);
    const imgFiles = files.filter(f => f.toLowerCase().endsWith('.jpg') || f.toLowerCase().endsWith('.png'));
    imgFiles.forEach(img => {
        const srcPath = path.join(albumPath, img);
        // Thumbnail
        const thumbAlbumDir = path.join(THUMB_DIR, albumId);
        ensureDir(thumbAlbumDir);
        const thumbPath = path.join(thumbAlbumDir, img);
        if (!fs.existsSync(thumbPath) || fs.statSync(srcPath).mtimeMs > fs.statSync(thumbPath).mtimeMs) {
            sharp(srcPath).resize(400, 400, { fit: 'inside' }).toFile(thumbPath).catch(e => console.error('Thumb error', e));
        }
        // Split vertically into two halves
        const splitAlbumDir = path.join(SPLIT_DIR, albumId);
        ensureDir(splitAlbumDir);
        const baseName = path.parse(img).name;
        const leftPath = path.join(splitAlbumDir, `${baseName}_a.jpg`);
        const rightPath = path.join(splitAlbumDir, `${baseName}_b.jpg`);
        if (!fs.existsSync(leftPath) || fs.statSync(srcPath).mtimeMs > fs.statSync(leftPath).mtimeMs) {
            sharp(srcPath).metadata().then(meta => {
                const half = Math.floor(meta.width / 2);
                return Promise.all([
                    sharp(srcPath).extract({ left: 0, top: 0, width: half, height: meta.height }).toFile(leftPath),
                    sharp(srcPath).extract({ left: half, top: 0, width: meta.width - half, height: meta.height }).toFile(rightPath)
                ]);
            }).catch(e => console.error('Split error', e));
        }

        // Metadata .md file
        const mdPath = srcPath.replace(/\.(jpg|png)$/i, '.md');
        let metaData = {};
        let htmlContent = '';

        if (fs.existsSync(mdPath)) {
            const fileContent = fs.readFileSync(mdPath, 'utf8');
            const parsed = matter(fileContent);
            metaData = parsed.data || {}; // YAML frontmatter
            htmlContent = md.render(parsed.content || ''); // Rendered markdown body
        }

        images.push({
            name: img,
            srcA: path.relative(PUBLIC_DIR, leftPath).replace(/\\/g, '/'),
            srcB: path.relative(PUBLIC_DIR, rightPath).replace(/\\/g, '/'),
            thumb: path.relative(PUBLIC_DIR, thumbPath).replace(/\\/g, '/'),
            meta: {
                title: metaData.title || '',
                tags: metaData.tags || [],
                description: metaData.description || '',
                content: htmlContent
            }
        });
    });
    // Validate cover image existence
    let coverPath = null;
    if (cfg.coverImage) {
        const coverThumbPath = path.join(THUMB_DIR, albumId, cfg.coverImage);
        // We check if the thumbnail file was created/exists, or if the source file exists (thumbnails are generated in loop)
        // Since the loop runs before this return, thumbnails should be ready if possible.
        // However, checking THUMB_DIR directly is safer for the final output.
        if (fs.existsSync(coverThumbPath)) {
            coverPath = `${albumId}/${cfg.coverImage}`;
        }
    }

    return {
        id: albumId,
        title: cfg.title || albumId,
        categories: cfg.category || [],
        cover: coverPath,
        locked: cfg.locked || false,
        images,
    };
}

function main() {
    const albums = [];
    if (fs.existsSync(ALBUMS_DIR)) {
        const dirs = fs.readdirSync(ALBUMS_DIR);
        dirs.forEach(d => {
            const full = path.join(ALBUMS_DIR, d);
            if (fs.statSync(full).isDirectory()) {
                albums.push(processAlbum(full));
            }
        });
    }
    // Write data.json moved below to include config

    // Copy static files
    fs.copyFileSync(path.join(ROOT, 'app.js'), path.join(PUBLIC_DIR, 'app.js'));
    fs.copyFileSync(path.join(ROOT, 'style.css'), path.join(PUBLIC_DIR, 'style.css'));

    // Write serve.json to disable "Clean URLs" (which strips query params on redirect)
    const serveConfig = { cleanUrls: false };
    fs.writeFileSync(path.join(PUBLIC_DIR, 'serve.json'), JSON.stringify(serveConfig, null, 2), 'utf8');
    console.log('[build] Generated serve.json');

    // Load Gallery Config
    const configPath = path.join(ROOT, 'gallery.config.json');
    let galleryConfig = {};
    if (fs.existsSync(configPath)) {
        try { galleryConfig = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch (e) { console.error('Invalid config', e); }
    }

    // Process Categories & Covers
    const categoryMap = {};
    // 1. Initialize from albums
    albums.forEach(album => {
        (album.categories || []).forEach(cat => {
            // Ensure key exists
            if (categoryMap[cat] === undefined) {
                categoryMap[cat] = null;
            }

            if (!categoryMap[cat]) {
                // Default to first album's cover
                // CHECK: only if the thumbnail file actually exists.
                if (album.cover) {
                    const thumbPathLocal = path.join(THUMB_DIR, album.cover.split('/').join(path.sep));
                    if (fs.existsSync(thumbPathLocal)) {
                        categoryMap[cat] = `thumbnails/${album.cover}`;
                    }
                }
            }
        });
    });

    // 2. Override with config or default
    Object.keys(categoryMap).forEach(cat => {
        // If config has specific cover
        if (galleryConfig.categoryCovers && galleryConfig.categoryCovers[cat]) {
            categoryMap[cat] = galleryConfig.categoryCovers[cat];
        }
        // If still null, use default
        if (!categoryMap[cat] && galleryConfig.defaultCategoryCover) {
            categoryMap[cat] = galleryConfig.defaultCategoryCover;
        }
    });

    // Copy Assets
    const ASSETS_DIR = path.join(ROOT, 'assets');
    const PUBLIC_ASSETS_DIR = path.join(PUBLIC_DIR, 'assets');
    if (fs.existsSync(ASSETS_DIR)) {
        ensureDir(PUBLIC_ASSETS_DIR);
        fs.readdirSync(ASSETS_DIR).forEach(file => {
            fs.copyFileSync(path.join(ASSETS_DIR, file), path.join(PUBLIC_ASSETS_DIR, file));
        });
    }

    // Write data.json
    const outputData = {
        config: galleryConfig,
        categories: categoryMap,
        albums: albums
    };

    // ... (rest of writing logic moved up/modified)
    console.log('[debug] Albums data:', JSON.stringify(outputData, null, 2).substring(0, 200) + '...');
    try {
        if (fs.existsSync(DATA_FILE)) fs.unlinkSync(DATA_FILE);
        fs.writeFileSync(DATA_FILE, JSON.stringify(outputData, null, 2), 'utf8');
        console.log('[build] Generated', DATA_FILE);
    } catch (e) {
        console.error('[build] Error writing data.json', e);
    }

    // Copy HTML pages
    const PAGES_DIR = path.join(ROOT, 'pages');
    if (fs.existsSync(PAGES_DIR)) {
        fs.readdirSync(PAGES_DIR).forEach(file => {
            if (file.endsWith('.html')) {
                fs.copyFileSync(path.join(PAGES_DIR, file), path.join(PUBLIC_DIR, file));
            }
        });
    }
    console.log('[build] Copied static files to public/');
}

main();
