// Afkar AI Pilot Popup Script - مختبر أفكار AI

document.addEventListener('DOMContentLoaded', () => {
  const totalDownloadedEl = document.getElementById('totalDownloaded');
  const detectedCountEl = document.getElementById('detectedCount');
  const autoDownloadToggle = document.getElementById('autoDownloadToggle');
  const notificationsToggle = document.getElementById('notificationsToggle');
  const videosList = document.getElementById('videosList');
  const downloadAllBtn = document.getElementById('downloadAllBtn');
  const ytChannelLink = document.getElementById('ytChannelLink');

  let currentVideos = [];

  // YouTube link click handler
  if (ytChannelLink) {
    ytChannelLink.addEventListener('click', (e) => {
      e.preventDefault();
      const url = 'https://www.youtube.com/@AfkarAILab';
      if (chrome.tabs && chrome.tabs.create) {
        chrome.tabs.create({ url });
      } else {
        window.open(url, '_blank');
      }
    });
  }

  function loadState() {
    // 1. First ask active tab for exact on-page order
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const activeTab = tabs && tabs[0];
      if (activeTab && activeTab.id) {
        chrome.tabs.sendMessage(activeTab.id, { type: 'GET_PAGE_ORDERED_VIDEOS' }, (tabRes) => {
          if (tabRes && tabRes.videos && tabRes.videos.length > 0) {
            chrome.runtime.sendMessage({ type: 'GET_CAPTURED_VIDEOS' }, (bgRes) => {
              const config = bgRes ? bgRes.config : {};
              currentVideos = tabRes.videos;
              updateUI(currentVideos, config);
            });
            return;
          }
          // Fallback to background stored list
          fetchFromBackground();
        });
      } else {
        fetchFromBackground();
      }
    });
  }

  function fetchFromBackground() {
    chrome.runtime.sendMessage({ type: 'GET_CAPTURED_VIDEOS' }, (response) => {
      if (!response) return;
      const { videos, config } = response;
      currentVideos = videos || [];
      updateUI(currentVideos, config);
    });
  }

  function updateUI(videos, config) {
    totalDownloadedEl.textContent = config?.totalDownloaded || 0;
    detectedCountEl.textContent = videos.length;
    autoDownloadToggle.checked = !!config?.autoDownload;
    notificationsToggle.checked = config?.notifications !== false;
    renderVideosList(videos);
  }

  function renderVideosList(videos) {
    if (!videos || videos.length === 0) {
      videosList.innerHTML = `
        <div class="empty-state">
          <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.5">
            <polygon points="23 7 16 12 23 17 23 7"></polygon>
            <rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect>
          </svg>
          <p>افتح محادثة Dola AI تحتوي على فيديوهات لتحميلها بأعلى جودة 1080P بدون علامة مائية!</p>
        </div>
      `;
      downloadAllBtn.style.display = 'none';
      return;
    }

    // Strict 1-by-1 chronological sort (Scene 1 on top, Scene 2 second, etc.)
    const sortedVideos = [...videos].sort((a, b) => {
      const aIdx = a.sceneIndex || 0;
      const bIdx = b.sceneIndex || 0;
      if (aIdx && bIdx) return aIdx - bIdx;

      const aMatch = String(a.prompt || '').match(/Scene[_\s]*(\d+)/i);
      const bMatch = String(b.prompt || '').match(/Scene[_\s]*(\d+)/i);
      if (aMatch && bMatch) {
        return parseInt(aMatch[1], 10) - parseInt(bMatch[1], 10);
      }
      return (a.timestamp || 0) - (b.timestamp || 0);
    });

    currentVideos = sortedVideos;
    downloadAllBtn.style.display = 'block';
    videosList.innerHTML = '';

    sortedVideos.forEach((video, index) => {
      const item = document.createElement('div');
      item.className = 'video-item';

      const posterHtml = video.poster
        ? `<img class="video-thumb" src="${video.poster}" alt="Preview" onerror="this.outerHTML='<div class=\\'video-thumb-fallback\\'>🎬</div>'">`
        : `<div class="video-thumb-fallback">🎬</div>`;

      const promptTitle = video.prompt || `مشهد ${index + 1}`;
      const resText = (video.width && video.height) ? `${video.width}x${video.height}` : '1080P Master';
      const sceneNum = video.sceneIndex || (index + 1);

      item.innerHTML = `
        <div class="video-card-left">
          ${posterHtml}
          <div class="video-info">
            <div class="video-prompt" title="${promptTitle.replace(/"/g, '&quot;')}">
              <span class="scene-number-badge">#${sceneNum}</span>
              <span>${promptTitle}</span>
            </div>
            <div class="video-badge">💎 1080P Raw (${resText})</div>
          </div>
        </div>
        <div class="video-actions">
          <button class="preview-btn" title="معاينة الفيديو">👁️</button>
          <button class="dl-btn" data-index="${index}">حفظ</button>
        </div>
      `;

      // Preview button
      item.querySelector('.preview-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        if (video.url) {
          window.open(video.url, '_blank');
        }
      });

      // Save button
      const dlBtn = item.querySelector('.dl-btn');
      dlBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        dlBtn.textContent = 'جاري الحفظ...';
        dlBtn.disabled = true;
        chrome.runtime.sendMessage({ type: 'TRIGGER_DOWNLOAD', media: video }, (res) => {
          if (res && res.ok) {
            dlBtn.textContent = 'تم الحفظ!';
            dlBtn.style.background = '#00e676';
            setTimeout(() => {
              dlBtn.textContent = 'حفظ';
              dlBtn.style.background = '';
              dlBtn.disabled = false;
            }, 2500);
            fetchFromBackground();
          } else {
            dlBtn.textContent = 'فشل';
            setTimeout(() => {
              dlBtn.textContent = 'حفظ';
              dlBtn.disabled = false;
            }, 2000);
          }
        });
      });

      videosList.appendChild(item);
    });
  }

  // Toggles
  autoDownloadToggle.addEventListener('change', () => {
    chrome.runtime.sendMessage({
      type: 'UPDATE_CONFIG',
      config: { autoDownload: autoDownloadToggle.checked }
    });
  });

  notificationsToggle.addEventListener('change', () => {
    chrome.runtime.sendMessage({
      type: 'UPDATE_CONFIG',
      config: { notifications: notificationsToggle.checked }
    });
  });

  // Batch download
  downloadAllBtn.addEventListener('click', () => {
    currentVideos.forEach((v) => {
      chrome.runtime.sendMessage({ type: 'TRIGGER_DOWNLOAD', media: v });
    });
    downloadAllBtn.textContent = 'تم بدء التحميل!';
    setTimeout(() => {
      downloadAllBtn.textContent = '⬇️ تحميل الكل';
    }, 2500);
  });

  loadState();
});
