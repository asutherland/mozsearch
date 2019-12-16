function findNonWS(str) {
  const l = str.length;
  for (let i=0; i < l; i++) {
    if (str.charCodeAt(i) !== 0x20) {
      return i;
    }
  }

  return -1;
}

function stripPrettyTypePrefix(prefixedPretty) {
  const idxSpace = prefixedPretty.indexOf(' ');
  if (idxSpace === -1) {
    throw new Error('you got jumps and searches confused again');
  }
  return prefixedPretty.substring(idxSpace + 1);
}

/**
 * We could have a list of searches where one is a type and one is the
 * constructor.  For the given search entry we pick, that could have multiple
 * comma-delimited symbols where the first one is the most specific symbol and
 * the subsequent symbols are the symbols that our symbol overrides.  Or other
 * related stuff... either way the point is we're going to pick the first of
 * everything for now and look into things later on when they don't work.
 */
function pickBestSymbolFromSearches(searches) {
  if (!searches.length) {
    return null;
  }
  const bestSearch = searches[0];
  const symStr = bestSearch.sym;
  if (!symStr) {
    return null;
  }
  if (symStr.indexOf(',') !== -1) {
    return symStr.split(',', 1)[0];
  }
  return symStr;
}

export default class FileAnalyzer {
  constructor(kb) {
    this.kb = kb;
  }

  /**
   * Given the raw analysis data for a file, identify all the definitions in the
   * file and perform symbol lookups for them.  (Although the contents of the
   * file constitute much of the useful authoritative data for the symbol, we
   * also potentially need the "decl" nodes which may live in hard-to-guess
   * places and the results of the cross-referencing process.)
   *
   * For reasons of sanity[1], this mechanism currently only lets one symbol
   * analysis be outstanding at a time, but some level of pipelining would
   * likely make sense in the short term.  That said, in the medium term, it's
   * likely this method should be superseded by more intentional, targeted
   * lookup clusters that can be efficiently cached by the server.  Right now,
   * file and directory analysis is a crutch to make the life of exploratory
   * graph doodlers easier.
   *
   * 1: Specifically:
   * - Things run in the main thread, we don't want to lock up the main thread.
   *   - I like to be able to close the page or ctrl-r if I mess up, and I
   *     mess up a lot.
   * - The production servers basically can only handle 2 requests in parallel
   *   anyways.
   */
  async analyzeFile(finfo, data, analyzeHopsInclusiveForSymbols) {
    const kb = this.kb;

    for (const rec of data) {
      // Skip target records.
      if (!rec.source) {
        continue;
      }
      // We've got a source record, hooray!

      // This may absolutely have multiple symbols, normalize to the first for
      // now with the presumption it's the most specific one.
      const symName = kb.normalizeSymbol(rec.sym, true);

      // XXX we could provide the path info?
      const symInfo = kb.lookupRawSymbol(symName, 0);
      await kb.ensureSymbolAnalysis(symInfo, analyzeHopsInclusiveForSymbols);
    }

    return finfo;
  }
}
