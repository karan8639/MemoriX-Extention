import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Minimal valid PNG files - creating simple green square icons
// Using base64-encoded minimal PNG data

const pngData = {
  16: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAMklEQVR4nGP8z8DwHwYYGBgYGBgYGP7//8/AwMDAYGBgYGBgYGRgYGBkYGRgYGBkYGBkYGBgYGBgYGD8z8DAwMDAwPD//38GBkYGBkYGRgYGBkYGBkZGBkYGxgcAcg0KNfPvOEQAAAAASUVORK5CYII=', 'base64'),
  32: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAALklEQVR4nGNkYGD4z8DAwMDAwMDAwPD//38GBkYGBkYGRgYGBkYGBkZGBkYGxgcAcg0KNfPvOEQAAAAASUVORK5CYII=', 'base64'),
  48: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAAIUlEQVR4nGNkYGD4z8DAwMDAwAjDMDAwMjIyMjIyPjY2NgYABJEKM1gHSBYAAAAASUVORK5CYII=', 'base64'),
  128: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAYAAADTAomsAAAAKklEQVR4nGNkYGD4z8DAwMDAwMDAwPD//38GBkYGBkYGRgYGBkYGBkYGxgcA8g0JN+TkOEgAAAAASUVORK5CYII=', 'base64')
};

const iconDir = path.join(__dirname, 'public/icons');
fs.mkdirSync(iconDir, { recursive: true });

Object.entries(pngData).forEach(([size, data]) => {
  fs.writeFileSync(path.join(iconDir, `icon${size}.png`), data);
  console.log(`✅ Created icon${size}.png`);
});

console.log('✅ All icon files created successfully');
