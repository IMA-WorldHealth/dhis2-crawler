const Crawler = require('./lib/crawler');

async function processDashboard(crawler, dashboard, opts) {
  await crawler.goToDashboardById(dashboard.id, opts.delay);
  const result = {
    title: dashboard.name,
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

  // note: dashboards are objects of form [{ name, id }]
  async downloadDashboardComponents(dashboards, options = {}) {
    const files = [];

    // eslint-disable-next-line
    for (const board of dashboards) {
      // eslint-disable-next-line
      files.push(await processDashboard(this.crawler, board, options));
    }

    return files;
  }

  shutdown() {
    return this.crawler.destroy();
  }

  panic() {
    return this.crawler.destroy(true);
  }
}

module.exports = DHIS2Crawler;
