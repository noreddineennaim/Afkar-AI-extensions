// Afkar AI Pilot Content Script & In-Page Docked Bar - مختبر أفكار AI

(function () {
  'use strict';

  // 1. Inject page-interceptor.js into Main World
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('page-interceptor.js');
  script.onload = () => script.remove();
  (document.head || document.documentElement).appendChild(script);

  const capturedMediaMap = new Map();
  let currentConfig = {
    autoDownload: false,
    notifications: true,
    subfolder: 'Afkar_AI_Videos',
    totalDownloaded: 0
  };
  let isDrawerOpen = false;
  let isMinimized = false;

  // Initialize UI & State
  initDockedBar();

  // Initial fetch of captured videos and config from background
  chrome.runtime.sendMessage({ type: 'GET_CAPTURED_VIDEOS' }, (res) => {
    if (res) {
      if (res.config) currentConfig = { ...currentConfig, ...res.config };
      if (res.videos) res.videos.forEach(v => registerMedia(v, false));
      updateDockUI();
    }
  });

  function registerMedia(media, shouldAttach = true) {
    if (media && media.url) {
      const key = media.vid || media.url;
      capturedMediaMap.set(key, media);
      if (shouldAttach) {
        attachDownloadButtons();
      }
      updateDockUI();
    }
  }

  // Listen for window messages from page-interceptor
  window.addEventListener('message', (event) => {
    if (!event.data) return;

    if (event.data.type === 'AFKAR_AI_NEW_UNWATERMARKED_MEDIA' || event.data.type === 'EARNIFYX_NEW_UNWATERMARKED_MEDIA') {
      const media = event.data.media;
      if (media && media.url) {
        registerMedia(media);
        chrome.runtime.sendMessage({ type: 'NEW_MEDIA_DETECTED', media });
      }
    }

    if (event.data.type === 'AFKAR_AI_RESOLVE_FALLBACK' || event.data.type === 'EARNIFYX_RESOLVE_FALLBACK') {
      chrome.runtime.sendMessage({
        type: 'FETCH_AND_RESOLVE_FALLBACK',
        fallbackUrl: event.data.fallbackUrl,
        keySeed: event.data.keySeed,
        meta: event.data.meta
      }, (res) => {
        if (res && res.ok && res.media) {
          registerMedia(res.media);
        }
      });
    }
  });

  // Listen for messages from background service worker
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'NEW_MEDIA_RESOLVED') {
      registerMedia(message.media);
    }

    if (message.type === 'GET_PAGE_ORDERED_VIDEOS') {
      sendResponse({ videos: getPageOrderedVideos() });
      return true;
    }

    if (message.type === 'TOGGLE_DOCKED_BAR') {
      const dock = document.getElementById('afkar-dock-container') || document.getElementById('earnifyx-dock-container');
      if (dock) {
        if (dock.classList.contains('minimized')) {
          dock.classList.remove('minimized');
        } else {
          dock.classList.add('minimized');
        }
      }
    }
  });

  // Extract core unique TOS key hash from image/video URL
  function extractTOSKey(url) {
    if (!url) return '';
    try {
      const u = new URL(url, window.location.href);
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

  // Extract prompt or scene title from DOM context
  function extractDomPrompt(card, cardIndex = 0) {
    try {
      const tableRows = document.querySelectorAll('table tbody tr');
      if (tableRows.length > cardIndex) {
        const row = tableRows[cardIndex];
        const titleEl = row.querySelector('td:nth-child(2)');
        if (titleEl) {
          const titleText = (titleEl.innerText || titleEl.textContent || '').trim();
          if (titleText) return `Scene_${cardIndex + 1}_${titleText}`;
        }
      }

      const container = card.closest('[data-container-type], [data-message-id], [class*="message"]') || card.parentElement;
      if (container) {
        const headings = container.querySelectorAll('h1, h2, h3, h4, strong');
        for (const h of headings) {
          const txt = (h.innerText || h.textContent || '').trim();
          if (txt.length >= 4 && txt.length <= 80 && !txt.includes('1080P') && !txt.includes('Afkar AI') && !txt.includes('Dola Pilot')) {
            return txt;
          }
        }
      }
    } catch (e) {}
    return `Scene ${cardIndex + 1}`;
  }

  // Get top-level video card containers without nested duplicates
  function getVideoCards() {
    if (!document.body) return [];
    const rawCards = document.querySelectorAll('[class*="block-video"], [class*="block_video"], .image-box-grid-item-FTeESI, [class*="image-box-grid-item"]');
    const cards = [];

    rawCards.forEach((el) => {
      const block = el.querySelector('[class*="block-video"]') || el;
      if (!cards.includes(block)) {
        cards.push(block);
      }
    });

    const standalonePlayers = document.querySelectorAll('.video-player-wrapper, [class*="video-player-wrapper"]');
    standalonePlayers.forEach((el) => {
      if (!el.closest('[class*="block-video"], [class*="block_video"], [class*="image-box-grid-item"]')) {
        if (!cards.includes(el)) {
          cards.push(el);
        }
      }
    });

    return cards;
  }

  // Find matching media for a card
  function findMatchingMediaForCard(card, allCards) {
    const allMedia = Array.from(capturedMediaMap.values());
    if (allMedia.length === 0) return null;

    const cardIndex = allCards.indexOf(card);
    const imgEls = card.querySelectorAll('img');
    const videoEl = card.querySelector('video');

    const domImgSrcs = Array.from(imgEls).map(img => img.src || img.getAttribute('src') || '').filter(Boolean);
    const domVideoSrc = videoEl ? (videoEl.currentSrc || videoEl.src || videoEl.getAttribute('src') || '') : '';

    const cardKeys = [];
    domImgSrcs.forEach(src => {
      const k = extractTOSKey(src);
      if (k && k.length > 8) cardKeys.push(k);
    });
    if (domVideoSrc) {
      const vk = extractTOSKey(domVideoSrc);
      if (vk && vk.length > 8) cardKeys.push(vk);
    }

    // Tier 1: Match by Image / Poster TOS Key
    for (const key of cardKeys) {
      for (const media of allMedia) {
        const mediaPosterKey = extractTOSKey(media.poster);
        const mediaVidKey = extractTOSKey(media.vid);
        const mediaUrlKey = extractTOSKey(media.url);
        if ((mediaPosterKey && mediaPosterKey === key) ||
            (mediaVidKey && mediaVidKey === key) ||
            (mediaUrlKey && mediaUrlKey === key)) {
          return media;
        }
      }
    }

    // Tier 2: Substring key in full URLs
    for (const key of cardKeys) {
      for (const media of allMedia) {
        if ((media.poster && media.poster.includes(key)) ||
            (media.url && media.url.includes(key)) ||
            (media.vid && String(media.vid).includes(key))) {
          return media;
        }
      }
    }

    // Tier 3: Positional Order Alignment
    if (cardIndex >= 0 && cardIndex < allMedia.length) {
      return allMedia[cardIndex];
    }

    return allMedia[cardIndex % allMedia.length] || allMedia[0];
  }

  function getPageOrderedVideos() {
    const cards = getVideoCards();
    const allMedia = Array.from(capturedMediaMap.values());

    if (cards.length > 0) {
      const list = [];
      cards.forEach((card, idx) => {
        const matched = findMatchingMediaForCard(card, cards);
        const domPrompt = extractDomPrompt(card, idx);
        const imgEl = card.querySelector('img');
        const videoEl = card.querySelector('video');
        const poster = (imgEl && (imgEl.src || imgEl.getAttribute('src'))) || (matched && matched.poster) || '';
        const url = (matched && matched.url) || (videoEl && (videoEl.currentSrc || videoEl.src)) || '';

        list.push({
          ...(matched || {}),
          url: url || (matched && matched.url) || '',
          poster: poster,
          prompt: (matched && matched.prompt && !matched.prompt.includes('1080P')) ? matched.prompt : domPrompt,
          sceneIndex: idx + 1,
          width: (matched && matched.width) || 1080,
          height: (matched && matched.height) || 1920
        });
      });
      return list;
    }

    return allMedia.sort((a, b) => {
      const aMatch = String(a.prompt || '').match(/Scene[_\s]*(\d+)/i);
      const bMatch = String(b.prompt || '').match(/Scene[_\s]*(\d+)/i);
      if (aMatch && bMatch) {
        return parseInt(aMatch[1], 10) - parseInt(bMatch[1], 10);
      }
      return (a.timestamp || 0) - (b.timestamp || 0);
    });
  }

  // Attach visual download button to each video card in chat
  function attachDownloadButtons() {
    if (!document.body) return;
    const cards = getVideoCards();

    cards.forEach((card, index) => {
      const existingBtns = card.querySelectorAll('.afkar-download-btn, .earnifyx-download-btn');
      if (existingBtns.length > 1) {
        for (let i = 1; i < existingBtns.length; i++) {
          existingBtns[i].remove();
        }
      }

      if (card.querySelector(':scope > .afkar-download-btn') || (card.querySelector('.afkar-download-btn, .earnifyx-download-btn') && existingBtns.length === 1)) {
        return;
      }

      const btn = document.createElement('button');
      btn.className = 'afkar-download-btn';
      btn.innerHTML = `
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
          <polyline points="7 10 12 15 17 10"></polyline>
          <line x1="12" y1="15" x2="12" y2="3"></line>
        </svg>
        <span>تحميل 1080P</span>
      `;

      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();

        btn.classList.add('loading');
        btn.querySelector('span').textContent = 'جاري التحميل...';

        const allCurrentCards = getVideoCards();
        const currentCardIndex = allCurrentCards.indexOf(card);
        const targetMedia = findMatchingMediaForCard(card, allCurrentCards);
        const domPrompt = extractDomPrompt(card, currentCardIndex >= 0 ? currentCardIndex : index);

        if (targetMedia && targetMedia.url) {
          const finalMedia = {
            ...targetMedia,
            prompt: (targetMedia.prompt && !targetMedia.prompt.includes('1080P'))
              ? targetMedia.prompt
              : domPrompt
          };

          chrome.runtime.sendMessage({ type: 'TRIGGER_DOWNLOAD', media: finalMedia }, (res) => {
            btn.classList.remove('loading');
            if (res && res.ok) {
              btn.classList.add('success');
              btn.querySelector('span').textContent = 'تم الحفظ!';
              setTimeout(() => {
                btn.classList.remove('success');
                btn.querySelector('span').textContent = 'تحميل 1080P';
              }, 2500);
            } else {
              btn.querySelector('span').textContent = 'فشل التحميل';
              setTimeout(() => {
                btn.querySelector('span').textContent = 'تحميل 1080P';
              }, 2000);
            }
          });
        } else {
          const videoEl = card.querySelector('video');
          const fallbackSrc = videoEl ? (videoEl.currentSrc || videoEl.src) : '';

          if (fallbackSrc) {
            chrome.runtime.sendMessage({
              type: 'TRIGGER_DOWNLOAD',
              media: { url: fallbackSrc, prompt: domPrompt }
            }, (res) => {
              btn.classList.remove('loading');
              if (res && res.ok) {
                btn.classList.add('success');
                btn.querySelector('span').textContent = 'تم الحفظ!';
                setTimeout(() => {
                  btn.classList.remove('success');
                  btn.querySelector('span').textContent = 'تحميل 1080P';
                }, 2500);
              }
            });
          }
        }
      });

      card.style.position = 'relative';
      card.appendChild(btn);
    });
  }

  // =========================================================================
  // In-Page Docked Bar Implementation
  // =========================================================================
  function initDockedBar() {
    if (document.getElementById('afkar-dock-container') || document.getElementById('earnifyx-dock-container')) return;

    if (!document.body) {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initDockedBar, { once: true });
      } else {
        const bodyObserver = new MutationObserver(() => {
          if (document.body) {
            bodyObserver.disconnect();
            initDockedBar();
          }
        });
        bodyObserver.observe(document.documentElement || document, { childList: true, subtree: true });
      }
      return;
    }

    const iconUrl = chrome.runtime.getURL('icon48.png');

    const dock = document.createElement('div');
    dock.id = 'afkar-dock-container';
    dock.innerHTML = `
      <!-- Minimized Pill -->
      <div class="afkar-min-pill" id="afkarMinPill">
        <img src="${iconUrl}" class="afkar-min-logo" alt="Logo">
        <span>أفكار AI</span>
        <span class="afkar-min-badge" id="afkarMinCount">0</span>
        <span>▾</span>
      </div>

      <!-- Expandable Scenes Drawer -->
      <div class="afkar-scenes-drawer" id="afkarScenesDrawer">
        <div class="afkar-drawer-header">
          <div class="afkar-drawer-title-group">
            <img src="${iconUrl}" class="afkar-drawer-logo" alt="Logo">
            <span>🎬 مشاهد الفيديو المكتشفة (<span id="afkarDrawerCount">0</span>)</span>
          </div>
          <a href="https://www.youtube.com/@AfkarAILab" target="_blank" class="afkar-drawer-yt-link" title="زيارة قناة مختبر أفكار AI على يوتيوب">
            <span>مختبر أفكار AI ↗</span>
          </a>
        </div>
        <div class="afkar-drawer-list" id="afkarDrawerList">
          <div class="afkar-empty-box">توليد أي فيديو في Dola AI سيظهر هنا بجودة 1080P مباشرة وبدون علامة مائية!</div>
        </div>
      </div>

      <!-- Main Docked Bar -->
      <div class="afkar-dock-main" id="afkarDockMain">
        <div class="afkar-drag-handle" id="afkarDragHandle" title="سحب لنقل الشريط">⋮⋮</div>
        
        <div class="afkar-dock-left">
          <a href="https://www.youtube.com/@AfkarAILab" target="_blank" class="afkar-channel-btn" title="زيارة قناة مختبر أفكار AI على يوتيوب (@AfkarAILab)">
            <img src="${iconUrl}" class="afkar-dock-logo" alt="مختبر أفكار AI">
            <span class="afkar-dock-brand">مختبر أفكار AI</span>
            <span class="afkar-yt-badge">YT ↗</span>
          </a>
          <span class="afkar-status-dot" title="نشط ويلتقط فيديوهات 1080P Raw"></span>
        </div>

        <div class="afkar-dock-center">
          <div class="afkar-count-badge">
            <span>🎬</span>
            <span id="afkarDockCount">0</span>
            <span>فيديو</span>
          </div>

          <label class="afkar-toggle-wrap" title="تحميل الفيديوهات تلقائياً بمجرد اكتمال توليدها">
            <div class="afkar-switch">
              <input type="checkbox" id="afkarAutoToggle">
              <span class="afkar-slider"></span>
            </div>
            <span>حفظ تلقائي</span>
          </label>
        </div>

        <div class="afkar-dock-right">
          <button class="afkar-btn-all" id="afkarBtnDownloadAll" disabled>⬇️ تحميل الكل</button>
          <button class="afkar-btn-drawer" id="afkarBtnToggleDrawer">
            <span>المشاهد</span>
            <span id="afkarDrawerArrow">▾</span>
          </button>
          <button class="afkar-btn-min" id="afkarBtnMin" title="تصغير الشريط">─</button>
        </div>
      </div>
    `;

    document.body.appendChild(dock);

    // Event listeners
    const minPill = dock.querySelector('#afkarMinPill');
    const btnMin = dock.querySelector('#afkarBtnMin');
    const btnToggleDrawer = dock.querySelector('#afkarBtnToggleDrawer');
    const autoToggle = dock.querySelector('#afkarAutoToggle');
    const btnDownloadAll = dock.querySelector('#afkarBtnDownloadAll');
    const dragHandle = dock.querySelector('#afkarDragHandle');

    minPill.addEventListener('click', () => {
      isMinimized = false;
      dock.classList.remove('minimized');
    });

    btnMin.addEventListener('click', () => {
      isMinimized = true;
      isDrawerOpen = false;
      dock.classList.add('minimized');
      dock.querySelector('#afkarScenesDrawer').classList.remove('open');
    });

    btnToggleDrawer.addEventListener('click', () => {
      isDrawerOpen = !isDrawerOpen;
      const drawer = dock.querySelector('#afkarScenesDrawer');
      const arrow = dock.querySelector('#afkarDrawerArrow');
      if (isDrawerOpen) {
        drawer.classList.add('open');
        arrow.textContent = '▴';
        renderDrawerList();
      } else {
        drawer.classList.remove('open');
        arrow.textContent = '▾';
      }
    });

    autoToggle.addEventListener('change', () => {
      currentConfig.autoDownload = autoToggle.checked;
      chrome.runtime.sendMessage({
        type: 'UPDATE_CONFIG',
        config: { autoDownload: autoToggle.checked }
      });
    });

    btnDownloadAll.addEventListener('click', () => {
      const videos = getPageOrderedVideos();
      if (videos.length === 0) return;
      videos.forEach(v => {
        chrome.runtime.sendMessage({ type: 'TRIGGER_DOWNLOAD', media: v });
      });
      btnDownloadAll.textContent = 'تم بدء التحميل!';
      setTimeout(() => {
        btnDownloadAll.textContent = `⬇️ تحميل الكل (${videos.length})`;
      }, 2500);
    });

    // Make dock draggable
    makeDraggable(dock, dragHandle);
  }

  function makeDraggable(el, handle) {
    let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
    handle.onmousedown = dragMouseDown;

    function dragMouseDown(e) {
      if (el.classList.contains('minimized')) return;
      e.preventDefault();
      pos3 = e.clientX;
      pos4 = e.clientY;
      document.onmouseup = closeDragElement;
      document.onmousemove = elementDrag;
    }

    function elementDrag(e) {
      e.preventDefault();
      pos1 = pos3 - e.clientX;
      pos2 = pos4 - e.clientY;
      pos3 = e.clientX;
      pos4 = e.clientY;
      el.style.top = (el.offsetTop - pos2) + "px";
      el.style.left = (el.offsetLeft - pos1) + "px";
      el.style.bottom = 'auto';
      el.style.transform = 'none';
    }

    function closeDragElement() {
      document.onmouseup = null;
      document.onmousemove = null;
    }
  }

  function updateDockUI() {
    const dock = document.getElementById('afkar-dock-container');
    if (!dock) return;

    const videos = getPageOrderedVideos();
    const count = videos.length;

    const dockCountEl = dock.querySelector('#afkarDockCount');
    const minCountEl = dock.querySelector('#afkarMinCount');
    const drawerCountEl = dock.querySelector('#afkarDrawerCount');
    const autoToggle = dock.querySelector('#afkarAutoToggle');
    const btnDownloadAll = dock.querySelector('#afkarBtnDownloadAll');

    if (dockCountEl) dockCountEl.textContent = count;
    if (minCountEl) minCountEl.textContent = count;
    if (drawerCountEl) drawerCountEl.textContent = count;
    if (autoToggle) autoToggle.checked = !!currentConfig.autoDownload;

    if (btnDownloadAll) {
      if (count > 0) {
        btnDownloadAll.disabled = false;
        btnDownloadAll.textContent = `⬇️ تحميل الكل (${count})`;
      } else {
        btnDownloadAll.disabled = true;
        btnDownloadAll.textContent = `⬇️ تحميل الكل`;
      }
    }

    if (isDrawerOpen) {
      renderDrawerList();
    }
  }

  function renderDrawerList() {
    const listEl = document.getElementById('afkarDrawerList');
    if (!listEl) return;

    const videos = getPageOrderedVideos();
    if (videos.length === 0) {
      listEl.innerHTML = '<div class="afkar-empty-box">توليد أي فيديو في Dola AI سيظهر هنا بجودة 1080P مباشرة وبدون علامة مائية!</div>';
      return;
    }

    listEl.innerHTML = '';
    videos.forEach((video, index) => {
      const card = document.createElement('div');
      card.className = 'afkar-scene-card';

      const posterHtml = video.poster
        ? `<img class="afkar-thumb" src="${video.poster}" alt="Preview" onerror="this.outerHTML='<div class=\\'afkar-thumb-fallback\\'>🎬</div>'">`
        : `<div class="afkar-thumb-fallback">🎬</div>`;

      const promptTitle = video.prompt || `مشهد ${index + 1}`;
      const resText = (video.width && video.height) ? `${video.width}x${video.height}` : '1080P Master';
      const sceneNum = video.sceneIndex || (index + 1);

      card.innerHTML = `
        <div class="afkar-card-left">
          ${posterHtml}
          <div class="afkar-info">
            <div class="afkar-scene-title" title="${promptTitle.replace(/"/g, '&quot;')}">
              <span class="afkar-num-tag">#${sceneNum}</span>
              <span>${promptTitle}</span>
            </div>
            <div class="afkar-badge-raw">💎 1080P Raw (${resText})</div>
          </div>
        </div>
        <div class="afkar-card-actions">
          <button class="afkar-btn-preview" title="معاينة الفيديو في نافذة جديدة">👁️</button>
          <button class="afkar-btn-save">حفظ</button>
        </div>
      `;

      card.querySelector('.afkar-btn-preview').addEventListener('click', (e) => {
        e.stopPropagation();
        if (video.url) {
          window.open(video.url, '_blank');
        }
      });

      const saveBtn = card.querySelector('.afkar-btn-save');
      saveBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        saveBtn.textContent = 'جاري الحفظ...';
        saveBtn.disabled = true;

        chrome.runtime.sendMessage({ type: 'TRIGGER_DOWNLOAD', media: video }, (res) => {
          if (res && res.ok) {
            saveBtn.textContent = 'تم الحفظ!';
            saveBtn.style.background = '#00e676';
            setTimeout(() => {
              saveBtn.textContent = 'حفظ';
              saveBtn.style.background = '';
              saveBtn.disabled = false;
            }, 2500);
          } else {
            saveBtn.textContent = 'فشل';
            setTimeout(() => {
              saveBtn.textContent = 'حفظ';
              saveBtn.disabled = false;
            }, 2000);
          }
        });
      });

      listEl.appendChild(card);
    });
  }

  // Debounced DOM Scanner to keep page load 100% fast & light
  let updateDebounceTimer = null;
  function scheduleUpdate() {
    if (updateDebounceTimer) return;
    updateDebounceTimer = setTimeout(() => {
      updateDebounceTimer = null;
      attachDownloadButtons();
      updateDockUI();
    }, 400);
  }

  // MutationObserver for new videos in DOM (debounced)
  const observer = new MutationObserver(() => {
    scheduleUpdate();
  });

  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true });
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      if (document.body) {
        observer.observe(document.body, { childList: true, subtree: true });
      }
    }, { once: true });
  }

  // Periodic scan (every 3 seconds)
  setInterval(scheduleUpdate, 3000);
})();

