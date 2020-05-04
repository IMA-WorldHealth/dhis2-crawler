const Crawler = require('./lib/crawler');

async function processDashboard(crawler, name, opts) {
  await crawler.goToDashboardByName(name, opts.delay);
  const result = {
    title: name,
  };

  if (!opts.skipGraphs) {
    const graphs = await crawler.gatherSvgsFromDashboard();
    result.graphs = graphs;
  }

  if (!opts.skipTables) {
    const tables = await crawler.gatherTablesFromDashboard();
    result.tables = tables;
  }

  return result;
}

class DHIS2Crawler {
  constructor(url) {
    this.url = url;
  }

  startup(options) {
    this.crawler = new Crawler(options);
    this.on = this.crawler.on.bind(this.crawler);
    return this.crawler.initialize();
  }

  login(username, password) {
    this.crawler.setCredentials({ username, password });
    return this.crawler.login(this.url);
  }

  async downloadDashboardComponents(dashboards, options = {}) {
    const boards = [].concat(dashboards);

    const files = [];
    // eslint-disable-next-line
    for (const board of boards) {
      // eslint-disable-next-line
      files.push(await processDashboard(this.crawler, board, options));
    }

    return files;
  }

  shutdown() {
    this.crawler.removeAllListeners();
    return this.crawler.destroy();
  }

  panic() {
    this.crawler.removeAllListeners();
    return this.crawler.destroy(true);
  }
}

module.exports = DHIS2Crawler;
