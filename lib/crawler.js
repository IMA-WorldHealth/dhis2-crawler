/* global svgAsDataUri html2canvas */
const puppeteer = require('puppeteer-core');
const delay = require('delay');
const debug = require('debug')('dhis2-crawler');
const path = require('path');
const EventEmitter = require('events');

const HTML_2_CANVAS_BASE = require.resolve('html2canvas').split('npm')[0];
const HTML_2_CANVAS_PATH = path.join(HTML_2_CANVAS_BASE, 'html2canvas.min.js');
const SAVE_SVG_AS_PNG_PATH = require.resolve('save-svg-as-png');

const seconds = 1000;

const SHORT_NETWORK_OPTS = {
  waitUntil: 'networkidle2',
  timeout: 300 * seconds,
};

const DEFAULT_OPTIONS = {
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
  executablePath: '/usr/bin/chromium-browser',
};

function convertSvgChartsIntoDataUris(charts) {
  return Promise.all(
    charts.map(chart => new Promise(resolve => svgAsDataUri(chart, {}, uri => resolve(uri)))),
  );
}

function convertTablesIntoDataUris(tables) {
  return Promise.all(tables.map((table) => {
    let label;
    try {
      label = table.parentElement.childNodes[0].textContent;
    } catch (error) {
      return Promise.reject(error);
    }

    return html2canvas(table, { scale: 3 })
      .then(canvas => ({ label, uri: canvas.toDataURL() }));
  }));
}

class Crawler extends EventEmitter {
  constructor(options = {}) {
    super();
    this.options = Object.assign({}, DEFAULT_OPTIONS, options);
    this.on('event', debug);
  }

  async initialize() {
    this.emit('event', 'Spinning up headless Google Chrome to render the DHIS2 site.');
    const options = Object.assign({}, this.options);
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

    const btn = await this.page.$('input[type=submit]');
    await btn.click();

    this.emit('event', 'Credentials submitted.  Waiting for dashboad pages to load.');
  }

  // For some reason, the developers removed the ids from the dashboards.
  async generateIdForTextNode(text) {
    const ident = `db-${Date.now()}`;

    await this.page.evaluate(
      (txt, uid) => window.$(`.d2-ui-control-bar-contents span:contains("${txt}")`).prop('id', uid),
      text,
      ident,
    );

    return ident;
  }

  async goToDashboardByName(name, _delay = 10) {
    this.emit('event', `Navigating to find dashboard ${name}.`);
    await delay(_delay * seconds);
    const nodeId = await this.generateIdForTextNode(name);
    this.emit('event', `Clicking dashboard with ID ${nodeId}`);
    await this.page.click(`#${nodeId}`);
    await delay(_delay * seconds);
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

    const tables = await this.page.$$eval('table.pivot', convertTablesIntoDataUris);
    this.emit('event', `Pulled ${tables.length} tables from the dashboard.`);
    return tables;
  }

  async destroy() {
    this.emit('event', 'All dashboards downloaded. Closing the browser.');
    await this.browser.close();
    this.emit('event', 'Browser shutdown successfully.');
  }
}

module.exports = Crawler;
