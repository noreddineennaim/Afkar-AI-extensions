// Afkar AI Pilot Background Service Worker - مختبر أفكار AI (@AfkarAILab)

let capturedVideos = [];
let downloadedKeys = new Set();
let config = {
  autoDownload: false,
  subfolder: 'Afkar_AI_Videos',
  notifications: true,
  totalDownloaded: 0
};

const QAAB_SALT_HEX = '4dd4c2e6b83162090e52b3c7a6733ba4'
  + '1cb2462b829ab58a196b39db57177524'
  + 'f49baf7f08e8d68d26a72e37c1a95a2f'
  + '1f05a51892aef2949732b62a38aadd58';

const processedApis = new Set();
const processedUrls = new Set();

// Initialize config from storage
chrome.storage.local.get(['afkarAiPilotConfig', 'dolaPilotConfig', 'earnifyxConfig'], (res) => {
  const saved = res.afkarAiPilotConfig || res.dolaPilotConfig || res.earnifyxConfig;
  if (saved) config = { ...config, ...saved };
  updateBadge();
});

function updateBadge() {
  const count = config.totalDownloaded || 0;
  chrome.action.setBadgeText({ text: count > 0 ? String(count) : '' });
  chrome.action.setBadgeBackgroundColor({ color: '#00f0ff' });
}

