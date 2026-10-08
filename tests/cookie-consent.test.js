const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const app = require('../server');

function createElement(tagName) {
  const listeners = new Map();
  const classes = new Set();
  return {
    attributes: {},
    children: [],
    className: '',
    style: {},
    tagName,
    addEventListener(event, listener) {
      listeners.set(event, listener);
    },
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    classList: {
      add(className) {
        classes.add(className);
      },
      contains(className) {
        return classes.has(className) || this.className?.split(/\s+/).includes(className);
      },
      remove(className) {
        classes.delete(className);
      },
    },
    click() {
      listeners.get('click')?.({ preventDefault() {} });
    },
    focus() {},
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
  };
}

function findElement(root, predicate) {
  if (predicate(root)) return root;
  for (const child of root.children) {
    const found = findElement(child, predicate);
    if (found) return found;
  }
  return null;
}

function createConsentHarness(savedConsent) {
  const root = createElement('div');
  const settingsLink = createElement('a');
  const storage = new Map();
  if (savedConsent) storage.set('mplocal_cookie_consent_v1', JSON.stringify(savedConsent));

  const document = {
    createElement,
    head: createElement('head'),
    querySelector(selector) {
      return selector === '#cookie-consent-root' ? root : null;
    },
    querySelectorAll(selector) {
      return selector === '[data-cookie-settings]' ? [settingsLink] : [];
    },
  };
  const window = { setTimeout: (callback) => callback() };
  const source = fs.readFileSync(path.join(__dirname, '..', 'cookie-consent.js'), 'utf8');
  vm.runInNewContext(source, {
    document,
    localStorage: {
      getItem: (key) => storage.get(key) || null,
      removeItem: (key) => storage.delete(key),
      setItem: (key, value) => storage.set(key, value),
    },
    setTimeout: window.setTimeout,
    window,
  });
  window.CookieConsent.init();

  return { root, settingsLink, storage };
}

test('the cookie consent stylesheet is available to pages that load the site stylesheet', async () => {
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const page = await fetch(`${baseUrl}/`);
    const pageHtml = await page.text();
    assert.equal(page.status, 200);
    assert.match(pageHtml, /<link rel="stylesheet" href="\/styles\.css">/);
    assert.match(pageHtml, /id="cookie-consent-root"/);
    assert.match(pageHtml, /src="\/cookie-consent\.js"/);

    const dashboard = await fetch(`${baseUrl}/dashboard.html`);
    const dashboardHtml = await dashboard.text();
    assert.equal(dashboard.status, 200);
    assert.match(dashboardHtml, /<link rel="stylesheet" href="\/styles\.css"\s*\/?>/);
    assert.match(dashboardHtml, /id="cookie-consent-root"/);
    assert.match(dashboardHtml, /src="\/cookie-consent\.js"/);

    const siteStyles = await fetch(`${baseUrl}/styles.css`);
    const siteStylesText = await siteStyles.text();
    assert.equal(siteStyles.status, 200);
    assert.match(siteStyles.headers.get('content-type'), /text\/css/);
    assert.match(siteStylesText, /@import url\('\/cookie-banner\.css'\);/);

    const consentStyles = await fetch(`${baseUrl}/cookie-banner.css`);
    const consentStylesText = await consentStyles.text();
    assert.equal(consentStyles.status, 200);
    assert.match(consentStyles.headers.get('content-type'), /text\/css/);
    assert.match(consentStylesText, /#cookie-consent-root/);
    assert.match(consentStylesText, /@media \(max-width:720px\)/);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test('cookie consent controls preserve choices and suppress saved-consent banners', () => {
  const acceptHarness = createConsentHarness();
  const acceptButton = findElement(acceptHarness.root, (element) => element.textContent === 'Accept All');
  const acceptBanner = findElement(acceptHarness.root, (element) => element.className === 'cc-banner');
  acceptButton.click();
  assert.deepEqual(JSON.parse(acceptHarness.storage.get('mplocal_cookie_consent_v1')), {
    necessary: true,
    analytics: true,
    marketing: true,
    functional: true,
  });
  assert.equal(acceptBanner.style.display, 'none');

  const rejectHarness = createConsentHarness();
  const rejectButton = findElement(rejectHarness.root, (element) => element.textContent === 'Reject Non-Essential');
  rejectButton.click();
  assert.deepEqual(JSON.parse(rejectHarness.storage.get('mplocal_cookie_consent_v1')), {
    necessary: true,
    analytics: false,
    marketing: false,
    functional: false,
  });

  const preferencesHarness = createConsentHarness();
  const customizeButton = findElement(preferencesHarness.root, (element) => element.textContent === 'Customize Preferences');
  const backdrop = findElement(preferencesHarness.root, (element) => element.className === 'cc-modal-backdrop hidden');
  customizeButton.click();
  assert.equal(backdrop.style.display, 'flex');
  preferencesHarness.settingsLink.click();
  assert.equal(backdrop.style.display, 'flex');

  const savedConsentHarness = createConsentHarness({
    necessary: true,
    analytics: false,
    marketing: false,
    functional: false,
  });
  const savedBanner = findElement(savedConsentHarness.root, (element) => element.className === 'cc-banner');
  assert.equal(savedBanner.style.display, 'none');
});
