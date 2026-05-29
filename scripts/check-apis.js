const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');

const rootDir = path.resolve(__dirname, '..');
const configPath = path.join(rootDir, 'input.json');
const reportPath = path.join(rootDir, 'report.md');
const outputFiles = {
  lite: path.join(rootDir, 'lite.json'),
  adult: path.join(rootDir, 'adult.json'),
  full: path.join(rootDir, 'full.json'),
};

const DEFAULT_KEYWORD = '你好';
const keyword = process.argv[2] || process.env.SEARCH_KEYWORD || DEFAULT_KEYWORD;
const timeoutMs = Number(process.env.API_TIMEOUT_MS || 10000);
const concurrency = Number(process.env.API_CONCURRENCY || 10);
const retries = Number(process.env.API_RETRIES || 2);

function readJSON(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function getSiteEntries(config) {
  return Object.entries(config).filter(([, site]) => {
    return site && typeof site === 'object' && typeof site.api === 'string';
  });
}

function isAdultSite(site) {
  return String(site.name || '').trim().startsWith('🔞');
}

function cleanSite(site) {
  const cleaned = {};
  for (const [key, value] of Object.entries(site)) {
    if (key !== '_comment') {
      cleaned[key] = value;
    }
  }
  return cleaned;
}

function writeJSON(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function escapeMarkdown(value) {
  return String(value ?? '')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, ' ');
}

function requestJSON(url) {
  return new Promise((resolve) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch (error) {
      resolve({ ok: false, status: 0, error: `Invalid URL: ${error.message}` });
      return;
    }

    const client = parsed.protocol === 'http:' ? http : https;
    const req = client.get(parsed, {
      headers: {
        accept: 'application/json,text/plain,*/*',
        'user-agent': 'VideoSource-API-Checker/1.0',
      },
      timeout: timeoutMs,
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        let data = null;
        try {
          data = body ? JSON.parse(body) : null;
        } catch {}

        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode || 0,
          data,
        });
      });
    });

    req.on('timeout', () => {
      req.destroy(new Error(`Timeout after ${timeoutMs}ms`));
    });

    req.on('error', (error) => {
      resolve({ ok: false, status: 0, error: error.message });
    });
  });
}

async function requestWithRetry(url) {
  let lastResult;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    lastResult = await requestJSON(url);
    if (lastResult.ok) {
      return lastResult;
    }
  }
  return lastResult;
}

function getSearchURL(api, wd) {
  const separator = api.includes('?') ? '&' : '?';
  return `${api}${separator}wd=${encodeURIComponent(wd)}`;
}

function inspectSearchResult(result, wd) {
  if (!result.ok) {
    return {
      status: 'failed',
      text: result.error || `HTTP ${result.status}`,
    };
  }

  const list = result.data && Array.isArray(result.data.list) ? result.data.list : [];
  if (!list.length) {
    return {
      status: 'empty',
      text: '无结果',
    };
  }

  const matched = list.some((item) => JSON.stringify(item).includes(wd));
  return {
    status: matched ? 'matched' : 'returned',
    text: matched ? '命中' : '有结果',
  };
}

async function checkSite(site) {
  const started = Date.now();
  const probe = await requestWithRetry(site.api);
  const search = await requestWithRetry(getSearchURL(site.api, keyword));
  const elapsedMs = Date.now() - started;
  const searchResult = inspectSearchResult(search, keyword);

  return {
    key: site.key,
    name: site.name,
    api: site.api,
    comment: site._comment || '',
    source: site.source,
    adult: isAdultSite(site),
    ok: probe.ok,
    httpStatus: probe.status,
    searchStatus: searchResult.status,
    searchText: searchResult.text,
    elapsedMs,
    error: probe.ok ? '' : (probe.error || `HTTP ${probe.status}`),
  };
}

async function runQueue(items, limit, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function runWorker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index], index);
      const status = results[index].ok ? 'OK' : 'FAIL';
      console.log(`[${index + 1}/${items.length}] ${status} ${results[index].name}`);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, runWorker);
  await Promise.all(workers);
  return results;
}

function buildOutputConfigs(results) {
  const lite = {};
  const adult = {};

  for (const result of results) {
    if (!result.ok) continue;

    if (result.adult) {
      adult[result.key] = cleanSite(result.source);
    } else {
      lite[result.key] = cleanSite(result.source);
    }
  }

  return {
    lite,
    adult,
    full: {
      ...lite,
      ...adult,
    },
  };
}

