// Hisense VIDAA TV IPTV Player Application
document.addEventListener('DOMContentLoaded', () => {
  const video = document.getElementById('videoPlayer');
  const channelListEl = document.getElementById('channelList');
  const countrySelect = document.getElementById('countrySelect');
  const categorySelect = document.getElementById('categorySelect');
  const osdContainer = document.getElementById('osdContainer');
  const infoBanner = document.getElementById('infoBanner');
  const channelNumEl = document.getElementById('channelNum');
  const channelTitleEl = document.getElementById('currentChannelTitle');
  const channelCatEl = document.getElementById('currentCategory');
  const loaderEl = document.getElementById('videoLoader');
  const loaderText = document.getElementById('loaderText');
  const channelSearch = document.getElementById('channelSearch');
  const clearSearchBtn = document.getElementById('clearSearchBtn');
  const filterStatusText = document.getElementById('filterStatusText');
  const totalBadge = document.getElementById('totalBadge');

  // Quick Filter Pills
  const pillFav = document.getElementById('pillFav');
  const favBadge = document.getElementById('favBadge');
  const pillAll = document.getElementById('pillAll');
  const pillUS = document.getElementById('pillUS');
  const pillUK = document.getElementById('pillUK');
  const pillCA = document.getElementById('pillCA');
  const pillIN = document.getElementById('pillIN');
  const pillTamil = document.getElementById('pillTamil');

  // Mobile Controls
  const mobileMuteBtn = document.getElementById('mobileMuteBtn');
  const mobileFullscreenBtn = document.getElementById('mobileFullscreenBtn');
  const mobileToggleDrawerBtn = document.getElementById('mobileToggleDrawerBtn');
  const closeDrawerBtn = document.getElementById('closeDrawerBtn');
  const videoContainer = document.getElementById('videoContainer');
  const modalOverlay = document.getElementById('modalOverlay');
  const toggleFavBtn = document.getElementById('toggleFavBtn');
  const addM3uBtn = document.getElementById('addM3uBtn');
  const reloadPlaylistBtn = document.getElementById('reloadPlaylistBtn');
  const closeModalBtn = document.getElementById('closeModalBtn');
  const cancelModalBtn = document.getElementById('cancelModalBtn');
  const savePlaylistBtn = document.getElementById('savePlaylistBtn');
  const m3uUrlInput = document.getElementById('m3uUrlInput');
  const m3uRawInput = document.getElementById('m3uRawInput');

  // Favorites system (persisted in localStorage)
  let favorites = [];
  try {
    const saved = localStorage.getItem('iptv_favorites');
    if (saved) {
      favorites = JSON.parse(saved);
      if (!Array.isArray(favorites)) favorites = [];
    }
  } catch (e) {
    favorites = [];
  }

  let channels = [];
  let currentCountry = 'all';
  let currentCategory = 'Entertainment'; // Category Entertainment first!
  let languageFilter = 'tamil'; // By default select Tamil
  let searchQuery = '';
  let focusedIndex = 0;
  let activeChannelIndex = -1;
  let renderedCount = 120;
  let hls = null;
  let osdTimeout = null;

  const filterPills = [pillFav, pillTamil, pillIN, pillAll, pillUS, pillUK, pillCA].filter(Boolean);

  function getActivePill() {
    return document.querySelector('.lang-pills .lang-pill.active') || pillTamil || filterPills[0];
  }

  function getChannelKey(ch) {
    return ch ? (ch.url || ch.id || ch.name) : '';
  }

  function isChannelFavorite(ch) {
    const key = getChannelKey(ch);
    return Boolean(key && favorites.includes(key));
  }

  function saveFavorites() {
    try {
      localStorage.setItem('iptv_favorites', JSON.stringify(favorites));
    } catch (e) {
      console.warn('Could not save favorites:', e);
    }
    updateFavUI();
  }

  function toggleFavorite(ch) {
    if (!ch) return;
    const key = getChannelKey(ch);
    if (!key) return;

    const idx = favorites.indexOf(key);
    if (idx >= 0) {
      favorites.splice(idx, 1);
    } else {
      favorites.push(key);
    }
    saveFavorites();

    invalidateChannelFilter();
    renderChannels();
  }

  function updateFavUI() {
    if (favBadge) favBadge.textContent = favorites.length;

    const list = getFilteredChannels();
    const curChannel = list[activeChannelIndex] || list[focusedIndex] || channels[0];
    if (toggleFavBtn && curChannel) {
      const isFav = isChannelFavorite(curChannel);
      toggleFavBtn.innerHTML = isFav ? '★ Favorited' : '⭐ Add Fav';
      toggleFavBtn.classList.toggle('is-favorited', isFav);
    }
  }

  // Initialize HLS Player
  function initPlayer() {
    if (Hls.isSupported()) {
      hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        backBufferLength: 60
      });
      hls.attachMedia(video);

      hls.on(Hls.Events.ERROR, (event, data) => {
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              console.warn('Network error encountered, trying to recover...');
              hls.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              console.warn('Media error encountered, trying to recover...');
              hls.recoverMediaError();
              break;
            default:
              console.error('Fatal stream error:', data);
              loaderText.textContent = 'Stream unavailable. Try another channel.';
              break;
          }
        }
      });

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        hideLoader();
        video.play().catch(e => console.log('Autoplay prevented:', e));
      });
    }
  }

  function showLoader(msg = 'Buffering Stream...') {
    loaderText.textContent = msg;
    loaderEl.classList.remove('hidden');
  }

  function hideLoader() {
    loaderEl.classList.add('hidden');
  }

  // Channel Zapper Banner for Fullscreen Mode
  const tvZapperBanner = document.getElementById('tvZapperBanner');
  const zapperChannelNum = document.getElementById('zapperChannelNum');
  const zapperChannelTitle = document.getElementById('zapperChannelTitle');
  const zapperFavStar = document.getElementById('zapperFavStar');
  const zapperChannelMeta = document.getElementById('zapperChannelMeta');
  let zapperTimeout = null;

  function showBriefChannelBanner(channel, index) {
    if (!tvZapperBanner || !channel) return;
    if (zapperTimeout) clearTimeout(zapperTimeout);

    zapperChannelNum.textContent = `CH ${index + 1}`;
    zapperChannelTitle.textContent = channel.name || `Channel ${index + 1}`;

    const isFav = isChannelFavorite(channel);
    if (zapperFavStar) {
      zapperFavStar.classList.toggle('hidden', !isFav);
    }

    const isTam = isTamilChannel(channel);
    const ctry = channel.country ? `${channel.country} • ` : '';
    zapperChannelMeta.textContent = `${ctry}${isTam ? 'Tamil • ' : ''}${channel.category || 'Entertainment'}`;

    tvZapperBanner.classList.remove('hidden');

    zapperTimeout = setTimeout(() => {
      tvZapperBanner.classList.add('hidden');
    }, 3500);
  }

  let lastPlayingIndex = -1;

  // Play specified channel
  function playChannel(filteredIndex, resetTimer = true) {
    const list = getFilteredChannels();
    const channel = list[filteredIndex];
    if (!channel) return;

    // Highlight playing item efficiently without querying the whole DOM
    const children = channelListEl.children;
    if (lastPlayingIndex >= 0 && lastPlayingIndex < children.length) {
      children[lastPlayingIndex].classList.remove('playing');
    }
    activeChannelIndex = filteredIndex;
    if (filteredIndex >= 0 && filteredIndex < children.length) {
      children[filteredIndex].classList.add('playing');
      lastPlayingIndex = filteredIndex;
    }

    showLoader(`Opening ${channel.name}...`);
    if (resetTimer && osdContainer.classList.contains('visible')) {
      resetOsdTimer();
    }

    // Update banner
    channelNumEl.textContent = `CH ${filteredIndex + 1}`;
    channelTitleEl.textContent = channel.name;
    const isTam = channel._isTamil !== undefined ? channel._isTamil : isTamilChannel(channel);
    const ctry = channel.country ? `${channel.country} • ` : '';
    channelCatEl.textContent = `${ctry}${isTam ? 'Tamil • ' : ''}${channel.category || 'Live'}`;

    updateFavUI();

    const streamUrl = channel.url;
    if (Hls.isSupported() && hls) {
      hls.loadSource(streamUrl);
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = streamUrl;
      video.play().catch(e => console.log('Play error:', e));
    }
  }

  let zapDebounceTimeout = null;

  function playNextChannel() {
    const list = getFilteredChannels();
    if (!list.length) return;

    let nextIndex = activeChannelIndex + 1;
    if (nextIndex >= list.length) {
      nextIndex = 0;
    }

    focusedIndex = nextIndex;
    const isMenuOpen = osdContainer.classList.contains('visible');

    if (!isMenuOpen) {
      activeChannelIndex = nextIndex;
      showBriefChannelBanner(list[nextIndex], nextIndex);
      if (zapDebounceTimeout) clearTimeout(zapDebounceTimeout);
      zapDebounceTimeout = setTimeout(() => {
        playChannel(nextIndex, false);
      }, 250);
    } else {
      playChannel(nextIndex, true);
      updateFocus();
    }
  }

  function playPrevChannel() {
    const list = getFilteredChannels();
    if (!list.length) return;

    let prevIndex = activeChannelIndex - 1;
    if (prevIndex < 0) {
      prevIndex = list.length - 1;
    }

    focusedIndex = prevIndex;
    const isMenuOpen = osdContainer.classList.contains('visible');

    if (!isMenuOpen) {
      activeChannelIndex = prevIndex;
      showBriefChannelBanner(list[prevIndex], prevIndex);
      if (zapDebounceTimeout) clearTimeout(zapDebounceTimeout);
      zapDebounceTimeout = setTimeout(() => {
        playChannel(prevIndex, false);
      }, 250);
    } else {
      playChannel(prevIndex, true);
      updateFocus();
    }
  }

  window.playNextChannel = playNextChannel;
  window.playPrevChannel = playPrevChannel;

  // Smart Tamil detector
  const tamilKeywords = /\b(tamil|sun\s*tv|sun\s*music|sun\s*news|ktv|vijay|jaya|thanthi|polimer|puthiya\s*thalaimurai|kalaignar|raj\s*tv|raj\s*musix|captain|mega\s*tv|vasanth|lotus|malaimurasu|sathiyam|velicham|peppers|madha|isai|chithiram|sirippoli|murasu|seithigal|vendhar|makkal|moon\s*tv|tamilan|vanavil|imayam|mk\s*tv|cauvery|valicham|dheeran|news18\s*tamil|tamil\s*janam|arputhar|aaryaa|aaseervatham|aathavan)\b/i;

  function isTamilChannel(ch) {
    if (ch.language && ch.language.toLowerCase() === 'tamil') return true;
    if (ch.language && ['spanish', 'portuguese', 'russian', 'french', 'german', 'italian', 'arabic'].includes(ch.language.toLowerCase())) {
      return false;
    }
    if (ch.country && ['bolivia', 'brazil', 'peru', 'mexico', 'colombia', 'argentina', 'chile', 'spain', 'russia', 'italy', 'france'].includes(ch.country.toLowerCase())) {
      return false;
    }
    return tamilKeywords.test(ch.name) || (ch.id && /tamil|\.ta@/i.test(ch.id)) || (ch.category && /tamil/i.test(ch.category));
  }

  let cachedFilteredChannels = null;

  function invalidateChannelFilter() {
    cachedFilteredChannels = null;
  }

  // Filter channels by Country, Category, Language & Search
  function getFilteredChannels() {
    if (cachedFilteredChannels) {
      return cachedFilteredChannels;
    }

    const q = searchQuery ? searchQuery.toLowerCase() : '';
    const isFavFilter = languageFilter === 'favorites';
    const isTamFilter = languageFilter === 'tamil';
    const hasCountryFilter = currentCountry !== 'all';
    const ctryLower = hasCountryFilter ? currentCountry.toLowerCase() : '';
    const hasCategoryFilter = currentCategory !== 'all';

    cachedFilteredChannels = channels.filter(c => {
      // Favorites filter
      if (isFavFilter) {
        return isChannelFavorite(c);
      }

      // Language check
      const isTam = c._isTamil !== undefined ? c._isTamil : isTamilChannel(c);
      if (isTamFilter && !isTam) return false;

      // Country check
      if (hasCountryFilter) {
        const ctry = c._lowerCountry || (c.country || 'International').toLowerCase();
        if (ctry !== ctryLower) return false;
      }

      // Category check
      if (hasCategoryFilter) {
        if (c.category !== currentCategory) return false;
      }

      // Search query check (matches name, country, or category)
      if (q) {
        const matchName = c._lowerName && c._lowerName.includes(q);
        const matchCountry = c._lowerCountry && c._lowerCountry.includes(q);
        const matchCategory = c._lowerCategory && c._lowerCategory.includes(q);
        if (!matchName && !matchCountry && !matchCategory) return false;
      }

      return true;
    });

    return cachedFilteredChannels;
  }

  // Populate Country Dropdown
  function renderCountries() {
    if (!countrySelect) return;
    const countryCounts = {};
    channels.forEach(c => {
      const ctry = c.country || 'International';
      countryCounts[ctry] = (countryCounts[ctry] || 0) + 1;
    });

    countrySelect.innerHTML = '';
    const allOpt = document.createElement('option');
    allOpt.value = 'all';
    allOpt.textContent = `All Countries (${channels.length})`;
    if (currentCountry === 'all') allOpt.selected = true;
    countrySelect.appendChild(allOpt);

    // Sort by channel count descending
    const sortedCountries = Object.keys(countryCounts).sort((a, b) => countryCounts[b] - countryCounts[a]);
    sortedCountries.forEach(ctry => {
      const opt = document.createElement('option');
      opt.value = ctry;
      opt.textContent = `${ctry} (${countryCounts[ctry]})`;
      if (ctry.toLowerCase() === currentCountry.toLowerCase()) opt.selected = true;
      countrySelect.appendChild(opt);
    });
  }

  // Populate Category Dropdown based on currently selected Country
  function renderCategories() {
    if (!categorySelect) return;
    const baseList = currentCountry === 'all'
      ? channels
      : channels.filter(c => (c.country || 'International').toLowerCase() === currentCountry.toLowerCase());

    const counts = { all: baseList.length };
    baseList.forEach(c => {
      const cat = c.category || 'General';
      counts[cat] = (counts[cat] || 0) + 1;
    });

    categorySelect.innerHTML = '';

    // 1. Entertainment Category FIRST
    const entCount = counts['Entertainment'] || 0;
    const entOpt = document.createElement('option');
    entOpt.value = 'Entertainment';
    entOpt.textContent = `🎬 Entertainment (${entCount})`;
    if (currentCategory === 'Entertainment') entOpt.selected = true;
    categorySelect.appendChild(entOpt);

    // 2. All Categories
    const allOpt = document.createElement('option');
    allOpt.value = 'all';
    allOpt.textContent = `All Categories (${counts.all})`;
    if (currentCategory === 'all') allOpt.selected = true;
    categorySelect.appendChild(allOpt);

    // 3. Other categories sorted alphabetically
    const sortedCats = Object.keys(counts)
      .filter(k => k !== 'all' && k.toLowerCase() !== 'entertainment' && counts[k] > 0)
      .sort((a, b) => a.localeCompare(b));

    sortedCats.forEach(cat => {
      const opt = document.createElement('option');
      opt.value = cat;
      opt.textContent = `${cat} (${counts[cat]})`;
      if (cat === currentCategory) opt.selected = true;
      categorySelect.appendChild(opt);
    });
  }

  // Quick Pill Button Handlers
  function updatePillActive(activePill) {
    document.querySelectorAll('.lang-pills .lang-pill').forEach(p => p.classList.remove('active'));
    if (activePill) activePill.classList.add('active');
  }

  if (pillFav) {
    pillFav.addEventListener('click', () => {
      languageFilter = 'favorites';
      currentCountry = 'all';
      currentCategory = 'all';
      updatePillActive(pillFav);
      if (countrySelect) countrySelect.value = 'all';
      if (categorySelect) categorySelect.value = 'all';
      focusedIndex = 0;
      renderedCount = 120;
      renderCategories();
      renderChannels();
    });
  }

  if (toggleFavBtn) {
    toggleFavBtn.addEventListener('click', () => {
      const list = getFilteredChannels();
      const curChannel = list[activeChannelIndex] || list[focusedIndex] || channels[0];
      if (curChannel) {
        toggleFavorite(curChannel);
      }
    });
  }

  if (pillAll) {
    pillAll.addEventListener('click', () => {
      currentCountry = 'all';
      languageFilter = 'all';
      updatePillActive(pillAll);
      if (countrySelect) countrySelect.value = 'all';
      focusedIndex = 0;
      renderedCount = 120;
      renderCategories();
      renderChannels();
    });
  }

  if (pillUS) {
    pillUS.addEventListener('click', () => {
      currentCountry = 'United States';
      languageFilter = 'all';
      updatePillActive(pillUS);
      if (countrySelect) countrySelect.value = 'United States';
      focusedIndex = 0;
      renderedCount = 120;
      renderCategories();
      renderChannels();
    });
  }

  if (pillUK) {
    pillUK.addEventListener('click', () => {
      currentCountry = 'United Kingdom';
      languageFilter = 'all';
      updatePillActive(pillUK);
      if (countrySelect) countrySelect.value = 'United Kingdom';
      focusedIndex = 0;
      renderedCount = 120;
      renderCategories();
      renderChannels();
    });
  }

  if (pillCA) {
    pillCA.addEventListener('click', () => {
      currentCountry = 'Canada';
      languageFilter = 'all';
      updatePillActive(pillCA);
      if (countrySelect) countrySelect.value = 'Canada';
      focusedIndex = 0;
      renderedCount = 120;
      renderCategories();
      renderChannels();
    });
  }

  if (pillIN) {
    pillIN.addEventListener('click', () => {
      currentCountry = 'India';
      languageFilter = 'all';
      updatePillActive(pillIN);
      if (countrySelect) countrySelect.value = 'India';
      focusedIndex = 0;
      renderedCount = 120;
      renderCategories();
      renderChannels();
    });
  }

  if (pillTamil) {
    pillTamil.addEventListener('click', () => {
      languageFilter = 'tamil';
      currentCountry = 'all';
      updatePillActive(pillTamil);
      if (countrySelect) countrySelect.value = 'all';
      focusedIndex = 0;
      renderedCount = 120;
      renderCategories();
      renderChannels();
    });
  }

  // Country Dropdown Handler
  if (countrySelect) {
    countrySelect.addEventListener('change', (e) => {
      currentCountry = e.target.value;
      languageFilter = 'all';

      // Update pills
      document.querySelectorAll('.lang-pills .lang-pill').forEach(p => {
        p.classList.toggle('active', p.dataset.country === currentCountry);
      });

      focusedIndex = 0;
      renderedCount = 120;
      renderCategories();
      renderChannels();
    });
  }

  // Category Dropdown Handler
  if (categorySelect) {
    categorySelect.addEventListener('change', (e) => {
      currentCategory = e.target.value;
      focusedIndex = 0;
      renderedCount = 120;
      renderChannels();
    });
  }

  let lastFocusedIndex = -1;

  // Render Channel List
  function renderChannels(isAppend = false) {
    if (!isAppend) {
      invalidateChannelFilter();
    }
    const list = getFilteredChannels();

    if (!isAppend) {
      channelListEl.innerHTML = '';
      renderedCount = Math.min(120, list.length);
      lastFocusedIndex = -1;
      lastPlayingIndex = -1;
    }

    const ctryLabel = currentCountry === 'all' ? 'All Countries' : currentCountry;
    const catLabel = currentCategory === 'all' ? 'All Categories' : currentCategory;
    const langLabel = languageFilter === 'tamil' ? ' (Tamil Only)' : (languageFilter === 'favorites' ? ' (Favorites)' : '');

    filterStatusText.textContent = searchQuery
      ? `Found ${list.length} channels for "${searchQuery}"`
      : `Showing ${Math.min(renderedCount, list.length)} of ${list.length} channels • ${catLabel} / ${ctryLabel}${langLabel}`;

    if (list.length === 0) {
      if (languageFilter === 'favorites') {
        channelListEl.innerHTML = `
          <div class="empty-list">
            <div style="font-size: 38px; margin-bottom: 10px;">⭐</div>
            <div style="font-weight: 700; font-size: 16px; color: #ffd700;">No Favorite Channels Yet</div>
            <div style="font-size: 13px; margin-top: 8px; color: #94a3b8; max-width: 280px; margin-left: auto; margin-right: auto;">
              Play any channel and click the <b>[⭐ Add Fav]</b> button at the top to save your favorites!
            </div>
          </div>
        `;
      } else {
        channelListEl.innerHTML = `
          <div style="padding: 30px 10px; text-align: center; color: #8892b0;">
            <div style="font-size: 32px; margin-bottom: 8px;">🔍</div>
            <div style="font-weight: 600; color: #fff;">No channels found</div>
            <div style="font-size: 13px; margin-top: 4px;">Try another search keyword or switch country/category.</div>
          </div>
        `;
      }
      return;
    }

    const startIndex = isAppend ? channelListEl.children.length : 0;
    const displayList = list.slice(startIndex, renderedCount);
    const fragment = document.createDocumentFragment();

    displayList.forEach((ch, idxOffset) => {
      const idx = startIndex + idxOffset;
      const item = document.createElement('div');
      item.className = `channel-item ${idx === focusedIndex ? 'focused' : ''} ${idx === activeChannelIndex ? 'playing' : ''}`;
      item.dataset.index = idx;

      const displayName = ch.name || `Channel ${idx + 1}`;
      const categoryTag = ch.category || 'Live';
      const countryTag = ch.country || 'Global';
      const isTam = ch._isTamil !== undefined ? ch._isTamil : isTamilChannel(ch);
      const isFav = isChannelFavorite(ch);

      item.innerHTML = `
        <div class="channel-main">
          <span class="channel-idx">${idx + 1}</span>
          <span class="channel-title">${escapeHtml(displayName)}</span>
        </div>
        <div class="channel-tags-container">
          ${isFav ? '<span class="channel-tag fav-badge">★ Fav</span>' : ''}
          <span class="channel-tag country-badge">${escapeHtml(countryTag)}</span>
          ${isTam ? '<span class="channel-tag tamil-badge">Tamil</span>' : ''}
          <span class="channel-tag">${escapeHtml(categoryTag)}</span>
        </div>
      `;

      item.addEventListener('click', () => {
        focusedIndex = idx;
        updateFocus();
        playChannel(idx);
      });

      fragment.appendChild(item);
    });

    channelListEl.appendChild(fragment);

    if (!isAppend) {
      lastFocusedIndex = focusedIndex;
      lastPlayingIndex = activeChannelIndex;
      scrollFocusedIntoView();
    }
  }

  // Progressive infinite scroll for large channel lists
  channelListEl.addEventListener('scroll', () => {
    if (channelListEl.scrollTop + channelListEl.clientHeight >= channelListEl.scrollHeight - 300) {
      const list = getFilteredChannels();
      if (renderedCount < list.length) {
        renderedCount = Math.min(renderedCount + 100, list.length);
        renderChannels(true);
      }
    }
  });

  function escapeHtml(text) {
    if (!text) return '';
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function updateFocus() {
    const children = channelListEl.children;
    if (lastFocusedIndex >= 0 && lastFocusedIndex < children.length) {
      children[lastFocusedIndex].classList.remove('focused');
    }
    if (focusedIndex >= 0 && focusedIndex < children.length) {
      children[focusedIndex].classList.add('focused');
      lastFocusedIndex = focusedIndex;
    }
    scrollFocusedIntoView();
  }

  function scrollFocusedIntoView() {
    const focusedEl = channelListEl.children[focusedIndex];
    if (focusedEl) {
      focusedEl.scrollIntoView({ block: 'nearest', behavior: 'auto' });
    }
  }

  function resetOsdTimer() {
    if (osdTimeout) clearTimeout(osdTimeout);
    osdContainer.classList.add('visible');
    infoBanner.classList.add('visible');

    // On mobile screens (< 900px), never auto-hide the lower channel list!
    if (window.innerWidth < 900) {
      return;
    }

    osdTimeout = setTimeout(() => {
      if (video && !video.paused) {
        osdContainer.classList.remove('visible');
        infoBanner.classList.remove('visible');
      }
    }, 7000);
  }

  // Mobile Control Handlers
  if (mobileMuteBtn) {
    mobileMuteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      video.muted = !video.muted;
      mobileMuteBtn.textContent = video.muted ? '🔇' : '🔊';
    });
  }

  if (mobileFullscreenBtn) {
    mobileFullscreenBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isFullscreen = document.fullscreenElement || document.webkitFullscreenElement || video.webkitDisplayingFullscreen;
      if (!isFullscreen) {
        if (video.requestFullscreen) {
          video.requestFullscreen().catch(err => console.log(err));
        } else if (video.webkitEnterFullscreen) {
          video.webkitEnterFullscreen();
        } else if (videoContainer && videoContainer.requestFullscreen) {
          videoContainer.requestFullscreen().catch(err => console.log(err));
        }
      } else {
        if (document.exitFullscreen) {
          document.exitFullscreen().catch(err => console.log(err));
        } else if (document.webkitExitFullscreen) {
          document.webkitExitFullscreen();
        }
      }
    });
  }

  if (mobileToggleDrawerBtn) {
    mobileToggleDrawerBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      osdContainer.classList.toggle('drawer-open');
    });
  }

  if (closeDrawerBtn) {
    closeDrawerBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      osdContainer.classList.remove('drawer-open');
    });
  }

  // Close landscape drawer on channel selection
  const origPlayChannel = playChannel;
  playChannel = function(idx) {
    origPlayChannel(idx);
    if (window.innerWidth < 900) {
      osdContainer.classList.remove('drawer-open');
    }
  };

  // Search filter handler
  channelSearch.addEventListener('input', (e) => {
    searchQuery = e.target.value.trim();
    clearSearchBtn.classList.toggle('hidden', searchQuery.length === 0);
    focusedIndex = 0;
    renderedCount = 120;
    renderChannels();
  });

  clearSearchBtn.addEventListener('click', () => {
    channelSearch.value = '';
    searchQuery = '';
    clearSearchBtn.classList.add('hidden');
    focusedIndex = 0;
    renderedCount = 120;
    renderChannels();
    channelSearch.focus();
  });

  // Remote Control Navigation
  window.addEventListener('keydown', (e) => {
    if (!modalOverlay.classList.contains('hidden')) {
      if (e.key === 'Escape' || e.keyCode === 27 || e.keyCode === 10009) {
        closeModal();
      }
      return;
    }

    const list = getFilteredChannels();
    const isMenuOpen = osdContainer.classList.contains('visible');

    // 1. Channel Up / Down (ALWAYS switch channel directly, NEVER open the menu!)
    if (e.key === 'ChannelUp' || e.key === 'PageUp' || e.keyCode === 427 || e.keyCode === 33 || e.key === '+' || e.key === '=') {
      e.preventDefault();
      playNextChannel();
      return;
    }
    if (e.key === 'ChannelDown' || e.key === 'PageDown' || e.keyCode === 428 || e.keyCode === 34 || e.key === '-' || e.key === '_') {
      e.preventDefault();
      playPrevChannel();
      return;
    }

    // 2. When in FULLSCREEN mode (sidebar menu is NOT visible)
    if (!isMenuOpen) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        playNextChannel();
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        playPrevChannel();
        return;
      }
      if (e.key === 'Enter' || e.key === 'Back' || e.key === 'Escape' || e.key === 'GoBack' || e.key === 'Backspace') {
        e.preventDefault();
        osdContainer.classList.add('visible');
        resetOsdTimer();
        updateFocus();
        return;
      }
      if (e.key === 'f' || e.key === 'F' || e.key === '*') {
        e.preventDefault();
        const curCh = list[activeChannelIndex];
        if (curCh) {
          toggleFavorite(curCh);
          showBriefChannelBanner(curCh, activeChannelIndex);
        }
        return;
      }
      return;
    }

    // 3. When sidebar menu IS OPEN:
    resetOsdTimer();
    const activeEl = document.activeElement;

    // 1. Top Actions: Fav, Refresh & Add M3U
    if (activeEl === toggleFavBtn || activeEl === reloadPlaylistBtn || activeEl === addM3uBtn) {
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        if (activeEl === toggleFavBtn) reloadPlaylistBtn.focus();
        else if (activeEl === reloadPlaylistBtn) addM3uBtn.focus();
        return;
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        if (activeEl === addM3uBtn) reloadPlaylistBtn.focus();
        else if (activeEl === reloadPlaylistBtn) toggleFavBtn.focus();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        channelSearch.focus();
        return;
      }
      if (e.key === 'Enter') {
        return; // default click handler executes
      }
    }

    // 2. Search Box
    if (activeEl === channelSearch) {
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (toggleFavBtn) toggleFavBtn.focus();
        else reloadPlaylistBtn.focus();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const activePill = getActivePill();
        if (activePill) activePill.focus();
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        channelSearch.blur();
        updateFocus();
        return;
      }
      return;
    }

    // 3. Pre-filter Pills
    if (filterPills.includes(activeEl)) {
      const curIndex = filterPills.indexOf(activeEl);

      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        const prev = filterPills[Math.max(0, curIndex - 1)];
        if (prev) prev.focus();
        return;
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        const next = filterPills[Math.min(filterPills.length - 1, curIndex + 1)];
        if (next) next.focus();
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        channelSearch.focus();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (categorySelect) categorySelect.focus();
        else if (countrySelect) countrySelect.focus();
        else updateFocus();
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        activeEl.click();
        return;
      }
    }

    // 4. Category Dropdown (Category first)
    if (activeEl === categorySelect) {
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        const activePill = getActivePill();
        if (activePill) activePill.focus();
        return;
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        if (countrySelect) countrySelect.focus();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        categorySelect.blur();
        updateFocus();
        return;
      }
      return;
    }

    // 5. Country Dropdown
    if (activeEl === countrySelect) {
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        const activePill = getActivePill();
        if (activePill) activePill.focus();
        return;
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        if (categorySelect) categorySelect.focus();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        countrySelect.blur();
        updateFocus();
        return;
      }
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (focusedIndex < list.length - 1) {
          focusedIndex++;
          if (focusedIndex >= renderedCount - 10 && renderedCount < list.length) {
            renderedCount = Math.min(renderedCount + 80, list.length);
            renderChannels(true);
          }
          updateFocus();
        }
        break;

      case 'ArrowUp':
        e.preventDefault();
        if (focusedIndex > 0) {
          focusedIndex--;
          updateFocus();
        } else {
          if (categorySelect) categorySelect.focus();
          else if (countrySelect) countrySelect.focus();
        }
        break;

      case 'f':
      case 'F':
      case '*':
        e.preventDefault();
        const curCh = list[focusedIndex] || list[activeChannelIndex];
        if (curCh) {
          toggleFavorite(curCh);
        }
        break;

      case 'Enter':
        e.preventDefault();
        playChannel(focusedIndex);
        break;

      case 'ArrowRight':
      case 'ArrowLeft':
        e.preventDefault();
        // Cycle pre-filter pills directly
        const curActive = getActivePill();
        let pIdx = filterPills.indexOf(curActive);
        if (e.key === 'ArrowRight') {
          pIdx = (pIdx + 1) % filterPills.length;
        } else {
          pIdx = (pIdx - 1 + filterPills.length) % filterPills.length;
        }
        if (filterPills[pIdx]) {
          filterPills[pIdx].click();
        }
        break;

      case 'Escape':
      case 'Backspace':
      case 'GoBack':
      case 'Back':
        if (searchQuery) {
          channelSearch.value = '';
          searchQuery = '';
          clearSearchBtn.classList.add('hidden');
          renderChannels();
        } else if (osdContainer.classList.contains('visible')) {
          osdContainer.classList.remove('visible');
        } else {
          osdContainer.classList.add('visible');
        }
        break;
    }
  });

  window.addEventListener('mousemove', resetOsdTimer);

  // Load Playlist
  async function loadPlaylist() {
    showLoader('Loading Tamil & Global channels...');
    try {
      let res = await fetch('/api/playlist');
      if (!res.ok) {
        res = await fetch('./playlist.json');
      }
      if (res.ok) {
        channels = await res.json();
        // One-time precomputation for instant O(1) D-pad navigation and filtering
        channels.forEach(c => {
          c._isTamil = isTamilChannel(c);
          c._lowerName = (c.name || '').toLowerCase();
          c._lowerCountry = (c.country || 'International').toLowerCase();
          c._lowerCategory = (c.category || 'Live').toLowerCase();
        });
      }
    } catch (e) {
      console.warn('Could not fetch playlist:', e);
    }

    if (totalBadge) {
      totalBadge.textContent = `${channels.length} Channels`;
    }

    // Default to Tamil & Entertainment
    languageFilter = 'tamil';
    currentCountry = 'all';
    currentCategory = 'Entertainment';
    updatePillActive(pillTamil);
    updateFavUI();

    renderCountries();
    renderCategories();
    renderChannels();
    const filtered = getFilteredChannels();
    if (filtered.length > 0) {
      playChannel(0);
    }
  }

  // Modal Handlers
  function openModal() {
    modalOverlay.classList.remove('hidden');
    m3uUrlInput.focus();
  }

  function closeModal() {
    modalOverlay.classList.add('hidden');
  }

  addM3uBtn.addEventListener('click', openModal);
  closeModalBtn.addEventListener('click', closeModal);
  cancelModalBtn.addEventListener('click', closeModal);

  reloadPlaylistBtn.addEventListener('click', async () => {
    showLoader('Refreshing & downloading latest channels from IPTV-ORG...');
    try {
      const res = await fetch('/api/refresh');
      if (res.ok) {
        const data = await res.json();
        console.log('Channels refreshed successfully:', data);
      }
    } catch (e) {
      console.warn('Refresh error:', e);
    }
    await loadPlaylist();
  });

  initPlayer();
  loadPlaylist();
});
