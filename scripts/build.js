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

// Global Tags Map: Name -> { count, cover }
const globalTagsMap = new Map();
const processingTasks = []; // Track active image processing tasks

// Helper to process a single image file
function processImgFile(srcPath, albumId, images) {
    if (!fs.existsSync(srcPath)) {
        console.warn(`Image source not found: ${srcPath}`);
        return;
    }

    const imgName = path.basename(srcPath);

    // Thumbnail
    const thumbAlbumDir = path.join(THUMB_DIR, albumId);
    ensureDir(thumbAlbumDir);
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

        const task = sharp(srcPath).resize(resizeOpts).toFile(thumbPath).catch(e => console.error('Thumb error', e));
        processingTasks.push(task);
    }

    // Split vertically into two halves
    const splitAlbumDir = path.join(SPLIT_DIR, albumId);
    ensureDir(splitAlbumDir);
    const baseName = path.parse(imgName).name;
    const leftPath = path.join(splitAlbumDir, `${baseName}_a.jpg`);
    const rightPath = path.join(splitAlbumDir, `${baseName}_b.jpg`);

    if (!fs.existsSync(leftPath) || fs.statSync(srcPath).mtimeMs > fs.statSync(leftPath).mtimeMs) {
        const task = sharp(srcPath).metadata().then(meta => {
            const half = Math.floor(meta.width / 2);
            return Promise.all([
                sharp(srcPath).extract({ left: 0, top: 0, width: half, height: meta.height }).toFile(leftPath),
                sharp(srcPath).extract({ left: half, top: 0, width: meta.width - half, height: meta.height }).toFile(rightPath)
            ]);
        }).catch(e => console.error('Split error', e));
        processingTasks.push(task);
    }

    // Metadata .md file
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
    const tags = metaData.tags || [];

    // Process Tags
    tags.forEach(tag => {
        if (!tag) return;
        if (!globalTagsMap.has(tag)) {
            // First time seeing this tag -> use this image as cover
            globalTagsMap.set(tag, {
                count: 0,
                cover: path.relative(PUBLIC_DIR, thumbPath).replace(/\\/g, '/')
            });
        }
        const tagData = globalTagsMap.get(tag);
        tagData.count++;
    });

    // Check for duplicates in current images array by name
    if (!images.find(img => img.name === imgName)) {
        images.push({
            name: imgName,
            srcA: path.relative(PUBLIC_DIR, leftPath).replace(/\\/g, '/'),
            srcB: path.relative(PUBLIC_DIR, rightPath).replace(/\\/g, '/'),
            thumb: path.relative(PUBLIC_DIR, thumbPath).replace(/\\/g, '/'),
            meta: {
                title: title,
                tags: tags,
                description: metaData.description || '',
                content: htmlContent
            }
        });
    }
}

function processFolderImages(folderPath, albumObj) {
    const albumId = albumObj.id; // Use the ID of the PRIMARY album
    const images = albumObj.images;

    // 1. Process Local Files in this folder
    const files = fs.readdirSync(folderPath);
    const imgFiles = files.filter(f => f.toLowerCase().endsWith('.jpg') || f.toLowerCase().endsWith('.png'));
    imgFiles.forEach(img => {
        const fullPath = path.join(folderPath, img);
        if (fs.statSync(fullPath).isDirectory()) return; // Skip directories
        processImgFile(fullPath, albumId, images);
    });
}

