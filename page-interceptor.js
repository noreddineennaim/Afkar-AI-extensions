// Afkar AI Pilot Master Stream Interceptor - مختبر أفكار AI
(function () {
  'use strict';

  if (window.__AFKAR_AI_INTERCEPTOR_LOADED__ || window.__DOLAPILOT_INTERCEPTOR_LOADED__) return;
  window.__AFKAR_AI_INTERCEPTOR_LOADED__ = true;
  window.__DOLAPILOT_INTERCEPTOR_LOADED__ = true;

  console.log('⚡ [Afkar AI Pilot] Active: Intercepting 1080P Unwatermarked Streams (مختبر أفكار AI)');

  const QAAB_SALT_HEX = '4dd4c2e6b83162090e52b3c7a6733ba4'
    + '1cb2462b829ab58a196b39db57177524'
    + 'f49baf7f08e8d68d26a72e37c1a95a2f'
    + '1f05a51892aef2949732b62a38aadd58';

  const processedApis = new Set();
  const processedUrls = new Set();

  function isTargetApiUrl(url) {
    if (!url || typeof url !== 'string') return false;
    // Skip static assets immediately
    if (/\.(js|css|woff2?|ttf|png|jpe?g|gif|svg|ico|webp|map)(\?.*)?$/i.test(url)) return false;
    // Match only specific API / chat endpoints
    return (
      url.includes('/chat/') ||
      url.includes('/completion') ||
      url.includes('/im/chain') ||
      url.includes('/api/') ||
      url.includes('/v1/') ||
      url.includes('/video/') ||
      url.includes('/stream') ||
      url.includes('/message')
    );
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

  function extractSurroundingMetadata(text, matchIndex) {
    const start = Math.max(0, matchIndex - 2000);
    const end = Math.min(text.length, matchIndex + 2000);
    const slice = text.slice(start, end);

    let prompt = '';
    let poster = '';
    let vid = '';
    let messageId = '';

    const promptMatches = [
      ...slice.matchAll(/(?:"prompt"|"query"|"content"|"instruction"|"topic_title")\s*:\s*"([^"]+)"/g),
      ...slice.matchAll(/\\"(?:prompt|query|content|instruction|topic_title)\\"\s*:\s*\\"(.*?)\\"/g)
    ];
    for (const pm of promptMatches) {
      if (pm[1] && !pm[1].includes('fallback_api') && pm[1].length > 3) {
        try {
          prompt = JSON.parse(`"${pm[1]}"`);
        } catch {
          prompt = pm[1].replace(/\\n/g, ' ').replace(/\\"/g, '"');
        }
        if (prompt.length > 3) break;
      }
    }

    const posterMatches = [
      ...slice.matchAll(/(?:"poster_url"|"poster"|"cover_url"|"image_url")\s*:\s*"([^"]+)"/g),
      ...slice.matchAll(/\\"(?:poster_url|poster|cover_url|image_url)\\"\s*:\s*\\"(.*?)\\"/g)
    ];
    for (const pm of posterMatches) {
      if (pm[1] && /^https?:\/\//i.test(pm[1].replace(/\\u0026/g, '&').replace(/\\\//g, '/'))) {
        poster = pm[1].replace(/\\u0026/g, '&').replace(/\\\//g, '/');
        break;
      }
    }

    const vidMatches = [
      ...slice.matchAll(/(?:"vid"|"video_id"|"item_id")\s*:\s*"([^"]+)"/g),
      ...slice.matchAll(/\\"(?:vid|video_id|item_id)\\"\s*:\s*\\"(.*?)\\"/g)
    ];
    for (const vm of vidMatches) {
      if (vm[1] && vm[1].length > 5) {
        vid = vm[1];
        break;
      }
    }

    const msgMatches = [
      ...slice.matchAll(/(?:"message_id"|"mid"|"chat_id")\s*:\s*"([^"]+)"/g),
      ...slice.matchAll(/\\"(?:message_id|mid|chat_id)\\"\s*:\s*\\"(.*?)\\"/g)
    ];
    for (const mm of msgMatches) {
      if (mm[1] && mm[1].length > 3) {
        messageId = mm[1];
        break;
      }
    }

    let keySeed = '';
    const seedMatches = [
      ...slice.matchAll(/(?:"key_seed")\s*:\s*"([^"]+)"/g),
      ...slice.matchAll(/\\"(?:key_seed)\\"\s*:\s*\\"(.*?)\\"/g)
    ];
    for (const sm of seedMatches) {
      if (sm[1]) {
        keySeed = sm[1];
        break;
      }
    }

    return { prompt, poster, vid, messageId, keySeed };
  }

  async function processFallbackApi(fallbackUrl, meta = {}) {
    if (!fallbackUrl || processedApis.has(fallbackUrl)) return;
    processedApis.add(fallbackUrl);

    // Send to background worker to fetch without CORS
    window.postMessage({
      type: 'AFKAR_AI_RESOLVE_FALLBACK',
      fallbackUrl: fallbackUrl,
      keySeed: meta.keySeed || '',
      meta: meta
    }, '*');
  }

  function scanTextForFallbackApis(text) {
    if (!text || !text.includes('fallback_api')) return;
    const regexes = [
      /"fallback_api"\s*:\s*"([^"]+)"/g,
      /fallback_api\\":\\"(.*?)\\"/g
    ];

    for (const re of regexes) {
      let match;
      while ((match = re.exec(text)) !== null) {
        if (match[1]) {
          const clean = match[1].replace(/\\u0026/g, '&').replace(/\\\//g, '/');
          const meta = extractSurroundingMetadata(text, match.index);
          processFallbackApi(clean, meta);
        }
      }
    }
  }

  // Hook fetch cleanly without blocking page assets
  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const response = await originalFetch.apply(this, args);
    try {
      const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '');
      if (isTargetApiUrl(url)) {
        const clone = response.clone();
        if (clone.body && typeof clone.body.getReader === 'function') {
          const reader = clone.body.getReader();
          const decoder = new TextDecoder();
          (async () => {
            let buffer = '';
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              buffer += decoder.decode(value, { stream: true });
              if (buffer.includes('fallback_api')) {
                scanTextForFallbackApis(buffer);
              }
            }
          })().catch(() => {});
        } else {
          clone.text().then(text => {
            if (text && text.includes('fallback_api')) {
              scanTextForFallbackApis(text);
            }
          }).catch(() => {});
        }
      }
    } catch (e) {}
    return response;
  };

  // Hook XHR cleanly
  const originalXHROpen = XMLHttpRequest.prototype.open;
  const originalXHRSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (...args) {
    this._url = args[1];
    return originalXHROpen.apply(this, args);
  };
  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener('load', function () {
      if (this._url && isTargetApiUrl(this._url) && this.responseText && this.responseText.includes('fallback_api')) {
        scanTextForFallbackApis(this.responseText);
      }
    });
    return originalXHRSend.apply(this, args);
  };
})();
