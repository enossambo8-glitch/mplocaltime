const MUNICIPALITIES = [
  {
    name: 'Mbombela',
    slug: 'mbombela',
    district: 'Ehlanzeni District Municipality',
    localMunicipality: 'Mbombela Local Municipality',
    population: '1.1M',
    area: '2,626 km²',
    heroImage: 'https://images.unsplash.com/photo-1518391846015-55a9cc003b25?auto=format&fit=crop&w=1600&q=80',
    logo: '/logo.png',
    description: 'Mbombela delivers the latest municipal news, development updates, council decisions and community stories from the Lowveld.',
    mayor: 'Cllr. Sibongile Makhubele',
    municipalManager: 'Mr. Sibusiso Mkhatshwa',
    officialWebsite: 'https://www.mbombela.gov.za',
    localTourism: 'Kruger National Park, Sudwala Caves, Lowveld Botanical Garden',
    emergencyContacts: ['Police: 10111', 'Ambulance: 10177', 'Municipal Hotline: 013 790 1111'],
    serviceDeliveryNumbers: ['Water and Sanitation: 013 790 1222', 'Electricity: 013 790 1333', 'Waste: 013 790 1444'],
    latestUpdate: '2026-07-30T08:00:00Z',
    weather: 'Sunny • 22°C',
    tags: ['Lowveld', 'Economic growth', 'Service delivery']
  },
  {
    name: 'Bushbuckridge',
    slug: 'bushbuckridge',
    district: 'Ehlanzeni District Municipality',
    localMunicipality: 'Bushbuckridge Local Municipality',
    population: '543k',
    area: '2,392 km²',
    heroImage: 'https://images.unsplash.com/photo-1500534623283-312aade485b7?auto=format&fit=crop&w=1600&q=80',
    logo: '/logo.png',
    description: 'Bushbuckridge news covers roads, youth initiatives, tourism, social upliftment and local governance.',
    mayor: 'Cllr. H. M. Nkuna',
    municipalManager: 'Mr. S. M. Baloyi',
    officialWebsite: 'https://www.bushbuckridge.gov.za',
    localTourism: 'Manyeleti Game Reserve, Blyde River Canyon, local craft markets',
    emergencyContacts: ['Police: 10111', 'Ambulance: 10177', 'Municipal Hotline: 013 799 1000'],
    serviceDeliveryNumbers: ['Water and Sanitation: 013 799 1001', 'Roads: 013 799 1002', 'Community Services: 013 799 1003'],
    latestUpdate: '2026-07-29T12:30:00Z',
    weather: 'Partly cloudy • 19°C',
    tags: ['Rural development', 'Tourism', 'Youth']
  },
  {
    name: 'Nkomazi',
    slug: 'nkomazi',
    district: 'Ehlanzeni District Municipality',
    localMunicipality: 'Nkomazi Local Municipality',
    population: '398k',
    area: '1,875 km²',
    heroImage: 'https://images.unsplash.com/photo-1480714378408-67cf0d13bc1b?auto=format&fit=crop&w=1600&q=80',
    logo: '/logo.png',
    description: 'Nkomazi stories spotlight border trade, jobs, schools, health access and community growth.',
    mayor: 'Cllr. J. M. Mabuza',
    municipalManager: 'Mr. T. P. Mthimunye',
    officialWebsite: 'https://www.nkomazi.gov.za',
    localTourism: 'Komatipoort, border tourism, riverfront attractions',
    emergencyContacts: ['Police: 10111', 'Ambulance: 10177', 'Municipal Hotline: 013 790 2222'],
    serviceDeliveryNumbers: ['Billing: 013 790 2223', 'Housing: 013 790 2224', 'Planning: 013 790 2225'],
    latestUpdate: '2026-07-28T09:00:00Z',
    weather: 'Warm • 24°C',
    tags: ['Border economy', 'Transport', 'Development']
  },
  {
    name: 'Thaba Chweu',
    slug: 'thaba-chweu',
    district: 'Ehlanzeni District Municipality',
    localMunicipality: 'Thaba Chweu Local Municipality',
    population: '130k',
    area: '1,586 km²',
    heroImage: 'https://images.unsplash.com/photo-1499856871958-5b9627545d1a?auto=format&fit=crop&w=1600&q=80',
    logo: '/logo.png',
    description: 'Thaba Chweu brings readers local governance news, mountain tourism developments and seasonal community events.',
    mayor: 'Cllr. T. B. Mokoena',
    municipalManager: 'Mr. L. M. Rikhotso',
    officialWebsite: 'https://www.thabachweu.gov.za',
    localTourism: 'Sabie, Graskop, Blydepoort',
    emergencyContacts: ['Police: 10111', 'Ambulance: 10177', 'Municipal Hotline: 013 764 8000'],
    serviceDeliveryNumbers: ['Roads: 013 764 8001', 'Water: 013 764 8002', 'Fire: 013 764 8003'],
    latestUpdate: '2026-07-27T16:45:00Z',
    weather: 'Cool • 16°C',
    tags: ['Tourism', 'Winter events', 'Conservation']
  },
  {
    name: 'Mkhondo',
    slug: 'mkhondo',
    district: 'Gert Sibande District Municipality',
    localMunicipality: 'Mkhondo Local Municipality',
    population: '197k',
    area: '3,328 km²',
    heroImage: 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?auto=format&fit=crop&w=1600&q=80',
    logo: '/logo.png',
    description: 'Mkhondo news follows agricultural growth, infrastructure investment and community programmes across the municipality.',
    mayor: 'Cllr. S. J. Mkhabela',
    municipalManager: 'Mr. D. M. Radebe',
    officialWebsite: 'https://www.mkhondo.gov.za',
    localTourism: 'Piet Retief, farms, river routes',
    emergencyContacts: ['Police: 10111', 'Ambulance: 10177', 'Municipal Hotline: 017 883 2000'],
    serviceDeliveryNumbers: ['Agriculture support: 017 883 2001', 'Housing: 017 883 2002', 'Community services: 017 883 2003'],
    latestUpdate: '2026-07-26T10:15:00Z',
    weather: 'Clear • 20°C',
    tags: ['Agriculture', 'Infrastructure', 'Rural services']
  },
  {
    name: 'Steve Tshwete',
    slug: 'steve-tshwete',
    district: 'Nkangala District Municipality',
    localMunicipality: 'Steve Tshwete Local Municipality',
    population: '240k',
    area: '3,830 km²',
    heroImage: 'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1600&q=80',
    logo: '/logo.png',
    description: 'Steve Tshwete delivers reporting on investment, industrial growth, transport and civic developments.',
    mayor: 'Cllr. N. M. Maseko',
    municipalManager: 'Mr. M. P. Maseko',
    officialWebsite: 'https://www.stevetshwete.gov.za',
    localTourism: 'Middelburg, Witbank, game reserves',
    emergencyContacts: ['Police: 10111', 'Ambulance: 10177', 'Municipal Hotline: 013 243 1000'],
    serviceDeliveryNumbers: ['Energy: 013 243 1001', 'Town planning: 013 243 1002', 'Waste management: 013 243 1003'],
    latestUpdate: '2026-07-25T13:20:00Z',
    weather: 'Windy • 18°C',
    tags: ['Industry', 'Infrastructure', 'Investment']
  },
  {
    name: 'Victor Khanye',
    slug: 'victor-khanye',
    district: 'Nkangala District Municipality',
    localMunicipality: 'Victor Khanye Local Municipality',
    population: '81k',
    area: '1,676 km²',
    heroImage: 'https://images.unsplash.com/photo-1460661419201-fd4cecdf8a8b?auto=format&fit=crop&w=1600&q=80',
    logo: '/logo.png',
    description: 'Victor Khanye news covers local enterprise, public services and community programmes around the municipality.',
    mayor: 'Cllr. S. M. Nkoana',
    municipalManager: 'Mr. B. P. Mokoena',
    officialWebsite: 'https://www.victorkhanye.gov.za',
    localTourism: 'Coalfield heritage, local farms, cultural events',
    emergencyContacts: ['Police: 10111', 'Ambulance: 10177', 'Municipal Hotline: 013 690 1400'],
    serviceDeliveryNumbers: ['Community services: 013 690 1401', 'Planning: 013 690 1402', 'Water: 013 690 1403'],
    latestUpdate: '2026-07-24T11:05:00Z',
    weather: 'Mild • 21°C',
    tags: ['Enterprise', 'Public services', 'Heritage']
  },
  {
    name: 'Emalahleni',
    slug: 'emalahleni',
    district: 'Nkangala District Municipality',
    localMunicipality: 'Emalahleni Local Municipality',
    population: '463k',
    area: '2,695 km²',
    heroImage: 'https://images.unsplash.com/photo-1494526585095-c41746248156?auto=format&fit=crop&w=1600&q=80',
    logo: '/logo.png',
    description: 'Emalahleni provides municipal news on energy, business opportunities and service delivery in the coalfield hub.',
    mayor: 'Cllr. C. M. Nkosi',
    municipalManager: 'Mr. T. P. Molefe',
    officialWebsite: 'https://www.emalahleni.gov.za',
    localTourism: 'Witbank, coal heritage sites, game lodges',
    emergencyContacts: ['Police: 10111', 'Ambulance: 10177', 'Municipal Hotline: 013 690 5000'],
    serviceDeliveryNumbers: ['Electricity: 013 690 5001', 'Water: 013 690 5002', 'Roads: 013 690 5003'],
    latestUpdate: '2026-07-23T14:25:00Z',
    weather: 'Hot • 28°C',
    tags: ['Energy', 'Business', 'Services']
  },
  {
    name: 'Dr JS Moroka',
    slug: 'dr-js-moroka',
    district: 'Nkangala District Municipality',
    localMunicipality: 'Dr JS Moroka Local Municipality',
    population: '280k',
    area: '2,041 km²',
    heroImage: 'https://images.unsplash.com/photo-1473448912268-2022ce9509d8?auto=format&fit=crop&w=1600&q=80',
    logo: '/logo.png',
    description: 'Dr JS Moroka brings updates on education, health, infrastructure and community-led development.',
    mayor: 'Cllr. P. A. Maseko',
    municipalManager: 'Mr. R. A. Masilela',
    officialWebsite: 'https://www.drjsmoroka.gov.za',
    localTourism: 'Local heritage routes, cultural centres, parks',
    emergencyContacts: ['Police: 10111', 'Ambulance: 10177', 'Municipal Hotline: 013 690 6000'],
    serviceDeliveryNumbers: ['Education support: 013 690 6001', 'Health: 013 690 6002', 'Housing: 013 690 6003'],
    latestUpdate: '2026-07-22T07:15:00Z',
    weather: 'Cloudy • 17°C',
    tags: ['Education', 'Health', 'Community']
  },
  {
    name: 'Chief Albert Luthuli',
    slug: 'chief-albert-luthuli',
    district: 'Gert Sibande District Municipality',
    localMunicipality: 'Chief Albert Luthuli Local Municipality',
    population: '220k',
    area: '3,157 km²',
    heroImage: 'https://images.unsplash.com/photo-1495020689067-958852a7765e?auto=format&fit=crop&w=1600&q=80',
    logo: '/logo.png',
    description: 'Chief Albert Luthuli news highlights local governance, agriculture, transport and rural development.',
    mayor: 'Cllr. E. M. Maseko',
    municipalManager: 'Mr. B. M. Dlamini',
    officialWebsite: 'https://www.chiefalbertluthuli.gov.za',
    localTourism: 'Morgenzon, local heritage sites, green spaces',
    emergencyContacts: ['Police: 10111', 'Ambulance: 10177', 'Municipal Hotline: 017 883 2500'],
    serviceDeliveryNumbers: ['Roads: 017 883 2501', 'Water: 017 883 2502', 'Housing: 017 883 2503'],
    latestUpdate: '2026-07-21T18:40:00Z',
    weather: 'Showers • 18°C',
    tags: ['Rural economy', 'Governance', 'Agriculture']
  }
];

