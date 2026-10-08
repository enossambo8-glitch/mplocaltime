/*
  cookie-consent.js
  Vanilla JS cookie consent manager with Google Consent Mode v2 support
  - Lightweight, modular, accessible
  - Stores consent in localStorage under configurable key
  - Lazy-loads GA4 until analytics consent granted
  - Integrates with GTM if provided (dataLayer pushes)

  Usage:
    <script src="/cookie-consent.js"></script>
    <script>
      CookieConsent.init({ ga4Id: 'YOUR-GA4-ID', gtmId: 'YOUR-GTM-ID', policyUrl: '/privacy-policy.html' });
    </script>

  Config options: ga4Id, gtmId, storageKey, policyUrl, companyName
*/
(function(window, document){
  'use strict';

  const defaults = {
    storageKey: 'mplocal_cookie_consent_v1',
    ga4Id: '',
    gtmId: '',
    policyUrl: '/privacy-policy.html',
    companyName: '',
    rootSelector: '#cookie-consent-root'
  };

  // Consent categories
  const CATEGORY = {
    NECESSARY: 'necessary',
    ANALYTICS: 'analytics',
    MARKETING: 'marketing',
    FUNCTIONAL: 'functional'
  };

  let cfg = Object.assign({}, defaults);
  let state = null; // { necessary: true, analytics: false, marketing: false, functional: false }
  let gaLoaded = false;

  // Helper: safe parse
  function safeParse(str, fallback){ try{ return JSON.parse(str||'null')||fallback;}catch(e){return fallback;} }

  function saveState(){
    localStorage.setItem(cfg.storageKey, JSON.stringify(state));
  }

  function loadState(){
    return safeParse(localStorage.getItem(cfg.storageKey), null);
  }

  // Establish denied consent before Google tags execute.
  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function(){ window.dataLayer.push(arguments); };
  window.gtag('consent', 'default', {
    analytics_storage: 'denied',
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied'
  });
  // Apply Google Consent Mode v2 update
  function applyGoogleConsent(){
    const consentUpdate = {
      analytics_storage: state.analytics ? 'granted' : 'denied',
      ad_storage: state.marketing ? 'granted' : 'denied',
      ad_user_data: state.marketing ? 'granted' : 'denied',
      ad_personalization: state.marketing ? 'granted' : 'denied'
    };

    // If gtag is available
    try{
      if (typeof window.gtag === 'function'){
        window.gtag('consent', 'update', consentUpdate);
      } else {
        window.dataLayer = window.dataLayer || [];
        window.dataLayer.push({ event: 'cookie_consent_update', cookie_consent: consentUpdate });
      }
    }catch(e){
      console.warn('Consent update failed', e);
    }

    // Lazy load GA4 if analytics granted
    if (cfg.ga4Id && state.analytics && !gaLoaded){
      loadGA4(cfg.ga4Id);
    }
  }

  // Load GA4 (gtag.js) lazily on consent
  function loadGA4(id){
    if (!id) return;
    gaLoaded = true;
    // Inject gtag script
    const s = document.createElement('script');
    s.src = `https://www.googletagmanager.com/gtag/js?id=${id}`;
    s.async = true;
    document.head.appendChild(s);
    window.dataLayer = window.dataLayer || [];
    function gtag(){window.dataLayer.push(arguments);} window.gtag = window.gtag || gtag;
    window.gtag('js', new Date());
    window.gtag('config', id, { send_page_view: true });
  }

  // UI creation
  function createBanner(){
    const root = document.querySelector(cfg.rootSelector);
    if (!root) return null;

    const wrapper = document.createElement('div');
    wrapper.className = 'cc-banner';
    wrapper.setAttribute('role','region');
    wrapper.setAttribute('aria-label','Cookie consent banner');

    const content = document.createElement('div');
    content.className = 'cc-content';
    const title = document.createElement('p'); title.className='cc-title'; title.textContent = `Your privacy choices matter.`;
    const text = document.createElement('p'); text.className='cc-text';
    text.innerHTML = `We use necessary cookies to operate this site. With your permission, we also use analytics and advertising cookies. <a class="cc-link" href="${cfg.policyUrl}" target="_blank" rel="noopener">Privacy Policy</a>`;
    content.appendChild(title); content.appendChild(text);

    const actions = document.createElement('div'); actions.className='cc-actions';
    const acceptBtn = document.createElement('button'); acceptBtn.className='cc-btn primary'; acceptBtn.textContent='Accept All'; acceptBtn.addEventListener('click', ()=>{ setAll(true); hideBanner(); });
    const rejectBtn = document.createElement('button'); rejectBtn.className='cc-btn ghost'; rejectBtn.textContent='Reject Non-Essential'; rejectBtn.addEventListener('click', ()=>{ setRejectNonEssential(); hideBanner(); });
    const customizeBtn = document.createElement('button'); customizeBtn.className='cc-btn tertiary'; customizeBtn.textContent='Customize Preferences'; customizeBtn.addEventListener('click', openPreferences);
    actions.appendChild(acceptBtn); actions.appendChild(rejectBtn); actions.appendChild(customizeBtn);

    wrapper.appendChild(content); wrapper.appendChild(actions);
    root.appendChild(wrapper);

    // Floating settings button
    const settings = document.createElement('button'); settings.className='cc-settings'; settings.textContent='Cookie Settings'; settings.setAttribute('aria-label','Open cookie settings'); settings.addEventListener('click', openPreferences);
    root.appendChild(settings);

    // Preferences modal (hidden)
    const backdrop = document.createElement('div'); backdrop.className='cc-modal-backdrop hidden'; backdrop.style.display='none'; backdrop.setAttribute('role','dialog'); backdrop.setAttribute('aria-modal','true');
    const modal = document.createElement('div'); modal.className='cc-modal'; modal.setAttribute('tabindex','-1');
    modal.innerHTML = `<h2>Cookie Preferences</h2><p class="cc-text">Manage your cookie preferences. Necessary cookies are always enabled.</p>`;
    const cats = document.createElement('div'); cats.className='cc-cats';

    // Category rows
    const catAnalytics = createCategoryRow('Analytics Cookies','Used to collect analytics and improve the site', CATEGORY.ANALYTICS, true);
    const catMarketing = createCategoryRow('Marketing Cookies','Used for advertising and personalization', CATEGORY.MARKETING, true);
    const catFunctional = createCategoryRow('Functional Cookies','Used for features and preferences', CATEGORY.FUNCTIONAL, true);

    cats.appendChild(catAnalytics.row); cats.appendChild(catFunctional.row); cats.appendChild(catMarketing.row);
    modal.appendChild(cats);

    const footer = document.createElement('div'); footer.className='cc-footer';
    const saveBtn = document.createElement('button'); saveBtn.className='cc-btn primary'; saveBtn.textContent='Save Preferences'; saveBtn.addEventListener('click', ()=>{ savePreferences(); closePreferences(); hideBanner(); });
    const cancelBtn = document.createElement('button'); cancelBtn.className='cc-btn ghost'; cancelBtn.textContent='Reject Non-Essential'; cancelBtn.addEventListener('click', ()=>{ setRejectNonEssential(); closePreferences(); hideBanner(); });
    footer.appendChild(cancelBtn); footer.appendChild(saveBtn);
    modal.appendChild(footer);

    backdrop.appendChild(modal);
    root.appendChild(backdrop);

    // accessibility: trap focus in modal when opened
    backdrop.addEventListener('keydown', function(e){ if (e.key==='Escape') { closePreferences(); } });

    // store references
    return { wrapper, backdrop, modal, inputs: { analytics: catAnalytics.input, marketing: catMarketing.input, functional: catFunctional.input } };
  }

  function createCategoryRow(label, desc, key, defaultChecked){
    const row = document.createElement('div'); row.className='cc-cat';
    const left = document.createElement('div');
    const title = document.createElement('div'); title.textContent = label; title.style.fontWeight='700';
    const d = document.createElement('div'); d.className='desc'; d.textContent = desc;
    left.appendChild(title); left.appendChild(d);
    const right = document.createElement('div'); right.className='cc-toggle';
    const input = document.createElement('input'); input.type='checkbox'; input.checked = defaultChecked; input.setAttribute('data-key', key);
    // necessary disabled handled elsewhere
    right.appendChild(input);
    row.appendChild(left); row.appendChild(right);
    return { row, input };
  }

  // UI instances
  let ui = null;

  function openPreferences(){
    if (!ui) return;
    ui.backdrop.style.display='flex'; ui.backdrop.classList.remove('hidden');
    // populate inputs from current state
    ui.inputs.analytics.checked = !!state.analytics;
    ui.inputs.marketing.checked = !!state.marketing;
    ui.inputs.functional.checked = !!state.functional;
    // focus on first focusable element
    setTimeout(()=> ui.modal.focus(), 50);
  }

  function closePreferences(){
    if (!ui) return; ui.backdrop.classList.add('hidden'); ui.backdrop.style.display='none';
  }

  function hideBanner(){ if(ui && ui.wrapper){ ui.wrapper.classList.add('hidden'); setTimeout(()=>{ if(ui.wrapper) ui.wrapper.style.display='none'; },350); } }

  function showBanner(){ if(ui && ui.wrapper){ ui.wrapper.style.display='flex'; ui.wrapper.classList.remove('hidden'); } }

  function setAll(val){ state = { necessary: true, analytics: !!val, marketing: !!val, functional: !!val }; saveState(); applyGoogleConsent(); }
  function setRejectNonEssential(){ state = { necessary: true, analytics: false, marketing: false, functional: false }; saveState(); applyGoogleConsent(); }

  function savePreferences(){ state.analytics = !!ui.inputs.analytics.checked; state.marketing = !!ui.inputs.marketing.checked; state.functional = !!ui.inputs.functional.checked; state.necessary = true; saveState(); applyGoogleConsent(); }

  // Initialization
  function init(options){
    cfg = Object.assign({}, defaults, options || {});
    // create UI
    ui = createBanner();
    state = loadState();
    if (state){
      // previously chosen
      applyGoogleConsent();
      hideBanner();
    } else {
      // default before consent: deny analytics/ads
      state = { necessary:true, analytics:false, marketing:false, functional:false };
      // ensure Google default consent state set to denied
      applyGoogleConsent();
      showBanner();
    }
  }

  // Provide API to open settings
  const api = {
    init,
    openPreferences: ()=> openPreferences(),
    getConsent: ()=> state,
    reset: ()=> { localStorage.removeItem(cfg.storageKey); state = null; showBanner(); }
  };

  // Expose globally
  window.CookieConsent = api;

})(window, document);
