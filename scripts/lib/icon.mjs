/**
 * 런처 아이콘 준비.
 *
 * 1) icon_base64 가 있으면 그대로 PNG 로 저장
 * 2) 저장소에 assets/icon.png 가 이미 있으면 그것을 사용 (GitHub 웹 UI 로 빌드할 때의 아이콘 경로)
 * 3) 둘 다 없으면 앱 이름 첫 글자로 1024x1024 PNG 를 자동 생성
 *    - Pillow(scripts/make-icon.py)가 있으면 한글/이모지까지 제대로 그린다
 *    - 없으면 순수 JS PNG 인코더로 대체(영문/숫자는 5x7 비트맵 폰트, 그 외는 추상 마크)
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

export function readPngSize(buffer) {
  if (!buffer || buffer.length < 24) return null;
  if (buffer[0] !== 0x89 || buffer.toString('latin1', 1, 4) !== 'PNG') return null;
  if (buffer.toString('latin1', 12, 16) !== 'IHDR') return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

export function firstGlyph(text) {
  const value = String(text ?? '').trim();
  if (!value) return 'A';
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    const segmenter = new Intl.Segmenter('ko', { granularity: 'grapheme' });
    for (const { segment } of segmenter.segment(value)) return segment;
  }
  return [...value][0];
}

function tryPillowIcon({ glyph, outPath, backgroundColor, scriptPath, log }) {
  if (!existsSync(scriptPath)) return null;
  for (const python of ['python3', 'python']) {
    const result = spawnSync(python, [scriptPath, '--text', glyph, '--out', outPath, '--bg', backgroundColor], {
      encoding: 'utf8',
      timeout: 60_000,
    });
    if (result.error) continue;
    if (result.status !== 0) {
      log?.debug(`  · ${python} 아이콘 생성 실패(status=${result.status}): ${(result.stdout || result.stderr || '').slice(0, 200)}`);
      continue;
    }
    if (!existsSync(outPath)) continue;
    let info = {};
    try {
      info = JSON.parse((result.stdout || '').trim().split('\n').pop());
    } catch {
      info = {};
    }
    if (info.ok === false) continue;
    return { renderer: 'pillow', font: info.font ?? null };
  }
  return null;
}

// ---------------------------------------------------------------- 순수 JS PNG

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

export function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// 5x7 비트맵 폰트 (ASCII 대문자/숫자만)
const FONT_5X7 = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  G: ['01111', '10000', '10000', '10111', '10001', '10001', '01111'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  J: ['00111', '00010', '00010', '00010', '00010', '10010', '01100'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  Q: ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  W: ['10001', '10001', '10001', '10101', '10101', '11011', '10001'],
  X: ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  Z: ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
  0: ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  1: ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  2: ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  3: ['11111', '00010', '00100', '00010', '00001', '10001', '01110'],
  4: ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  5: ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  6: ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  7: ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  8: ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  9: ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
};

function jsFallbackIcon({ glyph, outPath, backgroundColor, foregroundColor, size = 1024 }) {
  const hex = (c) => parseInt(c, 16);
  const bg = [hex(backgroundColor.slice(1, 3)), hex(backgroundColor.slice(3, 5)), hex(backgroundColor.slice(5, 7))];
  const fg = [hex(foregroundColor.slice(1, 3)), hex(foregroundColor.slice(3, 5)), hex(foregroundColor.slice(5, 7))];
  const pixels = Buffer.alloc(size * size * 4);

  const top = bg.map((c) => Math.min(255, Math.round(c * 1.12)));
  const bottom = bg.map((c) => Math.max(0, Math.round(c * 0.86)));
  for (let y = 0; y < size; y += 1) {
    const t = y / (size - 1);
    const row = [0, 1, 2].map((i) => Math.round(top[i] + (bottom[i] - top[i]) * t));
    for (let x = 0; x < size; x += 1) {
      const offset = (y * size + x) * 4;
      pixels[offset] = row[0];
      pixels[offset + 1] = row[1];
      pixels[offset + 2] = row[2];
      pixels[offset + 3] = 255;
    }
  }

  const char = String(glyph).toUpperCase();
  const bitmap = FONT_5X7[char];
  if (bitmap) {
    const scale = Math.floor((size * 0.42) / 7);
    const originX = Math.round((size - 5 * scale) / 2);
    const originY = Math.round((size - 7 * scale) / 2);
    for (let row = 0; row < 7; row += 1) {
      for (let col = 0; col < 5; col += 1) {
        if (bitmap[row][col] !== '1') continue;
        for (let dy = 0; dy < scale; dy += 1) {
          for (let dx = 0; dx < scale; dx += 1) {
            const x = originX + col * scale + dx;
            const y = originY + row * scale + dy;
            const offset = (y * size + x) * 4;
            pixels[offset] = fg[0];
            pixels[offset + 1] = fg[1];
            pixels[offset + 2] = fg[2];
          }
        }
      }
    }
  } else {
    // ASCII 가 아닌 글자(한글 등): 동그라미 + 막대 모양의 추상 마크
    const cx = size / 2;
    const cy = size / 2;
    const radius = size * 0.18;
    const thickness = size * 0.055;
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const d = Math.hypot(x - cx, y - cy);
        if (Math.abs(d - radius) <= thickness / 2) {
          const offset = (y * size + x) * 4;
          pixels[offset] = fg[0];
          pixels[offset + 1] = fg[1];
          pixels[offset + 2] = fg[2];
        }
      }
    }
  }

  writeFileSync(outPath, encodePng(size, size, pixels));
  return { renderer: 'js', font: bitmap ? '5x7-bitmap' : 'abstract-mark' };
}

/**
 * 아이콘 소스를 준비한다.
 * @returns {{path: string, source: 'base64'|'existing'|'generated', renderer?: string, width?: number, height?: number}}
 */
export function prepareIcon({ options, root, log }) {
  const assetsDir = path.join(root, 'assets');
  mkdirSync(assetsDir, { recursive: true });
  const target = path.join(assetsDir, 'icon.png');

  if (options.iconBytes) {
    writeFileSync(target, options.iconBytes);
    const dim = readPngSize(options.iconBytes);
    if (dim && dim.width !== dim.height) {
      log?.warn(`  · 아이콘이 정사각형이 아닙니다(${dim.width}x${dim.height}). 런처에서 잘려 보일 수 있습니다.`);
    }
    if (dim && dim.width < 512) {
      log?.warn(`  · 아이콘 해상도가 낮습니다(${dim.width}px). 1024px 이상을 권장합니다.`);
    }
    return { path: target, source: 'base64', width: dim?.width, height: dim?.height };
  }

  if (existsSync(target)) {
    const dim = readPngSize(readFileSync(target));
    return {
      path: target,
      source: 'existing',
      width: dim?.width ?? null,
      height: dim?.height ?? null,
    };
  }

  const glyph = firstGlyph(options.appName);
  const scriptPath = path.join(root, 'scripts', 'make-icon.py');
  const pillow = tryPillowIcon({
    glyph,
    outPath: target,
    backgroundColor: options.iconBackgroundColor,
    scriptPath,
    log,
  });
  if (pillow) {
    return { path: target, source: 'generated', renderer: pillow.renderer, font: pillow.font, glyph };
  }

  log?.warn('  · Pillow 를 찾지 못해 순수 JS 로 아이콘을 생성합니다 (한글 글자는 추상 마크로 대체).');
  const fallback = jsFallbackIcon({
    glyph,
    outPath: target,
    backgroundColor: options.iconBackgroundColor,
    foregroundColor: '#FFFFFF',
  });
  return { path: target, source: 'generated', ...fallback, glyph };
}