function getMunicipalityBySlug(slug) {
  return MUNICIPALITIES.find((entry) => entry.slug === String(slug).toLowerCase()) || null;
}

function getMunicipalityArticles(municipality) {
  const baseDate = new Date(municipality.latestUpdate || new Date().toISOString());
  const articles = [
    {
      title: `${municipality.name} ramps up service delivery after council review`,
      excerpt: `Officials say ${municipality.name} is accelerating delivery on water, roads and community facilities before the busy season.`,
      author: 'Sipho Ndlovu',
      publishedAt: new Date(baseDate.getTime() - 1000 * 60 * 30).toISOString(),
      readingTime: 4,
      category: 'Featured',
      image: municipality.heroImage,
      featured: true,
      summary: 'A major council review is shaping faster turnaround on key services.'
    },
    {
      title: `Local businesses in ${municipality.name} welcome the latest infrastructure plan`,
      excerpt: `Entrepreneurs say the upgrade programme will reduce delays and open new opportunities for traders and investors.`,
      author: 'Nokuthula Maseko',
      publishedAt: new Date(baseDate.getTime() - 1000 * 60 * 90).toISOString(),
      readingTime: 3,
      category: 'Business',
      image: 'https://images.unsplash.com/photo-1520607162513-77705c0f0d4a?auto=format&fit=crop&w=900&q=80',
      featured: false,
      summary: 'Small business owners are optimistic about quicker access to markets.'
    },
    {
      title: `Road safety campaign gains momentum across ${municipality.name}`,
      excerpt: `Community leaders and police are stepping up road safety awareness as school traffic increases.`,
      author: 'Mandla Dlamini',
      publishedAt: new Date(baseDate.getTime() - 1000 * 60 * 180).toISOString(),
      readingTime: 2,
      category: 'Politics',
      image: 'https://images.unsplash.com/photo-1517649763962-0c623066013b?auto=format&fit=crop&w=900&q=80',
      featured: false,
      summary: 'Traffic awareness and enforcement events are spreading across the municipality.'
    },
    {
      title: `Health outreach brings more services to residents in ${municipality.name}`,
      excerpt: `Mobile clinics and community partnerships are helping improve access to care in surrounding wards.`,
      author: 'Thandi Mabuza',
      publishedAt: new Date(baseDate.getTime() - 1000 * 60 * 240).toISOString(),
      readingTime: 4,
      category: 'Health',
      image: 'https://images.unsplash.com/photo-1576091160550-2173dba999ef?auto=format&fit=crop&w=900&q=80',
      featured: false,
      summary: 'Residents are accessing screenings and referrals closer to home.'
    },
    {
      title: `Schools in ${municipality.name} expand youth programmes with new partners`,
      excerpt: `New mentorship and arts programmes are keeping young people engaged during the school term.`,
      author: 'Zinhle Khumalo',
      publishedAt: new Date(baseDate.getTime() - 1000 * 60 * 320).toISOString(),
      readingTime: 3,
      category: 'Education',
      image: 'https://images.unsplash.com/photo-1522202176988-66273c2fd55f?auto=format&fit=crop&w=900&q=80',
      featured: false,
      summary: 'Community partners are backing practical learning and creative activities.'
    },
    {
      title: `${municipality.name} leaders confirm new community meeting dates`,
      excerpt: `Residents can expect public meetings in several wards as officials continue engagement on local priorities.`,
      author: 'Sibusiso Mthethwa',
      publishedAt: new Date(baseDate.getTime() - 1000 * 60 * 420).toISOString(),
      readingTime: 2,
      category: 'Community',
      image: 'https://images.unsplash.com/photo-1511578314322-379afb476865?auto=format&fit=crop&w=900&q=80',
      featured: false,
      summary: 'Public engagement remains a priority in the municipality’s calendar.'
    },
    {
      title: `Sporting facilities in ${municipality.name} receive fresh investment`,
      excerpt: `Youth clubs and school teams are preparing for a stronger season with safer spaces and better equipment.`,
      author: 'Kabelo Khoza',
      publishedAt: new Date(baseDate.getTime() - 1000 * 60 * 520).toISOString(),
      readingTime: 2,
      category: 'Sports',
      image: 'https://images.unsplash.com/photo-1517649763962-0c623066013b?auto=format&fit=crop&w=900&q=80',
      featured: false,
      summary: 'Local sports programmes are expanding with new support from partners.'
    }
  ];

  return articles.map((article, index) => ({
    ...article,
    id: `${municipality.slug}-${index + 1}`,
    slug: `${municipality.slug}-${index + 1}`,
    views: 180 + index * 35,
    likes: 24 + index * 6,
    tags: municipality.tags.slice(0, 2)
  }));
}

