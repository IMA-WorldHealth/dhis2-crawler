/* global svgAsDataUri html2canvas */
const puppeteer = require('puppeteer-core');
const debug = require('debug')('dhis2-crawler');
const path = require('path');
const scrollToBottom = require('puppeteer-autoscroll-down');
const EventEmitter = require('events');
const fs = require('fs');

let saveScreenshots = false;
if (process.env.DEBUG_SCREENSHOT) {
  saveScreenshots = true;
}

const HTML_2_CANVAS_BASE = require.resolve('html2canvas').split('npm')[0];
const HTML_2_CANVAS_PATH = path.join(HTML_2_CANVAS_BASE, '../html2canvas.min.js');
const SAVE_SVG_AS_PNG_PATH = require.resolve('save-svg-as-png');

const seconds = 1000;

const SHORT_NETWORK_OPTS = {
  waitUntil: 'networkidle0',
  timeout: 300 * seconds, // 5 mins
};

const DEFAULT_OPTIONS = {
  headless: true,
  args: [
    '--bwsi',
    '--disable-default-apps',
    '--disable-dev-shm-usage',
    '--disable-setuid-sandbox',
    '--hide-scrollbars',
    '--disable-web-security',
    '--no-sandbox',
  ],
  executablePath: '/usr/bin/chromium-browser',
};

function convertSvgChartsIntoDataUris(charts) {
  return Promise.all(
    charts.map((chart) => new Promise((resolve) => svgAsDataUri(chart, {}, (uri) => resolve(uri)))),
  );
}

function convertTablesIntoDataUris(tables) {
  return Promise.all(tables.map((table) => {
    let label;
    try {
      const item = table.parentElement.parentElement.parentElement.parentElement;
      label = item.querySelector('span').textContent;
    } catch (error) {
      return Promise.reject(error);
    }

    return html2canvas(table, { scale: 3 })
      .then((canvas) => ({ label, uri: canvas.toDataURL() }));
  }));
}

class Crawler extends EventEmitter {
  constructor(options = {}) {
    super();
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.on('event', debug);
  }

  async initialize() {
    this.emit('event', 'Spinning up headless Google Chrome to render the DHIS2 site.');
    const options = { ...this.options };
    this.browser = await puppeteer.launch(options);
    [this.page] = await this.browser.pages();

    this.page.on('pageerror', (err) => {
      debug('An error occurred in page: %j', err);
      this.emit('event', 'An err occurred in page:', err);
    });

    await this.page.emulateMedia('screen');
  }

  setCredentials(credentials) {
    this.credentials = credentials;
  }

  async login(webpage) {
    this.emit('event', `Loading the DHIS2 login page at ${webpage}.`);
    await this.page.goto(webpage, SHORT_NETWORK_OPTS);

    this.emit('event', `Page loaded! Logging into DHIS2 as ${this.credentials.username}.`);

    const username = await this.page.$('input[id=j_username]');
    await username.type(this.credentials.username, { delay: 5 });

    const password = await this.page.$('input[id=j_password]');
    await password.type(this.credentials.password, { delay: 5 });

    await Promise.all([
      this.page.waitForNavigation({ load: SHORT_NETWORK_OPTS }),
      this.page.click('input[type=submit]'),
    ]);

    this.emit('event', 'Credentials submitted.  Waiting for dashboad pages to load.');
  }

  async goToDashboardById(ident, _delay = 5) {
    this.emit('event', `Navigating to find dashboard w/ id ${ident}.`);
    await this.page.waitFor(_delay * seconds);

    // click on the href for the dashboard in question.
    await Promise.all([
      this.page.waitForNavigation({ load: SHORT_NETWORK_OPTS }),
      this.page.click(`a[href="#/${ident}"]`),
    ]);

    this.emit('event', `Clicked on dashboard link #${ident}`);
    await this.page.waitFor(_delay * seconds);
  }

  async gatherSvgsFromDashboard() {
    this.emit('event', 'Fetching SVG graphs from the dashboard.');
    await this.page.addScriptTag({ path: SAVE_SVG_AS_PNG_PATH });

    const svgs = await this.page.$$eval('svg.highcharts-root', convertSvgChartsIntoDataUris);
    this.emit('event', `Pulled ${svgs.length} graphs from the dashboard.`);
    return svgs;
  }

  async gatherTablesFromDashboard() {
    this.emit('event', 'Fetching pivot tables from the dashboard.');
    await this.page.addScriptTag({ path: HTML_2_CANVAS_PATH });

    // required to ensure that all dashboards load correctly.
    await scrollToBottom(this.page, 50, 250);

    // wait for 5 seconds
    await this.page.waitFor(5 * seconds);

    const tmpfile = `/tmp/${Date.now()}-screenshot-full-page.png`;

    // for some reason, we must screenshot the page to make rendering work.
    await this.page.screenshot({ path: tmpfile, fullPage : true });

    const tables = await this.page.$$eval('table.pivot', convertTablesIntoDataUris);
    this.emit('event', `Pulled ${tables.length} tables from the dashboard.`);

    // delete temporary file if we do not need to save the information
    if (!saveScreenshots) {
      await fs.promises.unlink(tmpfile);
    }

    return tables;
  }

  async destroy(errored = false) {
    if (errored) {
      this.emit('event', 'An error occurred. Closing the browser.');
    } else {
      this.emit('event', 'All dashboards downloaded. Closing the browser.');
    }

    await this.browser.close();

    this.emit('event', 'Browser shutdown successfully.');
    this.removeAllListeners();
  }
}

module.exports = Crawler;
