const Crawler = require('./lib/crawler');

async function processDashboard(crawler, name, opts) {
  await crawler.goToDashboardByName(name);
  const result = {};

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
    return this.crawler.initialize();
  }

  login(username, password) {
    this.crawler.setCredentials({ username, password });
    return this.crawler.login(this.url);
  }

  async downloadDashboardComponents(dashboards, options = {}) {
    const boards = [].concat(dashboards);

    const files = await Promise.all(
      boards.map(name => processDashboard(this.crawler, name, options)),
    );

    return files;
  }

  shutdown() {
    return this.crawler.destroy();
  }
}

module.exports = DHIS2Crawler;