function sanitizeFilename(text) {
  return String(text || 'video')
    .replace(/[/\\?%*:|"<>#]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 60);
}

function generateFilename(media) {
  const now = new Date();
  const d = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const t = `${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}-${String(now.getSeconds()).padStart(2, '0')}`;
  const slug = sanitizeFilename(media.prompt || '1080P_Master_Video');
  const folder = config.subfolder ? `${config.subfolder}/` : 'Afkar_AI_Videos/';
  return `${folder}AfkarAI_${d}_${t}_${slug}.mp4`;
}

function slugTitle(text) {
  if (!text) return '1080P Master Video';
  return text.length > 40 ? text.slice(0, 37) + '...' : text;
}

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function concatBytes(first, second) {
  const bytes = new Uint8Array(first.length + second.length);
  bytes.set(first, 0);
  bytes.set(second, first.length);
  return bytes;
}

function padBase64(text) {
  const pad = (4 - (text.length % 4)) % 4;
  return text + '='.repeat(pad);
}

function base64DecodeLoose(text) {
  const input = String(text || '').trim();
  const variants = [
    input,
    input.replace(/[$@#]/g, char => ({ '$': '_', '@': '/', '#': '.' }[char])),
    input.replace(/[$@#]/g, char => ({ '$': '+', '@': '/', '#': '=' }[char])),
  ];
  for (const candidate of variants) {
    try {
      const normalized = padBase64(candidate).replace(/-/g, '+').replace(/_/g, '/');
      const binary = atob(normalized);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      return bytes;
    } catch {}
  }
  return null;
}

function asciiUrlFromBytes(bytes) {
  if (!bytes || !bytes.length) return '';
  for (const byte of bytes) {
    if (byte !== 9 && byte !== 10 && byte !== 13 && (byte < 32 || byte > 126)) return '';
  }
  return new TextDecoder().decode(bytes);
}

function stripPkcs7(bytes) {
  if (!bytes || !bytes.length) return new Uint8Array();
  const pad = bytes[bytes.length - 1];
  if (pad < 1 || pad > 16 || pad > bytes.length) return bytes;
  for (let i = bytes.length - pad; i < bytes.length; i++) {
    if (bytes[i] !== pad) return bytes;
  }
  return bytes.slice(0, bytes.length - pad);
}

async function decryptAesCbcUrl(payload, keyBytes, ivBytes) {
  if (!payload.length || payload.length % 16 !== 0) return '';
  try {
    const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-CBC', false, ['decrypt']);
    const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-CBC', iv: ivBytes }, key, payload));
    const direct = asciiUrlFromBytes(plain);
    if (/^https?:\/\//i.test(direct)) return direct;
    const stripped = stripPkcs7(plain);
    const url = asciiUrlFromBytes(stripped);
    return /^https?:\/\//i.test(url) ? url : '';
  } catch {
    return '';
  }
}

async function decodeQaabToken(token, keySeed) {
  const data = base64DecodeLoose(token);
  const seed = base64DecodeLoose(keySeed);
  if (!data || !seed) return '';

  const digest1 = await crypto.subtle.digest('SHA-512', seed.slice(0, 32));
  const salt = hexToBytes(QAAB_SALT_HEX);
  const digest2Input = concatBytes(new Uint8Array(digest1), salt);
  const digest2 = new Uint8Array(await crypto.subtle.digest('SHA-512', digest2Input));
  const key = digest2.slice(0, 16);
  const iv = digest2.slice(16, 32);
  const attempts = [];

  if (data.length >= 4 && data[0] === 0xa8 && data[1] === 0x00 && data[2] === 0x01 && data[3] === 0x00) {
    attempts.push({ payload: data.slice(4), key, iv });
    attempts.push({ payload: data.slice(4), key: iv, iv: key });
    if (data.length > 36) {
      attempts.push({ payload: data.slice(36), key, iv: data.slice(20, 36) });
      attempts.push({ payload: data.slice(36), key, iv });
    }
  } else {
    attempts.push({ payload: data, key, iv });
  }

  for (const attempt of attempts) {
    const url = await decryptAesCbcUrl(attempt.payload, attempt.key, attempt.iv);
    if (url) return url;
  }
  return '';
}

async function decodeMainUrl(token, keySeed = '') {
  if (!token) return '';
  if (/^https?:\/\//i.test(token.trim())) return token.trim();
  const bytes = base64DecodeLoose(token);
  if (bytes) {
    const text = asciiUrlFromBytes(bytes);
    if (/^https?:\/\//i.test(text)) return text;
  }
  if (token.startsWith('qAAB') && keySeed) {
    return await decodeQaabToken(token, keySeed);
  }
  return '';
}

function findKeySeedDeep(value, depth = 0) {
  if (depth > 10 || value == null) return '';
  if (typeof value === 'string') {
    let match = value.match(/(?:^|[?&])key_seed=([^&"'<>\\\s]+)/i);
    if (match) return decodeURIComponent(match[1]);
    match = value.match(/["']key_seed["']\s*:\s*["']([^"']+)/i);
    return match ? decodeURIComponent(match[1]) : '';
  }
  if (typeof value !== 'object') return '';
  if (typeof value.key_seed === 'string' && value.key_seed.trim()) return value.key_seed.trim();
  for (const item of Object.values(value)) {
    const hit = findKeySeedDeep(item, depth + 1);
    if (hit) return hit;
  }
  return '';
}

function pickBestToken(data) {
  const list = data?.video_list ? Object.values(data.video_list) : [data];
  let best = '';
  let maxScore = 0;
  for (const item of list) {
    const tok = item?.main_url || item?.play_url;
    const score = Number(item?.bitrate || 0) + Number(item?.width || 0) * Number(item?.height || 0);
    if (tok && score >= maxScore) {
      maxScore = score;
      best = tok;
    }
  }
  return best;
}

function extractTOSKey(url) {
  if (!url) return '';
  try {
    const u = new URL(url);
    const path = u.pathname;
    const tosMatch = path.match(/tos-[a-zA-Z0-9_-]+\/([a-zA-Z0-9_-]+)/i);
    if (tosMatch && tosMatch[1]) {
      return tosMatch[1].split('~')[0].split('.')[0];
    }
    const parts = path.split('/').filter(Boolean);
    const last = parts[parts.length - 1] || '';
    return last.split('~')[0].split('.')[0];
  } catch {
    const clean = String(url).split('?')[0];
    const match = clean.match(/tos-[a-zA-Z0-9_-]+\/([a-zA-Z0-9_-]+)/i);
    return match ? match[1].split('~')[0].split('.')[0] : '';
  }
}

async function resolveFallbackApi(fallbackUrl, keySeed = '', meta = {}) {
  if (!fallbackUrl || processedApis.has(fallbackUrl)) return null;
  processedApis.add(fallbackUrl);

  try {
    const u = new URL(fallbackUrl);
    u.searchParams.set('channel', 'no');
    u.searchParams.set('codec_type', '8');
    u.searchParams.set('logo_type', 'unwatermarked');

    const resp = await fetch(u.toString());
    if (!resp.ok) return null;

    const payload = await resp.json();
    const videoData = payload?.video_info?.data || payload?.data?.video_info || payload?.data || payload;
    const bestToken = pickBestToken(videoData);
    if (!bestToken) return null;

    const foundSeed = findKeySeedDeep(payload) || u.searchParams.get('key_seed') || keySeed || '';
    const rawUrl = await decodeMainUrl(bestToken, foundSeed);

    if (rawUrl && /^https?:\/\//i.test(rawUrl) && !processedUrls.has(rawUrl)) {
      processedUrls.add(rawUrl);
      console.log('💎 [Afkar AI Pilot BG] Found 1080P Unwatermarked Master Video:', rawUrl);

      const media = {
        vid: videoData?.vid || videoData?.video_id || meta.vid || fallbackUrl,
        url: rawUrl,
        poster: videoData?.poster_url || videoData?.poster || meta.poster || '',
        prompt: meta.prompt || videoData?.prompt || 'Dola 1080P Unwatermarked Video',
        messageId: meta.messageId || '',
        width: videoData?.width || 1080,
        height: videoData?.height || 1920,
        duration: videoData?.duration || 0,
        fallbackUrl,
        timestamp: Date.now()
      };

      const mediaKey = extractTOSKey(media.poster) || extractTOSKey(media.url) || media.vid;
      const existingIndex = capturedVideos.findIndex(v => {
        const vk = extractTOSKey(v.poster) || extractTOSKey(v.url) || v.vid;
        return (mediaKey && vk && mediaKey === vk) || (media.vid && v.vid === media.vid) || v.url === media.url;
      });

      if (existingIndex >= 0) {
        capturedVideos[existingIndex] = { ...capturedVideos[existingIndex], ...media };
      } else {
        capturedVideos.push(media);
        if (capturedVideos.length > 100) capturedVideos.shift();
      }

      // Broadcast to tabs
      chrome.tabs.query({}, (tabs) => {
        tabs.forEach(tab => {
          if (tab.id) {
            chrome.tabs.sendMessage(tab.id, { type: 'NEW_MEDIA_RESOLVED', media }).catch(() => {});
          }
        });
      });

      if (config.autoDownload) {
        triggerDownload(media, true);
      }

      return media;
    }
  } catch (e) {
    console.warn('[Afkar AI Pilot BG] Error resolving fallback API:', e);
  }
  return null;
}

async function triggerDownload(media, isAuto = false) {
  if (!media || !media.url) return { ok: false, error: 'Invalid URL' };

  const key = media.vid || media.url;
  if (isAuto && downloadedKeys.has(key)) return { ok: true, skipped: true };
  downloadedKeys.add(key);

  const filename = generateFilename(media);

  try {
    const downloadId = await chrome.downloads.download({
      url: media.url,
      filename,
      saveAs: false,
      conflictAction: 'uniquify'
    });

    config.totalDownloaded = (config.totalDownloaded || 0) + 1;
    chrome.storage.local.set({ afkarAiPilotConfig: config, dolaPilotConfig: config });
    updateBadge();

    if (config.notifications) {
      try {
        chrome.notifications.create({
          type: 'basic',
          iconUrl: 'icon128.png',
          title: '🎬 مختبر أفكار AI | تم تحميل الفيديو 1080P!',
          message: `تم الحفظ: ${slugTitle(media.prompt)}`,
          priority: 1
        });
      } catch (e) {}
    }

    return { ok: true, downloadId, filename };
  } catch (err) {
    console.error('Download error:', err);
    return { ok: false, error: err.message };
  }
}

// Handle runtime messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'FETCH_AND_RESOLVE_FALLBACK') {
    resolveFallbackApi(message.fallbackUrl, message.keySeed, message.meta).then(res => {
      sendResponse({ ok: !!res, media: res });
    });
    return true;
  }

  if (message.type === 'NEW_MEDIA_DETECTED') {
    const media = message.media;
    if (media && media.url) {
      const existingIndex = capturedVideos.findIndex(v => 
        (media.vid && v.vid === media.vid) || v.url === media.url
      );
      if (existingIndex >= 0) {
        capturedVideos[existingIndex] = { ...capturedVideos[existingIndex], ...media };
      } else {
        capturedVideos.push(media);
        if (capturedVideos.length > 100) capturedVideos.shift();
        if (config.autoDownload) {
          triggerDownload(media, true);
        }
      }
    }
    sendResponse({ ok: true });
  }

  if (message.type === 'TRIGGER_DOWNLOAD') {
    triggerDownload(message.media, false).then(sendResponse);
    return true;
  }

  if (message.type === 'GET_CAPTURED_VIDEOS') {
    // Return videos in chronological 1st -> Nth order (Scene 1 on top, Scene 2 second, etc.)
    const sorted = [...capturedVideos].sort((a, b) => {
      const aMatch = String(a.prompt || '').match(/Scene[_\s]*(\d+)/i);
      const bMatch = String(b.prompt || '').match(/Scene[_\s]*(\d+)/i);
      if (aMatch && bMatch) {
        return parseInt(aMatch[1], 10) - parseInt(bMatch[1], 10);
      }
      return (a.timestamp || 0) - (b.timestamp || 0);
    });
    sendResponse({ videos: sorted, config });
  }

  if (message.type === 'UPDATE_CONFIG') {
    config = { ...config, ...message.config };
    chrome.storage.local.set({ afkarAiPilotConfig: config, dolaPilotConfig: config });
    updateBadge();
    sendResponse({ ok: true, config });
  }
});

// If user clicks the extension icon in browser toolbar, toggle the on-page docked bar
chrome.action.onClicked.addListener((tab) => {
  if (tab.id) {
    chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_DOCKED_BAR' }).catch(() => {});
  }
});


