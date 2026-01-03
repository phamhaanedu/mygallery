const fs = require('fs');
const path = require('path');
const MarkdownIt = require('markdown-it');
const md = new MarkdownIt();
const sharp = require('sharp');
const matter = require('gray-matter');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..'); // MyGallery root
const ALBUMS_DIR = path.join(ROOT, 'albums');
const PUBLIC_DIR = path.join(ROOT, 'docs');
const THUMB_DIR = path.join(PUBLIC_DIR, 'thumbnails');
const SPLIT_DIR = path.join(PUBLIC_DIR, 'split');
const DATA_FILE = path.join(PUBLIC_DIR, 'data.json');

function ensureDir(p) {
    if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function hash(str) {
    return crypto.createHash('sha256').update(String(str)).digest('hex');
}

// Load Gallery Config Global
const configPath = path.join(ROOT, 'gallery.config.json');
let galleryConfig = {};
if (fs.existsSync(configPath)) {
    try { galleryConfig = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch (e) { console.error('Invalid config', e); }
}

ensureDir(PUBLIC_DIR);
ensureDir(THUMB_DIR);
ensureDir(SPLIT_DIR);

function processFolderImages(folderPath, albumObj) {
    const albumId = albumObj.id; // Use the ID of the PRIMARY album (the one created first)
    const images = albumObj.images;

    // Helper to process a single image file
    const processImgFile = (srcPath) => {
        if (!fs.existsSync(srcPath)) {
            console.warn(`Image source not found: ${srcPath}`);
            return;
        }

        const imgName = path.basename(srcPath);

        // Thumbnail
        const thumbAlbumDir = path.join(THUMB_DIR, albumId);
        ensureDir(thumbAlbumDir);
        // Collision handling: if filename exists but path is different, we might overwrite.
        // For simple merging, we assume unique filenames or acceptable overwrite.
        const thumbPath = path.join(thumbAlbumDir, imgName);

        // Re-check timestamp for resize
        if (!fs.existsSync(thumbPath) || fs.statSync(srcPath).mtimeMs > fs.statSync(thumbPath).mtimeMs) {
            const layout = galleryConfig.layout || 'grid';
            let resizeOpts = { width: 200, height: 200, fit: 'cover' }; // Default Grid

            if (layout === 'masonry') {
                resizeOpts = { width: 300 }; // Fixed width, auto height
            } else if (layout === 'justified') {
                resizeOpts = { height: 220 }; // Fixed height, auto width
            }

            sharp(srcPath).resize(resizeOpts).toFile(thumbPath).catch(e => console.error('Thumb error', e));
        }

        // Split vertically into two halves
        const splitAlbumDir = path.join(SPLIT_DIR, albumId);
        ensureDir(splitAlbumDir);
        const baseName = path.parse(imgName).name;
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

        // Metadata .md file (Look for .md next to the SOURCE image)
        const mdPath = srcPath.replace(/\.(jpg|png)$/i, '.md');
        let metaData = {};
        let htmlContent = '';

        if (fs.existsSync(mdPath)) {
            if (fs.statSync(mdPath).isDirectory()) {
                console.warn(`Ignored directory acting as metadata: ${mdPath}`);
            } else {
                try {
                    const fileContent = fs.readFileSync(mdPath, 'utf8');
                    const parsed = matter(fileContent);
                    metaData = parsed.data || {}; // YAML frontmatter
                    htmlContent = md.render(parsed.content || ''); // Rendered markdown body
                } catch (e) {
                    console.error(`Error reading MD file ${mdPath}`, e);
                }
            }
        }

        const title = metaData.title || baseName;

        // Check for duplicates in current images array by name
        if (!images.find(img => img.name === imgName)) {
            images.push({
                name: imgName,
                srcA: path.relative(PUBLIC_DIR, leftPath).replace(/\\/g, '/'),
                srcB: path.relative(PUBLIC_DIR, rightPath).replace(/\\/g, '/'),
                thumb: path.relative(PUBLIC_DIR, thumbPath).replace(/\\/g, '/'),
                meta: {
                    title: title,
                    tags: metaData.tags || [],
                    description: metaData.description || '',
                    content: htmlContent
                }
            });
        }
    };

    // 1. Process Local Files in this folder
    const files = fs.readdirSync(folderPath);
    const imgFiles = files.filter(f => f.toLowerCase().endsWith('.jpg') || f.toLowerCase().endsWith('.png'));
    imgFiles.forEach(img => {
        const fullPath = path.join(folderPath, img);
        if (fs.statSync(fullPath).isDirectory()) return; // Skip directories
        processImgFile(fullPath);
    });
}

function main() {
    const albumMap = new Map(); // Title -> Album Object

    if (fs.existsSync(ALBUMS_DIR)) {
        const dirs = fs.readdirSync(ALBUMS_DIR);
        dirs.forEach(d => {
            const folderPath = path.join(ALBUMS_DIR, d);
            if (!fs.statSync(folderPath).isDirectory()) return;

            // Read Config unique to this folder
            const configPath = path.join(folderPath, 'config.json');
            let cfg = {};
            if (fs.existsSync(configPath)) {
                try { cfg = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch (e) { console.error('Invalid JSON in', configPath); }
            }

            // Determine Title (Key for merging)
            // If no name in config, use directory name.
            const title = cfg.name ? cfg.name.trim() : d;

            let albumObj;

            if (albumMap.has(title)) {
                // MERGE: Existing album found.
                // We use the EXISTING album object.
                // We IGNORE the current 'cfg' for metadata (cover, lock, etc).
                albumObj = albumMap.get(title);
                console.log(`[Build] Merging processed folder "${d}" into existing album "${title}"`);
            } else {
                // CREATE: New album.
                const albumId = d; // Use directory name as ID for the first one.

                // Security: Hash unlock code if present
                let unlockHash = null;
                let isLocked = cfg.locked || false;

                if (cfg.unlockCode) {
                    unlockHash = hash(cfg.unlockCode);
                    isLocked = true;
                }

                albumObj = {
                    id: albumId,
                    title: title,
                    categories: cfg.category || [],
                    cover: null, // Will resolve later
                    coverImageCfg: cfg.coverImage, // Store content for later resolution
                    locked: isLocked,
                    unlockHash: unlockHash,
                    images: [],
                };

                // Process 'includes' from Config (Only for Primary)
                if (cfg.includes && Array.isArray(cfg.includes)) {
                    cfg.includes.forEach(includePath => {
                        const fullPath = path.join(ALBUMS_DIR, includePath);
                        if (fs.existsSync(fullPath)) {
                            if (fs.statSync(fullPath).isDirectory()) {
                                processFolderImages(fullPath, albumObj);
                            }
                        }
                    });
                }

                albumMap.set(title, albumObj);
            }

            // Process Images from THIS folder
            processFolderImages(folderPath, albumObj);
        });
    }

    // Post-processing: Resolve Covers for all albums
    const albums = Array.from(albumMap.values());
    albums.forEach(album => {
        if (album.coverImageCfg) {
            const coverThumbPath = path.join(THUMB_DIR, album.id, album.coverImageCfg);
            if (fs.existsSync(coverThumbPath)) {
                album.cover = `${album.id}/${album.coverImageCfg}`;
            }
        }
        delete album.coverImageCfg; // Cleanup
    });


    // Copy static files
    fs.copyFileSync(path.join(ROOT, 'app.js'), path.join(PUBLIC_DIR, 'app.js'));
    fs.copyFileSync(path.join(ROOT, 'style.css'), path.join(PUBLIC_DIR, 'style.css'));

    // Write serve.json to disable "Clean URLs" (which strips query params on redirect)
    const serveConfig = { cleanUrls: false };
    fs.writeFileSync(path.join(PUBLIC_DIR, 'serve.json'), JSON.stringify(serveConfig, null, 2), 'utf8');
    console.log('[build] Generated serve.json');

    // Hash Master Code
    if (galleryConfig.masterCode) {
        galleryConfig.masterHash = hash(galleryConfig.masterCode);
        delete galleryConfig.masterCode; // Remove plain text
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

    // Load Dictionary
    let dictionary = {};
    if (galleryConfig.dictionary) {
        const dictPath = path.join(ROOT, galleryConfig.dictionary);
        if (fs.existsSync(dictPath)) {
            try { dictionary = JSON.parse(fs.readFileSync(dictPath, 'utf8')); } catch (e) { console.error('Invalid dictionary', e); }
        }
    }

    // Write data.json
    const outputData = {
        config: galleryConfig,
        categories: categoryMap,
        albums: albums,
        dictionary: dictionary
    };

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
    console.log('[build] Copied static files to docs/');
}

main();
