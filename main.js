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

  const initMenu = () => {
    const button = utils.qs('.nav-toggle');
    const nav = utils.qs('.nav-primary');
    utils.on(button, 'click', () => {
      const expanded = button.getAttribute('aria-expanded') === 'true';
      button.setAttribute('aria-expanded', String(!expanded));
      nav.classList.toggle('nav-open');
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

  const initSearch = () => {
    const input = utils.qs('#siteSearch');
    const cards = utils.qsa('[data-search]');
    if (!input || !cards.length) return;
    utils.on(input, 'input', () => {
      const query = input.value.trim().toLowerCase();
      cards.forEach(card => {
        const text = card.dataset.search.toLowerCase();
        card.style.display = text.includes(query) ? 'grid' : 'none';
      });
    });
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

  const fallbackStories = [
    {
      title: 'Mpumalanga business leaders back new growth corridor',
      excerpt: 'New investment and logistics partnerships are raising expectations for entrepreneurs across the Lowveld.',
      category: 'Business',
      author: 'Sipho Dlamini',
      submittedAt: '2026-07-18T08:30:00Z',
      reading_time: 4,
      featured_image: 'https://images.unsplash.com/photo-1520607162513-77705c0f0d4a?auto=format&fit=crop&w=1600&q=80',
    },
    {
      title: 'Local arts collective brings a new theatre season to life',
      excerpt: 'Creative talent from across the province is turning community spaces into vibrant cultural destinations.',
      category: 'Arts',
      author: 'Ayanda Mbatha',
      submittedAt: '2026-07-16T10:00:00Z',
      reading_time: 3,
      featured_image: 'https://images.unsplash.com/photo-1499364615650-ec38552f4f34?auto=format&fit=crop&w=1600&q=80',
    },
    {
      title: 'Rugby and school sport programmes gain momentum',
      excerpt: 'Fresh competition and coaching support are helping schools and clubs build stronger community pride.',
      category: 'Sports',
      author: 'Lungisani Ndlovu',
      submittedAt: '2026-07-15T14:00:00Z',
      reading_time: 2,
      featured_image: 'https://images.unsplash.com/photo-1517649763962-0c623066013b?auto=format&fit=crop&w=1600&q=80',
    },
    {
      title: 'Community centre expands youth mentorship and food relief',
      excerpt: 'Volunteers and local leaders are strengthening support networks for families across the municipality.',
      category: 'Community',
      author: 'Nokuthula Mkhize',
      submittedAt: '2026-07-14T12:00:00Z',
      reading_time: 4,
      featured_image: 'https://images.unsplash.com/photo-1529156069898-49953e39b3ac?auto=format&fit=crop&w=1600&q=80',
    },
  ];

  const categoryDefinitions = [
    {
      id: 'business',
      title: 'Business',
      description: 'Latest business, investment, entrepreneurship and economic news from across Mpumalanga.',
      icon: '💼',
      accentClass: 'business',
      href: '/news.html?category=business',
    },
    {
      id: 'arts',
      title: 'Arts',
      description: 'Culture, entertainment, music, fashion, theatre and creative stories from local communities.',
      icon: '🎨',
      accentClass: 'arts',
      href: '/news.html?category=arts',
    },
    {
      id: 'sports',
      title: 'Sports',
      description: 'Latest sporting news, tournaments, schools, clubs and community competitions.',
      icon: '🏅',
      accentClass: 'sports',
      href: '/news.html?category=sports',
    },
    {
      id: 'community',
      title: 'Community',
      description: 'Community development, public services, local events and inspiring stories from every municipality.',
      icon: '🤝',
      accentClass: 'community',
      href: '/news.html?category=community',
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

  const fallbackBreakingStories = [
    {
      title: 'Public hearings continue as residents press for stronger service delivery',
      category: 'Community',
      submittedAt: new Date(Date.now() - 10 * 60000).toISOString(),
    },
    {
      title: 'Housing projects receive fresh provincial funding support',
      category: 'Business',
      submittedAt: new Date(Date.now() - 22 * 60000).toISOString(),
    },
    {
      title: 'Road upgrades continue across municipalities as travel improves',
      category: 'Infrastructure',
      submittedAt: new Date(Date.now() - 60 * 60000).toISOString(),
    },
    {
      title: 'Education department launches digital learning initiative',
      category: 'Education',
      submittedAt: new Date(Date.now() - 90 * 60000).toISOString(),
    },
  ];

  const fetchLatestStories = async () => {
    const now = Date.now();
    if (latestStoriesCache.data && now - latestStoriesCache.timestamp < 60000) {
      return latestStoriesCache.data;
    }

    if (latestStoriesPromise) {
      return latestStoriesPromise;
    }

    latestStoriesPromise = fetch('/api/latest-stories')
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
        <a class="breaking-news-feature" href="/news.html?story=${featured.id || featured.title}" aria-label="${escapeHTML(featured.title)} ${escapeHTML(featured.category)} ${escapeHTML(formatRelativeTime(featured.submittedAt))}">
          <span class="breaking-news-feature-label">LIVE</span>
          <span class="breaking-news-feature-title">${escapeHTML(featured.title)}</span>
          <span class="breaking-news-feature-meta">${escapeHTML(featured.category)} • ${escapeHTML(formatRelativeTime(featured.submittedAt))}</span>
        </a>`;
      const secondaryMarkup = rest.length ? rest.map((story) => `
        <a class="breaking-news-link" href="/news.html?story=${story.id || story.title}" aria-label="${escapeHTML(story.title)} ${escapeHTML(story.category)} ${escapeHTML(formatRelativeTime(story.submittedAt))}">
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

    breakingNewsPromise = fetch('/api/breaking-news')
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
          <a class="latest-update-card latest-update-card--text" href="/news.html?story=${normalizedStory.id}" aria-label="${escapeHTML(normalizedStory.title)}">
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
    const dots = utils.qs('#heroDots');
    if (!container) return [];

    try {
      const latestRes = await fetch('/api/latest-stories?limit=4');
      const latestData = await latestRes.json();
      const stories = latestData.stories?.length ? latestData.stories : fallbackStories;
      const slides = stories.slice(0, 4).map((story, index) => normalizeStory(story, index));
      heroStoryIds = slides.map(slide => slide.id);

      if (!slides.length) {
        container.innerHTML = '<div class="hero-slide"><div class="hero-slide-content"><p class="section-kicker">Latest news</p><h2>Local reporting continues to grow.</h2></div></div>';
        return [];
      }

      let index = 0;
      const render = () => {
        const slide = slides[index];
        const total = slides.length;
        container.innerHTML = `
          <article class="hero-slide" style="background-image:url('${slide.image}')">
            <div class="hero-slide-content">
              <div class="hero-slide-top">
                <p class="section-kicker">Latest news</p>
                <span class="hero-slide-counter">${index + 1}/${total}</span>
              </div>
              <p class="hero-slide-category">${escapeHTML(slide.category)}</p>
              <h2>${escapeHTML(slide.title)}</h2>
              <p>${escapeHTML(slide.excerpt)}</p>
              <div class="hero-slide-meta">
                <span>By ${escapeHTML(slide.author)}</span>
                <span>•</span>
                <span>${escapeHTML(slide.date)}</span>
                <span>•</span>
                <span>${slide.readingTime} min read</span>
              </div>
            </div>
          </article>`;
        dots.innerHTML = slides.map((_, i) => `<button type="button" class="${i === index ? 'active' : ''}" data-index="${i}" aria-label="Go to slide ${i + 1}"></button>`).join('');
      };

      const onNav = (direction) => {
        index = (index + direction + slides.length) % slides.length;
        render();
      };

      render();
      utils.qsa('.hero-nav').forEach(button => utils.on(button, 'click', () => onNav(Number(button.dataset.direction))));
      utils.qsa('.hero-dots button').forEach(button => utils.on(button, 'click', () => {
        index = Number(button.dataset.index);
        render();
      }));
      setInterval(() => onNav(1), 7000);
      return slides.map(slide => slide.id);
    } catch (error) {
      console.error('Error loading hero slider:', error);
      const slides = fallbackStories.slice(0, 4).map((story, index) => normalizeStory(story, index));
      container.innerHTML = `
        <article class="hero-slide" style="background-image:url('${slides[0].image}')">
          <div class="hero-slide-content">
            <div class="hero-slide-top">
              <p class="section-kicker">Latest news</p>
              <span class="hero-slide-counter">1/${slides.length}</span>
            </div>
            <p class="hero-slide-category">${escapeHTML(slides[0].category)}</p>
            <h2>${escapeHTML(slides[0].title)}</h2>
            <p>${escapeHTML(slides[0].excerpt)}</p>
          </div>
        </article>`;
    }
    return [];
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

    const stories = await fetchLatestStories();
    const markup = categoryDefinitions.map((category) => {
      const categoryStories = getCategoryStories(stories, category.id, excludedIds);
      return `
        <article class="category-panel ${category.accentClass}" aria-labelledby="${category.id}-title">
          <div class="category-panel-head">
            <div class="category-panel-heading">
              <span class="category-icon" aria-hidden="true">${category.icon}</span>
              <div>
                <h3 id="${category.id}-title" class="category-panel-title">${escapeHTML(category.title)}</h3>
                <p class="category-panel-description">${escapeHTML(category.description)}</p>
              </div>
            </div>
            <a class="view-all-link" href="${category.href}">View All →</a>
          </div>
          <div class="category-panel-stories">
            ${categoryStories.map((story) => `
              <article class="premium-story-card" data-search="${escapeHTML(story.title)} ${escapeHTML(story.category)}">
                <img src="${story.image}" alt="${escapeHTML(story.title)}" loading="lazy" decoding="async" sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 25vw">
                <div class="premium-story-card-body">
                  <div class="premium-topline">
                    <span class="premium-badge">${escapeHTML(story.category)}</span>
                    <span class="premium-meta">${escapeHTML(story.date)}</span>
                  </div>
                  <h4>${escapeHTML(story.title)}</h4>
                  <p>${escapeHTML(story.excerpt)}</p>
                  <div class="premium-story-footer">
                    <div class="premium-story-details">
                      <span>By ${escapeHTML(story.author)}</span>
                      <span>${story.readingTime} min</span>
                      <span>${story.views || 0} views</span>
                      <span>${story.comments || 0} comments</span>
                    </div>
                    <div class="premium-story-actions">
                      <button class="action-chip" type="button" data-share aria-label="Share ${escapeHTML(story.title)}" data-url="${window.location.href}">↗</button>
                      <button class="action-chip" type="button" aria-label="Bookmark ${escapeHTML(story.title)}">🔖</button>
                      <a class="read-more-link" href="/story/${story.id}">Read more</a>
                    </div>
                  </div>
                </div>
              </article>
            `).join('')}
          </div>
        </article>
      `;
    }).join('');

    container.innerHTML = markup;
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