function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/"/g, '&quot;');
}

function formatDate(value) {
  return new Date(value).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' });
}

function buildMunicipalityPageHtml(municipality, articles, req) {
  const featured = articles.find((article) => article.featured) || articles[0];
  const latest = articles.slice(0, 4);
  const trending = articles.slice(1, 4);
  const politics = articles.filter((article) => article.category === 'Politics');
  const business = articles.filter((article) => article.category === 'Business');
  const sports = articles.filter((article) => article.category === 'Sports');
  const community = articles.filter((article) => article.category === 'Community');
  const health = articles.filter((article) => article.category === 'Health');
  const education = articles.filter((article) => article.category === 'Education');
  const shareUrl = `${req.protocol}://${req.get('host')}/municipality/${municipality.slug}`;

  return `<!doctype html>
<html lang="en-ZA" dir="ltr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(municipality.name)} Municipality News | Mpumalanga Local Time</title>
  <meta name="description" content="${escapeHtml(municipality.description)}" />
  <link rel="canonical" href="${escapeAttr(shareUrl)}" />
  <meta name="robots" content="index,follow,max-image-preview:large" />
  <meta property="og:title" content="${escapeHtml(municipality.name)} Municipality News | Mpumalanga Local Time" />
  <meta property="og:description" content="${escapeHtml(municipality.description)}" />
  <meta property="og:type" content="website" />
  <meta property="og:image" content="${escapeAttr(municipality.heroImage)}" />
  <meta property="og:url" content="${escapeAttr(shareUrl)}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${escapeHtml(municipality.name)} Municipality News" />
  <meta name="twitter:description" content="${escapeHtml(municipality.description)}" />
  <meta name="twitter:image" content="${escapeAttr(municipality.heroImage)}" />
  <style>
    :root { color-scheme: light dark; --accent:#c62828; --ink:#111827; --muted:#6b7280; --bg:#f8fafc; --card:#fff; --border:#e5e7eb; }
    * { box-sizing:border-box; }
    body { margin:0; font-family: Inter, Arial, sans-serif; background:var(--bg); color:var(--ink); line-height:1.6; }
    a { color:inherit; }
    .page { max-width:1280px; margin:0 auto; padding:0 18px 40px; }
    .topbar { background:#111827; color:#fff; padding:10px 0; font-size:.95rem; }
    .topbar .inner { max-width:1280px; margin:0 auto; padding:0 18px; display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap; }
    .nav { background:#fff; border-bottom:1px solid var(--border); position:sticky; top:0; z-index:10; }
    .nav .inner { max-width:1280px; margin:0 auto; padding:14px 18px; display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap; }
    .brand { font-weight:800; letter-spacing:.03em; color:var(--accent); }
    .nav-links { display:flex; flex-wrap:wrap; gap:16px; font-size:.95rem; }
    .hero { position:relative; border-radius:24px; overflow:hidden; min-height:420px; background:#111827; color:#fff; box-shadow:0 22px 60px rgba(15,23,42,.16); margin-top:22px; }
    .hero img { width:100%; height:100%; object-fit:cover; position:absolute; inset:0; }
    .hero::after { content:''; position:absolute; inset:0; background:linear-gradient(90deg, rgba(0,0,0,.8), rgba(0,0,0,.25)); }
    .hero-content { position:relative; z-index:1; padding:32px; display:flex; flex-direction:column; justify-content:space-between; min-height:420px; }
    .eyebrow { display:inline-flex; align-items:center; gap:8px; padding:8px 12px; border-radius:999px; background:rgba(255,255,255,.13); backdrop-filter:blur(8px); width:max-content; font-size:.85rem; text-transform:uppercase; letter-spacing:.08em; }
    .hero h1 { font-size:clamp(2rem, 4vw, 3.2rem); margin:10px 0 12px; line-height:1.05; }
    .hero .meta { display:flex; gap:16px; flex-wrap:wrap; color:#f3f4f6; font-size:.95rem; }
    .hero .stats { display:grid; grid-template-columns:repeat(auto-fit, minmax(160px, 1fr)); gap:12px; margin-top:16px; }
    .hero .stats div { background:rgba(255,255,255,.12); padding:14px; border-radius:16px; backdrop-filter:blur(8px); }
    .breadcrumb { padding:16px 0 10px; color:var(--muted); font-size:.95rem; }
    .grid { display:grid; gap:24px; grid-template-columns:2fr 1fr; margin-top:24px; }
    .card { background:var(--card); border:1px solid var(--border); border-radius:20px; padding:20px; box-shadow:0 18px 50px rgba(15,23,42,.04); }
    .news-list { display:grid; gap:16px; }
    .news-item { display:grid; gap:14px; grid-template-columns:140px 1fr; align-items:start; padding:14px; border:1px solid var(--border); border-radius:16px; }
    .news-item img { width:140px; height:100px; object-fit:cover; border-radius:12px; }
    .pill { display:inline-block; padding:6px 10px; border-radius:999px; background:#fee2e2; color:var(--accent); font-size:.78rem; font-weight:700; text-transform:uppercase; letter-spacing:.04em; }
    .muted { color:var(--muted); }
    .button-row { display:flex; flex-wrap:wrap; gap:8px; margin-top:10px; }
    button, .btn { border:none; border-radius:999px; padding:9px 12px; cursor:pointer; background:#111827; color:#fff; font-weight:600; }
    .btn.secondary { background:#fff; color:var(--ink); border:1px solid var(--border); }
    .sidebar { display:grid; gap:16px; }
    .sidebar .card ul { margin:0; padding-left:18px; display:grid; gap:10px; }
    .info-grid { display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:14px; margin-top:16px; }
    .gallery { display:grid; grid-template-columns:repeat(3, minmax(0, 1fr)); gap:12px; margin-top:14px; }
    .gallery img { width:100%; height:180px; object-fit:cover; border-radius:14px; cursor:pointer; }
    .video-grid { display:grid; gap:12px; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); margin-top:14px; }
    .video-card { background:#111827; color:#fff; border-radius:16px; padding:16px; }
    .comments { display:grid; gap:12px; margin-top:12px; }
    .comments textarea, .comments input { width:100%; border:1px solid var(--border); border-radius:12px; padding:12px 14px; font:inherit; }
    .footer { text-align:center; padding:28px 0 40px; color:var(--muted); font-size:.95rem; }
    @media (max-width:900px) { .grid { grid-template-columns:1fr; } .gallery { grid-template-columns:1fr 1fr; } }
    @media (max-width:640px) { .hero { min-height:480px; } .news-item { grid-template-columns:1fr; } .gallery { grid-template-columns:1fr; } }
  </style>
  <script type="application/ld+json">{
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    "headline": "${escapeHtml(municipality.name)} Municipality News",
    "description": "${escapeHtml(municipality.description)}",
    "image": ["${escapeAttr(municipality.heroImage)}"],
    "author": {
      "@type": "Organization",
      "name": "Mpumalanga Local Time"
    },
    "publisher": {
      "@type": "Organization",
      "name": "Mpumalanga Local Time",
      "logo": {
        "@type": "ImageObject",
        "url": "https://mplocaltime.co.za/logo.png"
      }
    },
    "mainEntityOfPage": "${escapeAttr(shareUrl)}",
    "datePublished": "${escapeAttr(municipality.latestUpdate)}",
    "dateModified": "${escapeAttr(municipality.latestUpdate)}"
  }</script>
  <script type="application/ld+json">{
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    "itemListElement": [
      {"@type": "ListItem", "position": 1, "name": "Home", "item": "${escapeAttr(`${req.protocol}://${req.get('host')}`)}"},
      {"@type": "ListItem", "position": 2, "name": "Municipalities", "item": "${escapeAttr(`${req.protocol}://${req.get('host')}/municipalities`)}"},
      {"@type": "ListItem", "position": 3, "name": "${escapeHtml(municipality.name)}", "item": "${escapeAttr(shareUrl)}"}
    ]
  }</script>
  <script type="application/ld+json">{
    "@context": "https://schema.org",
    "@type": "Place",
    "name": "${escapeHtml(municipality.name)}",
    "description": "${escapeHtml(municipality.description)}",
    "address": {
      "@type": "PostalAddress",
      "addressRegion": "Mpumalanga"
    },
    "additionalProperty": [
      {
        "@type": "PropertyValue",
        "name": "District Municipality",
        "value": "${escapeHtml(municipality.district)}"
      },
      {
        "@type": "PropertyValue",
        "name": "Population",
        "value": "${escapeHtml(municipality.population)}"
      }
    ]
  }</script>
