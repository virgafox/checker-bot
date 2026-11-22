'use strict';

// Routes each checker to the fetcher of its FETCH_MODE.
// fetchers: { http: checker => Promise<html>, browser?: checker => Promise<html> }.
// All requests go through `schedule` (the shared request queue), whatever the mode.
function createFetcher({ fetchers, schedule = task => task(), log = () => {} }) {
  return async function fetchHtml(checker) {
    const mode = checker.fetchMode || 'http';
    const fetch = fetchers[mode];
    if (!fetch) throw new Error(`No fetcher available for FETCH_MODE "${mode}" (checker "${checker.name}")`);
    log(`[${checker.name}] Getting HTML (${mode}): ${checker.url}`);
    const html = await schedule(() => fetch(checker));
    log(`[${checker.name}] Got HTML`);
    return html;
  };
}

module.exports = { createFetcher };
