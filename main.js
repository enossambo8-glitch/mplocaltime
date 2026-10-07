const app = (() => {
  const utils = {
    qs: (selector, root = document) => root.querySelector(selector),
    qsa: (selector, root = document) => Array.from(root.querySelectorAll(selector)),
    on: (el, event, fn) => el && el.addEventListener(event, fn),
  };

  const escapeHTML = (text) => String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  // Canonical public article link for any story object returned by the API:
  // prefer the stable slug, fall back to the numeric id.
  const storyHref = (story) => `/story/${encodeURIComponent(story?.slug || story?.id || '')}`;

  const initMenu = () => {
    const button = utils.qs('.nav-toggle');
    const nav = utils.qs('.nav-primary');
    if (!button || !nav) return;

    const setOpen = (open) => {
      button.setAttribute('aria-expanded', String(open));
      nav.classList.toggle('nav-open', open);
    };

    utils.on(button, 'click', () => {
      const expanded = button.getAttribute('aria-expanded') === 'true';
      setOpen(!expanded);
    });

    // Close the mobile menu with Escape and return focus to the trigger,
    // so keyboard users are never left stranded inside a hidden menu.
    utils.on(document, 'keydown', (event) => {
      if (event.key === 'Escape' && button.getAttribute('aria-expanded') === 'true') {
        setOpen(false);
        button.focus();
      }
    });

    // Close the menu once a navigation link is activated, and when a click
    // happens outside of the nav/menu trigger entirely.
    utils.on(nav, 'click', (event) => {
      if (event.target.closest('a')) setOpen(false);
    });
    utils.on(document, 'click', (event) => {
      if (button.getAttribute('aria-expanded') !== 'true') return;
      if (nav.contains(event.target) || button.contains(event.target)) return;
      setOpen(false);
    });
  };

  const initHeader = () => {
    const header = utils.qs('.site-header');
    const onScroll = () => {
      header?.classList.toggle('scrolled', window.scrollY > 16);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  };

  const initDarkMode = () => {
    const toggle = utils.qs('#themeToggle');
    const root = document.documentElement;
    const stored = localStorage.getItem('theme');
    if (stored === 'dark') {
      root.setAttribute('data-theme', 'dark');
      if (toggle) toggle.textContent = '🌙';
    }
    utils.on(toggle, 'click', () => {
      const active = root.getAttribute('data-theme') === 'dark';
      root.setAttribute('data-theme', active ? 'light' : 'dark');
      localStorage.setItem('theme', active ? 'light' : 'dark');
      toggle.textContent = active ? '☀️' : '🌙';
    });
  };

  // Renders a single public story as a newspaper-style article card, reusing
  // the existing .card/.card-content/.category-pill/.meta-row classes.
  const buildStoryCardMarkup = (story) => {
    const image = story.featured_image || '/logo.png';
    const imageAlt = story.image_alt || story.title || 'Mpumalanga Local Time';
    const category = story.category || 'News';
    const excerpt = story.excerpt || (story.content ? String(story.content).slice(0, 140) : '');
    const readingTime = story.reading_time ? `${story.reading_time} min read` : '';
    const author = story.author ? `By ${escapeHTML(story.author)}` : '';
    return `
      <article class="card">
        <a href="${storyHref(story)}">
          <img src="${escapeHTML(image)}" alt="${escapeHTML(imageAlt)}" loading="lazy" onerror="this.src='/logo.png'" />
        </a>
        <div class="card-content">
          <div class="category-pill">${escapeHTML(category)}</div>
          <h3 class="card-title"><a href="${storyHref(story)}">${escapeHTML(story.title || 'Untitled story')}</a></h3>
          <p class="card-excerpt">${escapeHTML(excerpt)}</p>
          <div class="meta-row">${escapeHTML([category, readingTime, author].filter(Boolean).join(' • '))}</div>
        </div>
      </article>`;
  };

  const emptyStateMarkup = (message) => `<p class="section-subtitle">${escapeHTML(message)}</p>`;

  // Server-enforced public search box (news.html): queries /api/search, which
  // only ever returns publicly visible stories, and renders results into
  // #searchResultsGrid. Falls back to the simple on-page [data-search] text
  // filter when no results container is present on the page.
  const initSearch = () => {
    const input = utils.qs('#siteSearch');
    if (!input) return;
    const resultsContainer = utils.qs('#searchResultsGrid');
    const form = utils.qs('#siteSearchForm');
    utils.on(form, 'submit', (event) => event.preventDefault());

    if (!resultsContainer) {
      const cards = utils.qsa('[data-search]');
      if (!cards.length) return;
      utils.on(input, 'input', () => {
        const query = input.value.trim().toLowerCase();
        cards.forEach(card => {
          const text = card.dataset.search.toLowerCase();
          card.style.display = text.includes(query) ? 'grid' : 'none';
        });
      });
      return;
    }

    let debounceTimer = null;
    const runSearch = async () => {
      const query = input.value.trim();
      if (!query) {
        resultsContainer.innerHTML = '';
        return;
      }
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
        if (!response.ok) throw new Error('search failed');
        const payload = await response.json();
        const results = Array.isArray(payload.results) ? payload.results : [];
        resultsContainer.innerHTML = results.length
          ? results.map(buildStoryCardMarkup).join('')
          : emptyStateMarkup(`No published stories matched "${query}".`);
      } catch (error) {
        resultsContainer.innerHTML = emptyStateMarkup('Search is temporarily unavailable. Please try again shortly.');
      }
    };
    utils.on(input, 'input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(runSearch, 250);
    });
  };

  // Populates a static category page's article grid (business.html,
  // arts.html, sports.html, community.html) with real published stories for
  // that category, reusing the existing card markup and empty-state pattern.
  const initCategoryPage = async () => {
    const container = utils.qs('#categoryArticleGrid');
    const category = container?.dataset.category;
    if (!container || !category) return;
    try {
      const response = await fetch(`/api/category/${encodeURIComponent(category)}?limit=12`);
      if (!response.ok) throw new Error('category fetch failed');
      const payload = await response.json();
      const stories = Array.isArray(payload.stories) ? payload.stories : [];
      container.innerHTML = stories.length
        ? stories.map(buildStoryCardMarkup).join('')
        : emptyStateMarkup(`No ${category} stories have been published yet. Check back soon.`);
    } catch (error) {
      container.innerHTML = emptyStateMarkup('News is temporarily unavailable. Please try again shortly.');
    }
  };

  // Populates news.html's general Latest News feed with real published stories.
  const initLatestNewsPage = async () => {
    const container = utils.qs('[data-latest-news]');
    if (!container) return;
    try {
      const response = await fetch('/api/latest-stories?limit=9');
      if (!response.ok) throw new Error('latest stories fetch failed');
      const payload = await response.json();
      const stories = Array.isArray(payload.stories) ? payload.stories : [];
      container.innerHTML = stories.length
        ? stories.map(buildStoryCardMarkup).join('')
        : emptyStateMarkup('No published stories are available yet. Check back soon.');
    } catch (error) {
      container.innerHTML = emptyStateMarkup('News is temporarily unavailable. Please try again shortly.');
    }
  };

  const buildAdMarkup = (advertisement) => {
    if (!advertisement) return '';
    const label = appointmentValue(advertisement.label || 'Advertisement');
    const title = escapeHTML(advertisement.title || 'Advertisement');
    const alt = escapeHTML(advertisement.alt_text || title || 'Advertisement');
    const image = escapeHTML(advertisement.image_url || '/logo.png');
    const clickUrl = escapeHTML(advertisement.click_url || '/');
    return `
      <aside class="advertisement-card" aria-label="Advertisement">
        <div class="advertisement-label">${label}</div>
        <a href="${clickUrl}" target="_blank" rel="noopener noreferrer" aria-label="Open advertised content: ${alt}">
          <img src="${image}" alt="${alt}" loading="lazy" decoding="async" />
        </a>
        <div class="advertisement-meta">
          <strong>${title}</strong>
          <span>${escapeHTML(advertisement.business_name || 'Local partner')}</span>
        </div>
      </aside>
    `;
  };

  const appointmentValue = (value) => String(value || 'Advertisement');

  const initAdvertisingSlots = async () => {
    const slots = utils.qsa('[data-ad-slot]');
    if (!slots.length) return;
    const queryParams = new URLSearchParams();
    const categoryNode = document.querySelector('[data-category]');
    const category = categoryNode?.dataset.category || document.body?.dataset?.category || '';
    if (category) queryParams.set('category', category);
    const municipality = document.querySelector('[data-municipality]')?.dataset.municipality || document.body?.dataset?.municipality || '';
    if (municipality) queryParams.set('municipality', municipality);
    const district = document.querySelector('[data-district]')?.dataset.district || document.body?.dataset?.district || '';
    if (district) queryParams.set('district', district);
    const town = document.querySelector('[data-town]')?.dataset.town || document.body?.dataset?.town || '';
    if (town) queryParams.set('town', town);
    const queryString = queryParams.toString() ? `?${queryParams.toString()}` : '';
    for (const slot of slots) {
      const placement = slot.dataset.adSlot;
      if (!placement) continue;
      try {
        const response = await fetch(`/api/ads/${encodeURIComponent(placement)}${queryString}`);
        if (!response.ok) throw new Error('advert fetch failed');
        const payload = await response.json();
        slot.innerHTML = payload?.advertisement ? buildAdMarkup(payload.advertisement) : '';
      } catch (error) {
        slot.innerHTML = '';
      }
    }
  };

  const initScroll = () => {
    const progress = utils.qs('.reading-progress');
    const backToTop = utils.qs('#backToTop');
    if (!progress) return;
    const onScroll = () => {
      const scroll = window.scrollY;
      const height = document.documentElement.scrollHeight - window.innerHeight;
      const percent = height > 0 ? Math.min(100, (scroll / height) * 100) : 0;
      progress.style.width = `${percent}%`;
      if (backToTop) {
        backToTop.classList.toggle('visible', scroll > 600);
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    utils.on(backToTop, 'click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
  };

  const initShare = () => {
    const buttons = utils.qsa('[data-share]');
    buttons.forEach(button => {
      utils.on(button, 'click', async () => {
        const url = button.dataset.url || window.location.href;
        const title = document.title;
        if (navigator.share) {
          try {
            await navigator.share({ title, url });
          } catch (error) {
            console.warn(error);
          }
          return;
        }
        await navigator.clipboard.writeText(url);
        button.textContent = 'Link copied';
        setTimeout(() => (button.textContent = 'Share'), 1800);
      });
    });
  };

  const fallbackStories = [];

  const categoryDefinitions = [
    {
      id: 'business',
      title: 'Business',
      description: 'Latest business, investment, entrepreneurship and economic news from across Mpumalanga.',
      icon: '💼',
      accentClass: 'business',
      href: '/business.html',
    },
    {
      id: 'arts',
      title: 'Arts',
      description: 'Culture, entertainment, music, fashion, theatre and creative stories from local communities.',
      icon: '🎨',
      accentClass: 'arts',
      href: '/arts.html',
    },
    {
      id: 'sports',
      title: 'Sports',
      description: 'Latest sporting news, tournaments, schools, clubs and community competitions.',
      icon: '🏅',
      accentClass: 'sports',
      href: '/sports.html',
    },
    {
      id: 'community',
      title: 'Community',
      description: 'Community development, public services, local events and inspiring stories from every municipality.',
      icon: '🤝',
      accentClass: 'community',
      href: '/community.html',
    },
  ];

  const normalizeCategory = (category = '') => String(category || '').trim().toLowerCase();

  const isPublishedStory = (story) => {
    const status = String(story?.status || story?.publicationStatus || '').trim().toLowerCase();
    if (['draft', 'pending', 'unpublished'].includes(status)) return false;
    if (story?.published === false || story?.published === 0) return false;
    return Boolean(story?.title && (story?.content || story?.excerpt || story?.featured_image));
  };

  const normalizeStory = (story, fallbackIndex = 0) => ({
    title: story.title || `Local update ${fallbackIndex + 1}`,
    excerpt: story.excerpt || story.content?.slice(0, 140) || 'A concise update from the newsroom.',
    category: story.category || 'News',
    author: story.author || 'Mpumalanga Local Time',
    date: story.submittedAt ? new Date(story.submittedAt).toLocaleDateString('en-ZA', { month: 'short', day: 'numeric' }) : 'Today',
    readingTime: story.reading_time || 4,
    image: story.featured_image || '/logo.png',
    views: Number(story.views || 0),
    comments: Number(story.comments || 0),
    id: story.id || fallbackIndex + 1,
  });

  let heroStoryIds = [];
  let latestStoriesCache = { data: null, timestamp: 0 };
  let latestStoriesPromise = null;
  let breakingNewsCache = { data: null, timestamp: 0 };
  let breakingNewsPromise = null;
  let categoryRefreshTimer = null;

  const formatRelativeTime = (value) => {
    const parsed = value ? new Date(value) : null;
    if (!parsed || Number.isNaN(parsed.getTime())) return 'just now';

    const diffSeconds = Math.floor((Date.now() - parsed.getTime()) / 1000);
    const units = [
      [31536000, 'year'],
      [2592000, 'month'],
      [86400, 'day'],
      [3600, 'hour'],
      [60, 'minute'],
    ];

    for (const [seconds, unit] of units) {
      const amount = Math.floor(diffSeconds / seconds);
      if (amount >= 1) return `${amount} ${unit}${amount === 1 ? '' : 's'} ago`;
    }

    return 'just now';
  };

  const fallbackBreakingStories = [];
  const fetchLatestStories = async () => {
    const now = Date.now();
    if (latestStoriesCache.data && now - latestStoriesCache.timestamp < 60000) {
      return latestStoriesCache.data;
    }

    if (latestStoriesPromise) {
      return latestStoriesPromise;
    }

    latestStoriesPromise = fetch('/api/latest-stories?limit=20')
      .then(async (response) => {
        const payload = await response.json();
        const stories = Array.isArray(payload.stories) && payload.stories.length ? payload.stories : fallbackStories;
        latestStoriesCache = { data: stories, timestamp: Date.now() };
        return stories;
      })
      .catch(() => fallbackStories)
      .finally(() => {
        latestStoriesPromise = null;
      });

    return latestStoriesPromise;
  };

  const renderBreakingNews = async () => {
    const container = utils.qs('#breakingNewsTrack');
    const marquee = utils.qs('.breaking-marquee');
    if (!container || !marquee) return;

    const buildMarkup = (stories) => {
      const featured = stories[0] || fallbackBreakingStories[0];
      const rest = stories.slice(1);
      const featuredMarkup = `
        <a class="breaking-news-feature" href="${storyHref(featured)}" aria-label="${escapeHTML(featured.title)} ${escapeHTML(featured.category)} ${escapeHTML(formatRelativeTime(featured.submittedAt))}">
          <span class="breaking-news-feature-label">LATEST</span>
          <span class="breaking-news-feature-title">${escapeHTML(featured.title)}</span>
          <span class="breaking-news-feature-meta">${escapeHTML(featured.category)} • ${escapeHTML(formatRelativeTime(featured.submittedAt))}</span>
        </a>`;
      const secondaryMarkup = rest.length ? rest.map((story) => `
        <a class="breaking-news-link" href="${storyHref(story)}" aria-label="${escapeHTML(story.title)} ${escapeHTML(story.category)} ${escapeHTML(formatRelativeTime(story.submittedAt))}">
          <span class="breaking-news-title">${escapeHTML(story.title)}</span>
          <span class="breaking-news-meta">${escapeHTML(story.category)} • ${escapeHTML(formatRelativeTime(story.submittedAt))}</span>
        </a>
      `).join('<span class="breaking-news-separator" aria-hidden="true">•</span>') : '';

      return `<div class="breaking-news-group">${featuredMarkup}${secondaryMarkup ? `<span class="breaking-news-divider" aria-hidden="true"></span>${secondaryMarkup}` : ''}</div><div class="breaking-news-group" aria-hidden="true">${featuredMarkup}${secondaryMarkup ? `<span class="breaking-news-divider" aria-hidden="true"></span>${secondaryMarkup}` : ''}</div>`;
    };

    const now = Date.now();
    if (breakingNewsCache.data && now - breakingNewsCache.timestamp < 60000) {
      container.innerHTML = buildMarkup(breakingNewsCache.data);
      return;
    }

    if (breakingNewsPromise) return breakingNewsPromise;

    breakingNewsPromise = fetch('/api/latest-stories?limit=10')
      .then(async (response) => {
        const payload = await response.json();
        const stories = Array.isArray(payload.stories) && payload.stories.length ? payload.stories : fallbackBreakingStories;
        breakingNewsCache = { data: stories, timestamp: Date.now() };
        return stories;
      })
      .catch(() => fallbackBreakingStories)
      .finally(() => {
        breakingNewsPromise = null;
      });

    const stories = await breakingNewsPromise;
    if (!Array.isArray(stories) || stories.length === 0) {
      marquee.style.display = 'none';
      container.innerHTML = '';
      return;
    }

    marquee.style.display = '';
    container.innerHTML = buildMarkup(stories);

    const pauseMarquee = () => marquee.classList.add('is-paused');
    const resumeMarquee = () => marquee.classList.remove('is-paused');

    marquee.onmouseenter = pauseMarquee;
    marquee.onmouseleave = resumeMarquee;
    marquee.onfocusin = pauseMarquee;
    marquee.onfocusout = resumeMarquee;
  };

  const buildLatestUpdatesMarkup = (stories = []) => {
    const list = Array.isArray(stories) ? stories : [];
    const cards = list
      .filter(isPublishedStory)
      .slice(0, 5)
      .map((story, index) => {
        const normalizedStory = normalizeStory(story, index);
        return `
          <a class="latest-update-card latest-update-card--text" href="${storyHref(normalizedStory)}" aria-label="${escapeHTML(normalizedStory.title)}">
            <div class="latest-update-card-body">
              <span class="latest-update-badge">${escapeHTML(normalizedStory.category)}</span>
              <h3>${escapeHTML(normalizedStory.title)}</h3>
              <div class="latest-update-meta">
                <span>${escapeHTML(normalizedStory.date)}</span>
                <span>•</span>
                <span>${normalizedStory.readingTime} min read</span>
              </div>
            </div>
          </a>`;
      })
      .join('');

    return cards || '<p class="section-subtitle">No updates available right now.</p>';
  };

  const renderLatestUpdates = async (excludedIds = []) => {
    const container = utils.qs('#latestUpdatesList');
    if (!container) return;

    const stories = await fetchLatestStories();
    const visibleStories = (stories || [])
      .filter(isPublishedStory)
      .filter((story) => !(excludedIds.includes(story.id) || heroStoryIds.includes(story.id)));

    container.innerHTML = buildLatestUpdatesMarkup(visibleStories.length ? visibleStories : fallbackStories);
  };

  const initHeroSlider = async () => {
    const container = utils.qs('#heroSlides');
    if (!container) return [];

    try {
      const latestRes = await fetch('/api/latest-stories?limit=9');
      const latestData = await latestRes.json();

      const stories = (latestData.stories || [])
        .filter(isPublishedStory)
        .slice(0, 9)
        .map((story, index) => normalizeStory(story, index));

      if (!stories.length) {
        container.innerHTML =
          '<div class="hero-grid-empty">No stories available right now.</div>';
        return [];
      }

      // Latest five rotate in the large left panel.
      const sliderStories = stories.slice(0, 5);

      // Four additional stories remain fixed on the right.
      const sideStories = stories.slice(5, 9);

      // If fewer than nine stories are available, reuse remaining latest
      // stories so the four-card layout stays complete.
      while (sideStories.length < 4 && stories.length > 1) {
        const candidate = stories[(5 + sideStories.length) % stories.length];
        if (candidate) sideStories.push(candidate);
        else break;
      }

      heroStoryIds = stories.map(story => story.id);

      const storyUrl = (story) =>
        `/story/${encodeURIComponent(story.slug || story.id || '')}`;

      const renderSideCards = () => sideStories.map(story => `
        <a class="hero-grid-card"
           href="${storyUrl(story)}"
           style="background-image:url('${story.image}')">
          <div class="hero-grid-overlay"></div>
          <div class="hero-grid-content">
            <h2>${escapeHTML(story.title)}</h2>
            <div class="hero-grid-meta">
              <span>${escapeHTML(story.date)}</span>
            </div>
          </div>
        </a>
      `).join('');

      container.innerHTML = `
        <div id="heroLeadSlider" class="hero-lead-slider"></div>
        <div class="hero-grid-secondary">
          ${renderSideCards()}
        </div>
      `;

      const leadContainer = utils.qs('#heroLeadSlider');
      let current = 0;

      const renderLead = () => {
        const story = sliderStories[current];

        leadContainer.innerHTML = `
          <a class="hero-grid-lead hero-grid-lead-slide"
             href="${storyUrl(story)}"
             style="background-image:url('${story.image}')">
            <div class="hero-grid-overlay"></div>
            <div class="hero-grid-content">
              <h1>${escapeHTML(story.title)}</h1>
              <div class="hero-grid-meta">
                <span>${escapeHTML(story.date)}</span>
                <span>•</span>
                <span>${escapeHTML(story.author)}</span>
              </div>
            </div>
          </a>
        `;
      };

      renderLead();

      if (sliderStories.length > 1) {
        setInterval(() => {
          current = (current + 1) % sliderStories.length;
          renderLead();
        }, 2000);
      }

      return heroStoryIds;

    } catch (error) {
      console.error('Error loading hero stories:', error);
      container.innerHTML =
        '<div class="hero-grid-empty">Latest stories are temporarily unavailable.</div>';
      return [];
    }
  };

  const getCategoryStories = (stories, categoryId, excludedIds = []) => {
    const filteredStories = (stories || [])
      .filter(isPublishedStory)
      .filter((story) => !(excludedIds.includes(story.id) || heroStoryIds.includes(story.id)))
      .filter((story) => normalizeCategory(story.category) === categoryId);

    const categoryStories = filteredStories.slice(0, 4).map((story, index) => normalizeStory(story, index));
    if (categoryStories.length) return categoryStories;

    const fallbackCategoryStories = fallbackStories
      .filter((story) => normalizeCategory(story.category) === categoryId)
      .slice(0, 4)
      .map((story, index) => normalizeStory(story, index));

    return fallbackCategoryStories;
  };

  const renderCategorySections = async (excludedIds = []) => {
    const container = utils.qs('#categoryNewsGrid');
    if (!container) return;

    const rawStories = await fetchLatestStories();

    const stories = rawStories
      .filter(isPublishedStory)
      .map((story, index) => ({
        ...normalizeStory(story, index),
        slug: story.slug || '',
      }));

    if (!stories.length) {
      container.innerHTML =
        '<p class="daily-brief-empty">No additional stories are available right now.</p>';
      return;
    }

    const newsStories = stories
      .filter((story) => normalizeCategory(story.category) === 'news')
      .slice(0, 5);

    // If there are not enough stories explicitly categorised as News,
    // fill the main news area with the latest published stories.
    const mainStories = [...newsStories];

    for (const story of stories) {
      if (mainStories.length >= 5) break;
      if (!mainStories.some((item) => item.id === story.id)) {
        mainStories.push(story);
      }
    }

    const featured = mainStories[0] || null;
    const supporting = mainStories.slice(1, 5);

    const categoryCards = categoryDefinitions.map((category) => {
      const story = stories.find(
        (item) => normalizeCategory(item.category) === category.id
      );

      if (!story) return '';

      return `
        <a class="daily-category-card"
           href="${storyHref(story)}"
           aria-label="${escapeHTML(story.title)}">
          <div class="daily-category-image">
            <img src="${story.image}"
                 alt="${escapeHTML(story.title)}"
                 loading="lazy"
                 decoding="async">
          </div>

          <div class="daily-category-copy">
            <span class="daily-category-label">${escapeHTML(category.title)}</span>
            <h3>${escapeHTML(story.title)}</h3>
            <span class="daily-category-date">${escapeHTML(story.date)}</span>
          </div>
        </a>
      `;
    }).join('');

    container.innerHTML = `
      <div class="daily-brief-layout">

        <section class="daily-news-column" aria-label="Latest news">
          <div class="daily-section-heading">
            <h2>News</h2>
            <a href="/news.html">View all</a>
          </div>

          ${featured ? `
            <a class="daily-feature-story"
               href="${storyHref(featured)}"
               aria-label="${escapeHTML(featured.title)}">

              <img src="${featured.image}"
                   alt="${escapeHTML(featured.title)}"
                   loading="lazy"
                   decoding="async">

              <div class="daily-feature-copy">
                <span class="daily-category-label">${escapeHTML(featured.category)}</span>
                <h3>${escapeHTML(featured.title)}</h3>
                <p>${escapeHTML(featured.excerpt)}</p>
                <div class="daily-story-meta">
                  <span>${escapeHTML(featured.date)}</span>
                  <span>By ${escapeHTML(featured.author)}</span>
                </div>
              </div>
            </a>
          ` : ''}

          <div class="daily-news-list">
            ${supporting.map((story) => `
              <a class="daily-news-item"
                 href="${storyHref(story)}"
                 aria-label="${escapeHTML(story.title)}">

                <img src="${story.image}"
                     alt="${escapeHTML(story.title)}"
                     loading="lazy"
                     decoding="async">

                <div>
                  <span class="daily-category-label">${escapeHTML(story.category)}</span>
                  <h3>${escapeHTML(story.title)}</h3>
                  <span class="daily-category-date">${escapeHTML(story.date)}</span>
                </div>
              </a>
            `).join('')}
          </div>
        </section>

        <aside class="daily-category-column" aria-label="Latest by category">
          <div class="daily-section-heading">
            <h2>Latest by Category</h2>
          </div>

          <div class="daily-category-list">
            ${categoryCards}
          </div>
        </aside>

      </div>
    `;

    const extraContainer = utils.qs('#homepageCategorySections');

    if (extraContainer) {
      const homepageCategories = [
        { id: 'news', title: 'News', href: '/news.html' },
        { id: 'business', title: 'Business', href: '/business.html' },
        { id: 'arts', title: 'Arts', href: '/arts.html' },
        { id: 'sports', title: 'Sports', href: '/sports.html' },
        { id: 'community', title: 'Community', href: '/community.html' },
      ];

      const categorySections = homepageCategories.map((category) => {
        const categoryStories = stories
          .filter((story) => normalizeCategory(story.category) === category.id)
          .slice(0, 4);

        if (!categoryStories.length) return '';

        const lead = categoryStories[0];
        const supportingStories = categoryStories.slice(1);

        return `
          <section class="homepage-category-block" aria-label="${escapeHTML(category.title)}">
            <div class="daily-section-heading">
              <h2>${escapeHTML(category.title)}</h2>
              <a href="${category.href}">View all</a>
            </div>

            <div class="homepage-category-layout">
              <a class="daily-feature-story homepage-category-feature"
                 href="${storyHref(lead)}"
                 aria-label="${escapeHTML(lead.title)}">

                <img src="${lead.image}"
                     alt="${escapeHTML(lead.title)}"
                     loading="lazy"
                     decoding="async">

                <div class="daily-feature-copy">
                  <span class="daily-category-label">${escapeHTML(category.title)}</span>
                  <h3>${escapeHTML(lead.title)}</h3>
                  <p>${escapeHTML(lead.excerpt)}</p>

                  <div class="daily-story-meta">
                    <span>${escapeHTML(lead.date)}</span>
                    <span>By ${escapeHTML(lead.author)}</span>
                  </div>
                </div>
              </a>

              <div class="daily-news-list homepage-category-list">
                ${supportingStories.map((story) => `
                  <a class="daily-news-item"
                     href="${storyHref(story)}"
                     aria-label="${escapeHTML(story.title)}">

                    <img src="${story.image}"
                         alt="${escapeHTML(story.title)}"
                         loading="lazy"
                         decoding="async">

                    <div>
                      <span class="daily-category-label">${escapeHTML(category.title)}</span>
                      <h3>${escapeHTML(story.title)}</h3>
                      <span class="daily-category-date">${escapeHTML(story.date)} • By ${escapeHTML(story.author)}</span>
                    </div>
                  </a>
                `).join('')}
              </div>
            </div>
          </section>
        `;
      }).join('');

      extraContainer.innerHTML = categorySections;
    }

    initShare();
  };

  const renderWeatherWidget = async () => {
    const container = utils.qs('#weatherWidgetPanel');
    if (!container) return;

    try {
      const response = await fetch('/api/weather/mbombela');
      const payload = await response.json();
      const weather = payload.weather || {};
      container.innerHTML = `
        <div class="card-content">
          <h3>Weather</h3>
          <p class="section-subtitle">Live conditions for Mpumalanga municipalities.</p>
          <div style="display:grid; gap:8px;">
            <div style="font-size:1.5rem; font-weight:700;">${escapeHTML(weather.temperature || '22°C')}</div>
            <div>${escapeHTML(weather.condition || 'Sunny')}</div>
            <div>Humidity: ${escapeHTML(weather.humidity || '54%')}</div>
            <div>Wind: ${escapeHTML(weather.wind_speed || '14 km/h')}</div>
            <div>Sunrise: ${escapeHTML(weather.sunrise || '06:20')} • Sunset: ${escapeHTML(weather.sunset || '17:40')}</div>
            <div>Rain: ${escapeHTML(weather.rain_probability || '10%')}</div>
            <div class="meta">${escapeHTML(weather.forecast || 'Clear skies and mild winds')}</div>
          </div>
        </div>`;
    } catch (error) {
      container.innerHTML = '<div class="card-content"><h3>Weather</h3><p class="section-subtitle">Weather data is temporarily unavailable.</p></div>';
    }
  };

  const initEngagementForms = () => {
    const newsletterForm = utils.qs('#newsletterForm');
    const newsletterMessage = utils.qs('#newsletterMessage');
    const pushPrefsForm = utils.qs('#pushPrefsForm');
    const pushPrefsMessage = utils.qs('#pushPrefsMessage');

    if (newsletterForm && newsletterMessage) {
      utils.on(newsletterForm, 'submit', async (event) => {
        event.preventDefault();
        const formData = new FormData(newsletterForm);
        const payload = {
          name: formData.get('name') || '',
          surname: formData.get('surname') || '',
          email: formData.get('email') || '',
          province: 'Mpumalanga',
          preferences: ['Breaking News Alerts'],
          frequency: 'weekly',
        };

        try {
          const response = await fetch('/api/newsletter/subscribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          const data = await response.json();
          newsletterMessage.textContent = response.ok ? `Subscribed ${data.subscriber?.email || 'successfully'}.` : data.error || 'Subscription failed';
        } catch (error) {
          newsletterMessage.textContent = 'Subscription failed';
        }
      });
    }

    if (pushPrefsForm && pushPrefsMessage) {
      utils.on(pushPrefsForm, 'submit', async (event) => {
        event.preventDefault();
        const formData = new FormData(pushPrefsForm);
        const payload = {
          province: formData.get('province') || 'Mpumalanga',
          categories: String(formData.get('categories') || '').split(',').map((item) => item.trim()).filter(Boolean),
          enabled: formData.get('enabled') === 'on',
        };

        try {
          const token = localStorage.getItem('token') || '';
          const response = await fetch('/api/push/preferences', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: token ? `Bearer ${token}` : '',
            },
            body: JSON.stringify(payload),
          });
          const data = await response.json();
          pushPrefsMessage.textContent = response.ok ? 'Notifications preferences saved.' : data.error || 'Preferences failed';
        } catch (error) {
          pushPrefsMessage.textContent = 'Preferences failed';
        }
      });
    }
  };

  const init = async () => {
    initMenu();
    initHeader();
    initDarkMode();
    initSearch();
    initScroll();
    initShare();
    initEngagementForms();
    await renderBreakingNews();
    await renderWeatherWidget();
    const heroIds = await initHeroSlider();
    heroStoryIds = heroIds || [];
    await renderLatestUpdates(heroStoryIds);
    await renderCategorySections(heroStoryIds);
    await initCategoryPage();
    await initLatestNewsPage();
    await initAdvertisingSlots();
    window.clearInterval(categoryRefreshTimer);
    categoryRefreshTimer = window.setInterval(() => {
      renderCategorySections(heroStoryIds);
    }, 60000);
  };

  return { init, buildLatestUpdatesMarkup };
})();

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', app.init);
}

module.exports = app;