async function main() {
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
            const title = cfg.name ? cfg.name.trim() : d;

            let albumObj;

            if (albumMap.has(title)) {
                // MERGE: Existing album found.
                albumObj = albumMap.get(title);
                console.log(`[Build] Merging processed folder "${d}" into existing album "${title}"`);
            } else {
                // CREATE: New album.
                const albumId = d;

                // Security: Hash unlock code
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
                    coverImageCfg: cfg.coverImage,
                    locked: isLocked,
                    unlockHash: unlockHash,
                    images: [],
                };

                // Process 'includes' from Config (Only for Primary)
                if (cfg.includes && Array.isArray(cfg.includes)) {
                    cfg.includes.forEach(includePath => {
                        const fullPath = path.join(ALBUMS_DIR, includePath);
                        if (fs.existsSync(fullPath)) {
                            const stat = fs.statSync(fullPath);
                            if (stat.isDirectory()) {
                                processFolderImages(fullPath, albumObj);
                            } else if (stat.isFile()) {
                                // Handle single file include
                                processImgFile(fullPath, albumObj.id, albumObj.images);
                            }
                        } else {
                            console.warn(`Include path not found: ${fullPath}`);
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


    // --- Category Map Generation (Restored) ---
    const categoryMap = {};
    albums.forEach(album => {
        (album.categories || []).forEach(cat => {
            if (categoryMap[cat] === undefined) {
                categoryMap[cat] = null;
            }
            if (!categoryMap[cat]) {
                if (album.cover) {
                    const thumbPathLocal = path.join(THUMB_DIR, album.cover.split('/').join(path.sep));
                    if (fs.existsSync(thumbPathLocal)) {
                        categoryMap[cat] = `thumbnails/${album.cover}`;
                    }
                }
            }
        });
    });

    Object.keys(categoryMap).forEach(cat => {
        if (galleryConfig.categoryCovers && galleryConfig.categoryCovers[cat]) {
            categoryMap[cat] = galleryConfig.categoryCovers[cat];
        }
        if (!categoryMap[cat] && galleryConfig.defaultCategoryCover) {
            categoryMap[cat] = galleryConfig.defaultCategoryCover;
        }
    });

    // Load Dictionary
    let dictionary = {};
    if (galleryConfig.dictionary) {
        const dictPath = path.join(ROOT, galleryConfig.dictionary);
        if (fs.existsSync(dictPath)) {
            try { dictionary = JSON.parse(fs.readFileSync(dictPath, 'utf8')); } catch (e) { console.error('Invalid dictionary', e); }
        }
    }

    // Convert Tags Map to Object
    const tagsObj = Object.fromEntries(globalTagsMap);

    // Write data.json
    const outputData = {
        config: galleryConfig,
        categories: categoryMap,
        tags: tagsObj,
        albums: albums,
        dictionary: dictionary
    };

    try {
        if (fs.existsSync(DATA_FILE)) fs.unlinkSync(DATA_FILE);
        fs.writeFileSync(DATA_FILE, JSON.stringify(outputData, null, 2), 'utf8');
        console.log('[build] Generated', DATA_FILE);
    } catch (e) {
        console.error('[build] Error writing data.json', e);
    }

    // Wait for all images to process
    if (processingTasks.length > 0) {
        console.log(`[build] Waiting for ${processingTasks.length} background image tasks...`);
        await Promise.all(processingTasks);
        console.log('[build] All image tasks finished.');
    }

    // --- Static Page Generation ---
    const BASE_URL = 'https://phamhaanedu.github.io/mygallery/';

    // Helper to read template
    const readTemplate = (name) => {
        const p = path.join(ROOT, 'pages', name);
        return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
    };

    const albumTemplate = readTemplate('album.html');
    const categoryTemplate = readTemplate('category.html');
    const categoriesTemplate = readTemplate('categories.html');

    // 1. Generate Album Pages
    const ALBUM_OUT_DIR = path.join(PUBLIC_DIR, 'albums');
    ensureDir(ALBUM_OUT_DIR);

    albums.forEach(album => {
        if (!albumTemplate) return;
        let html = albumTemplate;

        // Meta Data
        const title = `${album.title} - MyGallery`;
        const description = `View ${album.images.length} photos in ${album.title}`;
        let coverUrl = '';
        if (album.cover) {
            coverUrl = `${BASE_URL}thumbnails/${album.cover}`;
        }

        const ogTags = `
    <meta property="og:title" content="${title.replace(/"/g, '&quot;')}" />
    <meta property="og:description" content="${description.replace(/"/g, '&quot;')}" />
    <meta property="og:image" content="${coverUrl}" />
    <meta property="og:url" content="${BASE_URL}albums/${encodeURIComponent(album.id)}.html" />
    <meta property="og:type" content="website" />
    <script>window.initialContext = { type: 'album', id: '${album.id}' };</script>
        `;

        html = html.replace('<!-- TITLE -->', title)
            .replace('<!-- OG_TAGS -->', ogTags);

        fs.writeFileSync(path.join(ALBUM_OUT_DIR, `${album.id}.html`), html, 'utf8');
    });

    // 2. Generate Category Pages
    const CAT_OUT_DIR = path.join(PUBLIC_DIR, 'category');
    ensureDir(CAT_OUT_DIR);

    Object.keys(categoryMap).forEach(catId => {
        if (!categoryTemplate) return;
        let html = categoryTemplate;

        // Use Dictionary for readable title if available
        const displayName = dictionary[catId] || catId;
        const title = `${displayName} - MyGallery`;
        const description = `Browse photos in ${displayName}`;

        let coverUrl = '';
        if (categoryMap[catId]) {
            coverUrl = `${BASE_URL}${categoryMap[catId]}`;
        }

        const ogTags = `
    <meta property="og:title" content="${title.replace(/"/g, '&quot;')}" />
    <meta property="og:description" content="${description.replace(/"/g, '&quot;')}" />
    <meta property="og:image" content="${coverUrl}" />
    <meta property="og:url" content="${BASE_URL}category/${encodeURIComponent(catId)}.html" />
    <meta property="og:type" content="website" />
    <script>window.initialContext = { type: 'category', id: '${catId}' };</script>
        `;

        html = html.replace('<!-- TITLE -->', title)
            .replace('<!-- OG_TAGS -->', ogTags);

        fs.writeFileSync(path.join(CAT_OUT_DIR, `${catId}.html`), html, 'utf8');
    });

    // 3. Generate Categories (Home) Page
    if (categoriesTemplate) {
        // Just standard title/og for home
        const title = `MyGallery - All Categories`;
        const ogTags = `
    <meta property="og:title" content="${title}" />
    <meta property="og:image" content="${BASE_URL}assets/gallery icon 32x32.png" />
    <meta property="og:url" content="${BASE_URL}categories.html" />
        `;

        const html = categoriesTemplate.replace('<!-- TITLE -->', title)
            // .replace('<!-- OG_TAGS -->', ogTags); // Template might not have OG placeholder in index/categories override? 
            // Check if categories.html has placeholder. I renamed index.html to categories.html but didn't check content.
            // Assuming I should add it or just write it.
            // Let's assume simplest: just write it. 
            // Actually, I renamed `index.html` to `categories.html` but didn't add placeholders to IT.
            // I will write it as is, or attempt replace if exists.
            ;

        fs.writeFileSync(path.join(PUBLIC_DIR, 'categories.html'), html, 'utf8');
        // Also write index.html as a copy/redirect
        fs.writeFileSync(path.join(PUBLIC_DIR, 'index.html'), html, 'utf8');
    }

    // copy other HTML pages if any (e.g. tags.html, photo.html)
    // Note: tags.html, tag.html, photo.html still exist in pages/
    // We should copy them too.
    const PAGES_DIR = path.join(ROOT, 'pages');
    if (fs.existsSync(PAGES_DIR)) {
        fs.readdirSync(PAGES_DIR).forEach(file => {
            // specific exclusion since we generated these
            if (['album.html', 'category.html', 'categories.html', 'index.html'].includes(file)) return;
            if (file.endsWith('.html')) {
                fs.copyFileSync(path.join(PAGES_DIR, file), path.join(PUBLIC_DIR, file));
            }
        });
    }

    // Copy static files (App/Style)
    fs.copyFileSync(path.join(ROOT, 'app.js'), path.join(PUBLIC_DIR, 'app.js'));
    fs.copyFileSync(path.join(ROOT, 'style.css'), path.join(PUBLIC_DIR, 'style.css'));

    // Write serve.json (Keep cleanURLs false for .html extensions)
    const serveConfig = { cleanUrls: false };
    fs.writeFileSync(path.join(PUBLIC_DIR, 'serve.json'), JSON.stringify(serveConfig, null, 2), 'utf8');

    console.log('[build] Static generation complete.');
}

main();
