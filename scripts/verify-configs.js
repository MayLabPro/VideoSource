const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');
const files = ['input.json', 'lite.json', 'adult.json', 'full.json'];

function readJSON(fileName) {
  return JSON.parse(fs.readFileSync(path.join(rootDir, fileName), 'utf8'));
}

function getSites(config) {
  return Object.entries(config).filter(([, site]) => {
    return site && typeof site === 'object' && typeof site.api === 'string';
  });
}

function isAdultSite(site) {
  return String(site.name || '').trim().startsWith('🔞');
}

function assertFlatConfig(fileName, config) {
  if (Object.prototype.hasOwnProperty.call(config, 'api_site')) {
    throw new Error(`${fileName} must use the flat source map format, not api_site wrapper`);
  }

  const sites = getSites(config);
  if (!sites.length) {
    throw new Error(`${fileName} has no API sources`);
  }

  for (const [key, site] of sites) {
    if (!site.name || !site.api) {
      throw new Error(`${fileName}:${key} is missing name or api`);
    }
  }

  return sites;
}

function main() {
  const configs = Object.fromEntries(files.map((file) => [file, readJSON(file)]));
  const siteEntries = Object.fromEntries(
    Object.entries(configs).map(([file, config]) => [file, assertFlatConfig(file, config)])
  );

  const liteAdultCount = siteEntries['lite.json'].filter(([, site]) => {
    return isAdultSite(site);
  }).length;
  const adultNormalCount = siteEntries['adult.json'].filter(([, site]) => !isAdultSite(site)).length;

  const generatedCommentCount = ['lite.json', 'adult.json', 'full.json']
    .flatMap((file) => siteEntries[file])
    .filter(([, site]) => site._comment)
    .length;

  if (liteAdultCount > 0) {
    throw new Error('lite.json must not include adult sources');
  }

  if (adultNormalCount > 0) {
    throw new Error('adult.json must include only adult sources');
  }

  if (generatedCommentCount > 0) {
    throw new Error('generated files must not include _comment fields');
  }

  const expectedFull = {
    ...configs['lite.json'],
    ...configs['adult.json'],
  };
  const expectedFullText = JSON.stringify(expectedFull);
  const actualFullText = JSON.stringify(configs['full.json']);

  if (expectedFullText !== actualFullText) {
    throw new Error('full.json must equal lite.json + adult.json');
  }

  for (const file of files) {
    console.log(`${file}: ${siteEntries[file].length} sources`);
  }
}

main();