function createReport(results, outputConfigs) {
  const now = new Date().toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const okCount = results.filter((item) => item.ok).length;
  const failedCount = results.length - okCount;
  const searchMatched = results.filter((item) => item.searchStatus === 'matched').length;
  const availability = results.length ? ((okCount / results.length) * 100).toFixed(1) : '0.0';
  const inputAdultCount = results.filter((item) => item.adult).length;
  const inputLiteCount = results.length - inputAdultCount;

  const lines = [
    '# API 检测报告',
    '',
    `最近更新: ${now} Asia/Shanghai`,
    '',
    `检测关键词: ${keyword}`,
    '',
    `总源数: ${results.length}`,
    `可用源数: ${okCount}`,
    `失败源数: ${failedCount}`,
    `可用率: ${availability}%`,
    `搜索命中: ${searchMatched}`,
    `普通源输入/通过: ${inputLiteCount}/${Object.keys(outputConfigs.lite).length}`,
    `成人源输入/通过: ${inputAdultCount}/${Object.keys(outputConfigs.adult).length}`,
    '',
    '| 状态 | 分组 | 名称 | HTTP | 搜索 | 耗时(ms) | 备注 | API |',
    '| --- | --- | --- | ---: | --- | ---: | --- | --- |',
  ];

  const sorted = [...results].sort((a, b) => {
    if (a.ok !== b.ok) return a.ok ? 1 : -1;
    return a.name.localeCompare(b.name, 'zh-CN');
  });

  for (const item of sorted) {
    const status = item.ok ? 'OK' : 'FAIL';
    const group = item.adult ? 'adult' : 'lite';
    const apiLink = `[Link](${item.api})`;
    const note = item.comment || item.error || '';
    lines.push(`| ${status} | ${group} | ${escapeMarkdown(item.name)} | ${item.httpStatus || '-'} | ${escapeMarkdown(item.searchText)} | ${item.elapsedMs} | ${escapeMarkdown(note)} | ${apiLink} |`);
  }

  lines.push('');
  lines.push('## 生成文件');
  lines.push('');
  lines.push(`- \`lite.json\`: 检测通过的普通源，共 ${Object.keys(outputConfigs.lite).length} 个`);
  lines.push(`- \`adult.json\`: 检测通过的成人源，共 ${Object.keys(outputConfigs.adult).length} 个`);
  lines.push(`- \`full.json\`: \`lite.json\` + \`adult.json\` 汇总，共 ${Object.keys(outputConfigs.full).length} 个`);
  lines.push('');
  lines.push('所有生成文件均为扁平源映射结构，与 `input.json` 一致。');
  lines.push('');
  lines.push('## 原始摘要');
  lines.push('');
  lines.push('```json');
  lines.push(JSON.stringify({
    generated_at: now,
    keyword,
    total: results.length,
    ok: okCount,
    failed: failedCount,
    search_matched: searchMatched,
    lite: Object.keys(outputConfigs.lite).length,
    adult: Object.keys(outputConfigs.adult).length,
    full: Object.keys(outputConfigs.full).length,
  }, null, 2));
  lines.push('```');
  lines.push('');

  return lines.join('\n');
}

async function main() {
  const config = readJSON(configPath);
  const sites = getSiteEntries(config).map(([key, site]) => ({
    key,
    ...site,
    source: site,
  }));

  if (!sites.length) {
    throw new Error('input.json 中没有可检测的 API 源配置');
  }

  console.log(`开始检测 ${sites.length} 个 API，关键词: ${keyword}`);
  const results = await runQueue(sites, concurrency, checkSite);
  const outputConfigs = buildOutputConfigs(results);
  writeJSON(outputFiles.lite, outputConfigs.lite);
  writeJSON(outputFiles.adult, outputConfigs.adult);
  writeJSON(outputFiles.full, outputConfigs.full);
  console.log(`已生成 lite.json(${Object.keys(outputConfigs.lite).length}), adult.json(${Object.keys(outputConfigs.adult).length}), full.json(${Object.keys(outputConfigs.full).length})`);

  const report = createReport(results, outputConfigs);
  fs.writeFileSync(reportPath, report, 'utf8');
  console.log(`报告已生成: ${reportPath}`);

  const failedCount = results.filter((item) => !item.ok).length;
  if (failedCount > 0) {
    console.log(`检测完成: ${failedCount} 个源不可用。报告已记录，工作流继续提交结果。`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
