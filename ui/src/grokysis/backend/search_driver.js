const ONE_HOUR_IN_MILLIS = 60 * 60 * 1000;

/**
 * Largely moot wrapper around searchfox queries, rendered obsolete as
 * enhancements have been made directly to the server.
 */
export default class SearchDriver {
  constructor({ treeName }) {
    this.treeName = treeName;
    this.cacheName = `sf-${this.treeName}`;

    this.cache = null;
    this._initCache();
  }

  async _initCache() {
    // There's no longer a need to cache things.
    this.cache = null; // await caches.open(this.cacheName);
  }

  /**
   * Very simple caching helper that naively caches everything and survives a
   * failure to open the cache in the first place.  Also supports a super
   * hacky mechanism where if the URL includes "NUKECACHE" in it, the cache
   * gets purged.
   *
   * For now, there's a very poor cache cleanup mechanism.  If we find a cached
   * match and it's too old, we delete it and then try and overwrite it with
   * the new result once it comes back.
   *
   * TODO: evaluate the contents of the cache at startup and evict based on
   * keys() as well.  NB: keys() based enumeration can cause massive explosions
   * if the cache has somehow ended up with a ton of entries.
   */
  async _cachingFetch(url, opts) {
    // super-hacky cache clearing without opening devtools like a sucker.
    if (this.cache && /NUKECACHE/.test(url)) {
      this.cache = null;
      await caches.delete(this.cacheName);
      this.cache = await caches.open(this.cacheName);
    }

    let matchResp;
    if (this.cache) {
      matchResp = await this.cache.match(url);
    }
    if (matchResp) {
      const dateHeader = matchResp.headers.get('date');
      if (dateHeader) {
        const ageMillis = Date.now() - new Date(dateHeader);
        if (ageMillis > ONE_HOUR_IN_MILLIS) {
          matchResp = null;
        }
      } else {
        // evict if we also lack a date header...
        matchResp = null;
      }

      if (!matchResp) {
        this.cache.delete(url);
      } else {
        return matchResp;
      }
    }

    const resp = await fetch(url, opts);
    if (this.cache) {
      this.cache.put(url, resp.clone());
    }

    return resp;
  }

  async performSearch({ searchStr }) {
    const params = new URLSearchParams();
    params.set('q', searchStr);
    params.set('case', 'false');
    params.set('regexp', 'false');
    params.set('path', '');
    const resp = await this._cachingFetch(
      `/${this.treeName}/sorch?${params.toString()}`,
      {
        headers: {
          'Accept': 'application/json'
        }
      }
    );
    const result = await resp.json();
    return result;
  }

  /**
   * Fetch a newline delimited JSON raw-analysis file from the backend.  We
   * fetch the body as text and munge it.
   */
  async fetchFile({ path }) {
    const url = `/${this.treeName}/raw-analysis/${path}`;

    const resp = await fetch(
      url,
    {
      headers: {
        'Accept': 'text/plain'
      }
    });
    const rawStr = await resp.text();
    const normalized = "[" + rawStr.replace(/\n\r?/g, ',\n').slice(0, -2) + "]";
    const data = JSON.parse(normalized);
    return data;
  }

  _processNewlineDelimitedStrings(str) {
    return str.split(/\n\r?/g);
  }

  async fetchTreeInfo() {
    const repoFileResp = await fetch(`/${this.treeName}/file-lists/repo-files`);
    const objdirFileResp = await fetch(`/${this.treeName}/file-lists/objdir-files`);

    return {
      repoFilesList: this._processNewlineDelimitedStrings(await repoFileResp.text()),
      objdirFilesList: this._processNewlineDelimitedStrings(await objdirFileResp.text()),
    };
  }
}
