/* global svgAsDataUri html2canvas */
const puppeteer = require('puppeteer-core');
const delay = require('delay');
const debug = require('debug')('dhis2-crawler');
const path = require('path');

const HTML_2_CANVAS_PATH = path.resolve(__dirname, '../node_modules/html2canvas/dist/html2canvas.min.js');
const SAVE_SVG_AS_PNG_PATH = path.resolve(__dirname, '../node_modules/save-svg-as-png/lib/saveSvgAsPng.js');

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

class Crawler {
  constructor(options = {}) {
    this.options = Object.assign({}, DEFAULT_OPTIONS, options);
  }

  async initialize() {
    const options = Object.assign({}, this.options);
    this.browser = await puppeteer.launch(options);
    [this.page] = await this.browser.pages();
    this.page.on('pageerror', err => debug('An error occurred in page: %j', err));
    await this.page.emulateMedia('screen');
  }

  setCredentials(credentials) {
    this.credentials = credentials;
  }

  async login(webpage) {
    debug(`Fetching login page ${webpage}.`);
    await this.page.goto(webpage, SHORT_NETWORK_OPTS);

    debug(`Page retrieved.  Logging in as ${this.credentials.username}.`);
    const username = await this.page.$('input[id=j_username]');
    await username.type(this.credentials.username, { delay: 5 });

    const password = await this.page.$('input[id=j_password]');
    await password.type(this.credentials.password, { delay: 5 });

    const btn = await this.page.$('input[type=submit]');
    await btn.click();

    debug('Credentials submitted.');
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

  async goToDashboardByName(name) {
    await delay(10 * seconds);
    const nodeId = await this.generateIdForTextNode(name);
    await this.page.click(`#${nodeId}`);
    await delay(10 * seconds);
  }

  async gatherSvgsFromDashboard() {
    await this.page.addScriptTag({ path: SAVE_SVG_AS_PNG_PATH });

    debug('Fetching SVG graphs from the dashboard.');
    const svgs = await this.page.$$eval('svg.highcharts-root', convertSvgChartsIntoDataUris);
    debug(`Pulled ${svgs.length} graphs from the dashboard.`);
    return svgs;
  }

  async gatherTablesFromDashboard() {
    await this.page.addScriptTag({ path: HTML_2_CANVAS_PATH });

    debug('Fetching pivot tables from the dashboard.');
    const tables = await this.page.$$eval('table.pivot', convertTablesIntoDataUris);
    debug(`Pulled ${tables.length} tables from the dashboard.`);
    return tables;
  }

  async destroy() {
    await this.browser.close();
    debug('browser destroyed.');
  }
}

module.exports = Crawler;