</head>
<body>
  <div class="topbar"><div class="inner"><span>Mpumalanga Local Time • Independent local reporting</span><span>Updated ${escapeHtml(new Date(municipality.latestUpdate).toLocaleDateString('en-ZA', { day:'numeric', month:'short', year:'numeric' }))}</span></div></div>
  <nav class="nav"><div class="inner"><a href="/" class="brand">MPUMALANGA LOCAL TIME</a><div class="nav-links"><a href="/">Home</a><a href="/municipalities">Municipalities</a><a href="/news.html">News</a><a href="/business.html">Business</a><a href="/contact.html">Contact</a></div></div></nav>
  <main class="page">
    <div class="breadcrumb">Home &gt; Municipalities &gt; ${escapeHtml(municipality.name)}</div>
    <section class="hero" aria-label="Municipality hero">
      <img src="${escapeAttr(municipality.heroImage)}" alt="${escapeHtml(municipality.name)} municipality skyline" />
      <div class="hero-content">
        <div>
          <div class="eyebrow">${escapeHtml(municipality.localMunicipality)} • Breaking local news</div>
          <h1>${escapeHtml(municipality.name)}</h1>
          <p>${escapeHtml(municipality.description)}</p>
          <div class="meta">
            <span>Population: ${escapeHtml(municipality.population)}</span>
            <span>District: ${escapeHtml(municipality.district)}</span>
            <span>Latest update: ${escapeHtml(new Date(municipality.latestUpdate).toLocaleDateString('en-ZA', { day:'numeric', month:'short', year:'numeric' }))}</span>
          </div>
          <div class="stats">
            <div><strong>${articles.length}</strong><br />Latest stories</div>
            <div><strong>${municipality.weather}</strong><br />Weather update</div>
            <div><strong>24/7</strong><br />Local reporting</div>
          </div>
        </div>
      </div>
    </section>

    <div class="grid">
      <section aria-label="Latest news">
        <div class="card">
          <div class="pill">Featured story</div>
          <h2 style="margin:10px 0 8px;">${escapeHtml(featured.title)}</h2>
          <p class="muted">${escapeHtml(featured.excerpt)}</p>
          <div class="button-row">
            <button type="button">Read full story</button>
            <button type="button" class="btn secondary">Bookmark</button>
            <button type="button" class="btn secondary">Share</button>
          </div>
        </div>
        <div class="card" style="margin-top:18px;">
          <h2 style="margin-top:0;">Latest news</h2>
          <div class="news-list">
            ${latest.map((article) => `
              <article class="news-item">
                <img src="${escapeAttr(article.image)}" alt="${escapeHtml(article.title)}" />
                <div>
                  <div class="pill">${escapeHtml(article.category)}</div>
                  <h3 style="margin:8px 0 6px; font-size:1rem;">${escapeHtml(article.title)}</h3>
                  <p class="muted" style="margin:0 0 8px;">${escapeHtml(article.summary || article.excerpt)}</p>
                  <div class="muted" style="font-size:.9rem;">By ${escapeHtml(article.author)} • ${escapeHtml(formatDate(article.publishedAt))} • ${article.readingTime} min read</div>
                </div>
              </article>
            `).join('')}
          </div>
        </div>
      </section>

      <aside class="sidebar" aria-label="Municipality sidebar">
        <div class="card">
          <h3 style="margin-top:0;">Trending articles</h3>
          <ul>
            ${trending.map((article) => `<li><a href="#">${escapeHtml(article.title)}</a></li>`).join('')}
          </ul>
        </div>
        <div class="card">
          <h3 style="margin-top:0;">Local information</h3>
          <p><strong>Mayor:</strong> ${escapeHtml(municipality.mayor)}</p>
          <p><strong>Municipal Manager:</strong> ${escapeHtml(municipality.municipalManager)}</p>
          <p><strong>Official website:</strong> <a href="${escapeAttr(municipality.officialWebsite)}">${escapeHtml(municipality.officialWebsite)}</a></p>
          <p><strong>Population:</strong> ${escapeHtml(municipality.population)} • <strong>Area:</strong> ${escapeHtml(municipality.area)}</p>
        </div>
        <div class="card">
          <h3 style="margin-top:0;">Upcoming events</h3>
          <ul>
            <li>Ward community meeting • Friday 16:00</li>
            <li>Township market • Saturday 09:00</li>
            <li>Sports festival • Sunday 10:00</li>
          </ul>
        </div>
        <div class="card">
          <h3 style="margin-top:0;">Newsletter signup</h3>
          <p class="muted">Receive the latest municipal updates directly in your inbox.</p>
          <form style="display:grid; gap:10px;">
            <input type="email" aria-label="Email address" placeholder="Your email address" />
            <button type="submit">Subscribe</button>
          </form>
        </div>
      </aside>
    </div>

    <div class="card" style="margin-top:24px;">
      <h2 style="margin-top:0;">News by category</h2>
      <div class="info-grid">
        <div><h3>Politics</h3><p>${escapeHtml(politics[0]?.title || 'Council developments and public hearings')}</p></div>
        <div><h3>Crime</h3><p>Safety alerts and community watch updates in the municipality.</p></div>
        <div><h3>Business</h3><p>${escapeHtml(business[0]?.title || 'Supply chain and enterprise development stories')}</p></div>
        <div><h3>Sports</h3><p>${escapeHtml(sports[0]?.title || 'Local fixtures and school competitions')}</p></div>
        <div><h3>Community</h3><p>${escapeHtml(community[0]?.title || 'Volunteer programmes and neighbourhood projects')}</p></div>
        <div><h3>Education & Health</h3><p>${escapeHtml(education[0]?.title || '')} • ${escapeHtml(health[0]?.title || '')}</p></div>
      </div>
    </div>

    <div class="card" style="margin-top:24px;">
      <h2 style="margin-top:0;">Business directory preview</h2>
      <div class="info-grid">
        <div><strong>Restaurants</strong><br />Local eateries and food markets</div>
        <div><strong>Hotels</strong><br />Accommodation and guesthouses</div>
        <div><strong>Medical</strong><br />Clinics and pharmacies</div>
        <div><strong>Schools</strong><br />Private and public education centres</div>
      </div>
    </div>

    <div class="card" style="margin-top:24px;">
      <h2 style="margin-top:0;">Photo gallery</h2>
      <div class="gallery">
        <img src="${escapeAttr(municipality.heroImage)}" alt="${escapeHtml(municipality.name)} gallery image" />
        <img src="https://images.unsplash.com/photo-1529156069898-49953e39b3ac?auto=format&fit=crop&w=900&q=80" alt="Community event in ${escapeHtml(municipality.name)}" />
        <img src="https://images.unsplash.com/photo-1495020689067-958852a7765e?auto=format&fit=crop&w=900&q=80" alt="Local market in ${escapeHtml(municipality.name)}" />
      </div>
      <p class="muted" style="margin-top:10px;">Photo credits: Mpumalanga Local Time newsroom</p>
    </div>

    <div class="card" style="margin-top:24px;">
      <h2 style="margin-top:0;">Video news</h2>
      <div class="video-grid">
        <div class="video-card">
          <strong>Municipality updates</strong>
          <p class="muted">Embedded local bulletin and community updates.</p>
        </div>
        <div class="video-card">
          <strong>Public meetings</strong>
          <p class="muted">Watch the latest council and ward engagement sessions.</p>
        </div>
      </div>
    </div>

    <div class="card" style="margin-top:24px;">
      <h2 style="margin-top:0;">Join the conversation</h2>
      <p class="muted">Authenticated readers can comment, reply and report inappropriate content.</p>
      <div class="comments">
        <input type="text" aria-label="Name" placeholder="Your name" />
        <textarea aria-label="Comment" placeholder="Share your perspective on this municipality story"></textarea>
        <button type="button">Post comment</button>
      </div>
    </div>
  </main>
  <footer class="footer">© ${new Date().getFullYear()} Mpumalanga Local Time • Built for faster local news discovery and stronger municipality visibility.</footer>
  <script>
    document.querySelectorAll('.gallery img').forEach((img) => {
      img.addEventListener('click', () => {
        const overlay = document.createElement('div');
        overlay.style.position='fixed';
        overlay.style.inset='0';
        overlay.style.background='rgba(17,24,39,.85)';
        overlay.style.display='flex';
        overlay.style.alignItems='center';
        overlay.style.justifyContent='center';
        overlay.style.zIndex='100';
        overlay.innerHTML = '<img src="' + img.src + '" style="max-width:90vw; max-height:90vh; border-radius:16px;" alt="Expanded gallery image" />';
        overlay.addEventListener('click', () => overlay.remove());
        document.body.appendChild(overlay);
      });
    });
  </script>
