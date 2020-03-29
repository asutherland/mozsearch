import EE from 'eventemitter3';

/**
 * Live-updating KnowledgeBase info about a file, although really it just
 * updates the once.
 */
export default class FileInfo extends EE {
  constructor({ path }) {
    super();

    this.serial = 0;

    this.path = path;

    const pathBits = path.split('/');
    // In cases where the path ends with a trailing slash, then the last path
    // segment will be empty.
    // XXX by default searchfox will favor not having a trailing slash, so we'll
    // need lookupSourceFile to normalize based on knowing what's a directory
    // so that we always use the trailing slash format.
    this.isDir = pathBits[pathBits.length - 1].length === 0;
    const sliceIndex = (this.isDir && pathBits.length > 1 ) ? -2 : -1;
    this.dirPath = pathBits.slice(0, sliceIndex).join('/');
    this.name = pathBits[pathBits.length + sliceIndex] +
      (this.isDir ? '/' : '');
    console.log('path', path, pathBits, sliceIndex);

    // these are externally manipulated by `ensureFileAnalysis`.
    this.analyzing = false;
    this.analyzed = false;

    /**
     * The set of SymbolInfo instances that are defined in this file.
     */
    this.fileSymbolDefs = new Set();
    this.fileSymbolDecls = new Set();

    /**
     * Array where each item corresponds to the zero-based line in the analyzed
     * file.  Each item is in turn its own array of objects of the form
     * { bounds, type, symInfo }.  Where:
     * - bounds is a searchfox search result array of the form [start, end] for
     *   offsets starting from the first non-whitespace character on the line.
     *   This is weird but our use-case is for efficiently mapping searchfox
     *   search results to the actual symbol in question, and the searchfox
     *   search results are optimized for display, with that bounds used for
     *   highlighting the search match in bold rather than anything semantic.
     * - type is going to be "use" or "def" probably.  It may even go away.
     * - symInfo is a link to the resolved SymbolInfo for the underlying symbol.
     *   Note that this Symbol will not have had analysis automatically run on
     *   it, it will be a stub.
     */
    this.lineToSymbolBounds = [];
    this.dataIndexToSymbolBounds = [];

    this.domLoading = false;
    /**
     * The #content node from the source file, if loaded.
     */
    this.domTree = null;
    /**
     * The ANALYSIS_DATA from the source file, if loaded.
     */
    this.fileAnalysisData = null;
    /**
     * The SYM_INFO from the source file, if loaded.
     */
    this.fileSymInfo = null;
  }

  markDirty() {
    this.serial++;
    this.emit('dirty');
  }
}