</body>
</html>`;
}

function buildMunicipalityListHtml(req) {
  const items = MUNICIPALITIES.map((municipality) => `
    <li style="display:flex; justify-content:space-between; gap:12px; padding:12px 0; border-bottom:1px solid #e5e7eb;">
      <div>
        <strong><a href="/municipality/${escapeHtml(municipality.slug)}">${escapeHtml(municipality.name)}</a></strong><br />
        <span style="color:#6b7280;">${escapeHtml(municipality.localMunicipality)}</span>
      </div>
      <div style="text-align:right; color:#6b7280; font-size:.95rem;">
        ${escapeHtml(municipality.population)}<br />${escapeHtml(municipality.district)}
      </div>
    </li>
  `).join('');

  return `<!doctype html>
<html lang="en-ZA" dir="ltr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Municipalities | Mpumalanga Local Time</title>
  <meta name="description" content="Browse dedicated municipality pages for Mpumalanga news, governance and community reporting." />
  <link rel="canonical" href="${escapeAttr(`${req.protocol}://${req.get('host')}/municipalities`)}" />
  <style>body{font-family:Inter,Arial,sans-serif;margin:0;padding:0;background:#f8fafc;color:#111827;} main{max-width:960px;margin:0 auto;padding:24px 18px 48px;} .card{background:#fff;border:1px solid #e5e7eb;border-radius:20px;padding:20px;box-shadow:0 15px 40px rgba(15,23,42,.04);} ul{list-style:none;padding:0;margin:0;} a{color:#c62828;text-decoration:none;} h1{margin-top:0;}</style>
</head>
<body>
  <main>
    <div class="card">
      <h1>Municipalities</h1>
      <p>Browse dedicated municipality news pages built for local SEO, community visibility and fast delivery.</p>
      <ul>${items}</ul>
    </div>
  </main>
</body>
</html>`;
}

module.exports = {
  MUNICIPALITIES,
  getMunicipalityBySlug,
  getMunicipalityArticles,
  buildMunicipalityPageHtml,
  buildMunicipalityListHtml,
  escapeHtml
};
