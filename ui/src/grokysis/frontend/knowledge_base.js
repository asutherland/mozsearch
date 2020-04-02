import FileAnalyzer from './kb/file_analyzer.js';
import FileInfo from './kb/file_info.js';
import SymbolAnalyzer from './kb/symbol_analyzer.js';
import SymbolInfo from './kb/symbol_info.js';

import ClassDiagram from './diagramming/class_diagram.js';

import HierarchyDoodler from './diagramming/hierarchy_doodler.js';
import InternalDoodler from './diagramming/internal_doodler.js';
import PathsBetweenDoodler from './diagramming/paths_between_doodler.js';
import TransitiveCallDoodler from './diagramming/transitive_calls_doodler.js';

/// This serves as a limit on in-edge processing for uses.  If we see that we
/// have uses across more than this many file hits for uses, then we don't
/// process uses for the given node.  There can still be a ton of uses within
/// these files!  This is mainly just a heuristic to get tripped up by utility
/// functions.
const MAX_USE_PATHLINES_LIMIT = 32;
/// How many subclasses is too many before we decide that traversal should be
/// forbidden?
const EXCESSIVE_SUBCLASSES = 16;

const ONLY_PLATFORM = ['Only Platform'];

/**
 * Check if two (inclusive start offset, exclusive end offset) ranges intersect.
 */
function boundsIntersect(a, b) {
  // They don't intersect if the first range ends before the second range starts
  // OR the first range ends after the second range ends.
  if (a[1] <= b[0] ||
      a[0] >= b[1]) {
    return false;
  }
  return true;
}

/**
 * Hand-waving source of information that's not spoon-fed to us by searchfox or
 * lower level normalization layers.  This means a home for:
 * - higher level analysis that should migrate into searchfox proper once
 *   understood and justified by utility.
 * - weird hacky heuristics
 * - stuff the user told us
 *
 * It's likely that much of this logic should be pushed into the back-end, but
 * for now the split is that the backend is used for deterministic request/reply
 * semantics and this class and its helpers are where state aggregation and
 * snooping-with-side-effects happens.
 *
 * We provide for the following known facts:
 *
 * The following facts are planned to be extracted:
 * - Thread-in-use: Determined by heuristics based on assertions or from hacky
 *   external toml config files.
 *
 * ### Exposed public API
 *
 * The following methods are expected to be used in the following ways by the
 * UI:
 * - lookupRawSymbol: Used when clicking on a syntax-highlighted searchfox
 *   symbol.  Although we plan to have the SymbolInfo at the time of HTML
 *   generation, it doesn't seem worth retaining/entraining.
 *
 */
export default class KnowledgeBase {
  constructor({ treeName, grokCtx, iframeParentElem }) {
    this.treeName = treeName;
    this.grokCtx = grokCtx;

    this.iframeParentElem = iframeParentElem;

    /**
     * Maps from a (pretty) id to the Set of symbols known to correspond to that
     * id.  For now, populated only by `findSymbolsGivenId` which caches to this
     * dictionary.  Entries will only exist for positive results.  Negative
     * results are cached in `knownNonIds`.
     */
    this.idToSymbols = new Map();


    this.knownNonIds = new Set();

    /**
     * SymbolInfo instances by their raw (usually) manged name.  There is
     * exactly one SymbolInfo per raw name.  Compare with pretty symbols which,
     * in searchfox, discard the extra typeinfo like method override variants,
     * and so for which there can be multiple symbols.
     */
    this.symbolsByRawName = new Map();

    /**
     * Set of FileInfo instances currently underoing analysis.  Primarily
     * intended as a debugging aid.
     */
    this.analyzingFiles = new Set();

    /**
     * FileInfo instances by their path relative to the root of the source dir.
     * Currently, it's really just C++ files that can be analyzed, so most other
     * file types will get stubs.
     */
    this.filesByPath = new Map();

    this.fileAnalyzer = new FileAnalyzer(this);
    this.symbolAnalyzer = new SymbolAnalyzer(this);

    this.treeInfo = null;
    window.setTimeout(() => { this._loadTreeInfo(); }, 0);

    /**
     * The maximum number of edges something can have before we decide that
     * we're not going to traverse the edges.  The concern is that nothing good
     * can come of automatically fetching information on every symbol that uses
     * RefPtr.
     */
    this.EDGE_SANITY_LIMIT = 32;
  }

  /**
   * If symStr is a comma-delimited list of symbols, return the first symbol.
   * Callers should indicate whether they're intentionally doing this by passing
   * true for `commaExpected`.
   *
   * Searchfox "source" records contain a symbol and the union of its
   * cross-platform variants plus any superclass methods that it's overriding.
   * (Whereas target records have one symbol per target record, so we can think
   * of the source record as containing the union of all the target records for
   * that source token.)  This is a byproduct of the initial indexer output plus
   * the cross-platform merge logic.
   */
  normalizeSymbol(symStr, commaExpected) {
    if (!symStr) {
      return null;
    }
    if (symStr.indexOf(',') !== -1) {
      if (!commaExpected) {
        // Get a backtrace so we can figure out who is doing this.
        console.error('Caller passed comma-delimited symbol name:', symStr);
      }
      return symStr.split(',', 1)[0];
    }
    return symStr;
  }

  async _loadTreeInfo() {
    this.treeInfo = await this.grokCtx.fetchTreeInfo();
  }

  /**
   * Given raw search results, process each "semantic" entry.
   */
  async __processRawSearchResults(raw, traversalMode) {
    const resultSet = new Set();
    for (const [rawName, rawSymInfo] of Object.entries(raw.semantic || {})) {
      let symInfo = this.symbolsByRawName.get(rawName);
      if (symInfo) {
        resultSet.add(symInfo);

        this.symbolAnalyzer.injectCrossrefData(symInfo, rawSymInfo);
        if (traversalMode) {
          await this.symbolAnalyzer.ensureSymbolAnalysis(symInfo, traversalMode);
        }
        continue;
      }

      symInfo = new SymbolInfo({ rawName });
      this.symbolsByRawName.set(rawName, symInfo);

      this.symbolAnalyzer.injectCrossrefData(symInfo, rawSymInfo);
      if (traversalMode) {
        await this.symbolAnalyzer.ensureSymbolAnalysis(symInfo, traversalMode);
      }

      resultSet.add(symInfo);
    }

    return resultSet;
  }

  /**
   * __processRawSearchResults but results are returned synchronously with any
   * async traversals initiated without waiting for the results.  This probably
   * wants to be unified and cleaned up...
   */
  __syncProcessRawSearchResults(raw, traversalMode) {
    const resultSet = new Set();
    for (const [rawName, rawSymInfo] of Object.entries(raw.semantic || {})) {
      let symInfo = this.symbolsByRawName.get(rawName);
      if (symInfo) {
        resultSet.add(symInfo);

        this.symbolAnalyzer.injectCrossrefData(symInfo, rawSymInfo);
        if (traversalMode) {
          this.symbolAnalyzer.ensureSymbolAnalysis(symInfo, traversalMode);
        }
        continue;
      }

      symInfo = new SymbolInfo({ rawName });
      this.symbolsByRawName.set(rawName, symInfo);

      this.symbolAnalyzer.injectCrossrefData(symInfo, rawSymInfo);
      if (traversalMode) {
        this.symbolAnalyzer.ensureSymbolAnalysis(symInfo, traversalMode);
      }

      resultSet.add(symInfo);
    }

    return resultSet;
  }

  /**
   * Basically just a caching exact "id" search for now.
   */
  async findSymbolsGivenId(id) {
    if (this.idToSymbols.has(id)) {
      return this.idToSymbols.get(id);
    }

    if (this.knownNonIds.has(id)) {
      return null;
    }

    const filteredResults =
      await this.grokCtx.performAsyncSearch(`id:${id}`);

    const raw = filteredResults.rawResultsList[0].raw;

    const resultSet = this.__processRawSearchResults(raw, 'context');

    if (resultSet.size) {
      this.idToSymbols.set(id, resultSet);
      return resultSet;
    }

    this.knownNonIds.add(id);
    return null;
  }

  /**
   * Given its raw symbol name, synchronously return a SymbolInfo that will
   * update as more information is gained about it.
   *
   * The lookup request can involve an `analysisMode`.  If one isn't provided,
   * then the current information known about the symbol is returned, which may
   * only be the raw symbol name.
   *
   * Analysis is all about deciding what symbol-lookups to perform on the
   * server.  For any given symbol, the crossref database tells us any
   * structured information we know about the symbol as well as the locations
   * of defs/decls/uses/other.  For this information to be useful, we often
   * want to know about other symbols referenced by the search results.  For
   * example, we usually would want the structured information about all of a
   * class's superclasses, which means we want to perform lookups on their
   * crossref data.
   *
   * Analysis is also about deciding what lookups not to perform.  Naively
   * traversing all edges from symbols will quickly result in an attempt to
   * pull in every symbol in the codebase.
   *
   * TODO: Refactor analysis into 3-stage approach:
   * 1. Get the search data for the symbol and save it off.
   * 2. Perform population of the SymbolInfo, invoking lookup directly.
   * 3. Process any analysis bits which use a structured list of helpers that
   *    return a list of symbols to perform further processing on, and the
   *    appropriate analysis bits for those symbols.  (Under the current regime
   *    this would involve direct calls to lookupRawSymbol, but the indirection
   *    is useful for debugging and testing, plus potentially assists in
   *    prioritization.)
   *
   * @param {String} [prettyName]
   * @param opts.analysisMode
   *   One of the following modes:
   *   - 'context': This is an initiating symbol and the goal is to know about
   *     the symbol's position in the type hierarchy plus local control flow.
   *   - 'file': The symbol is being looked up because we got a list of all of
   *     the symbols in a file somehow and want more details on them.  No
   *     unbounded traversal should happen.
   *   - 'parent': The symbol is being looked up because of its parent.  No
   *     unbounded traversal should happen.
   *   - 'super': The initiating symbol wants to know about its superclasses.
   *     All analysis traversals should be strictly up the super chain.
   *   - 'subclasses': The initiating symbol wants to know about its subclasses.
   *     All analysis traversals should be strictly down the subclass chain and
   *     should be prepared for overload.
   */
  lookupRawSymbol(rawName, opts={}) {
    const { prettyName } = opts;

    rawName = this.normalizeSymbol(rawName); // deal with comma-delimited symbols.

    let symInfo = this.symbolsByRawName.get(rawName);
    if (symInfo) {
      if (prettyName && !symInfo.prettyName) {
        symInfo.updatePrettyNameFrom(prettyName);
      }
    } else {
      symInfo = new SymbolInfo({
        rawName, prettyName,
        // propagate hints for the source through.
        somePath: opts && opts.somePath,
        headerPath: opts && opts.headerPath,
        sourcePath: opts && opts.sourcePath,
        semanticKind: opts && opts.semanticKind,
      });
      this.symbolsByRawName.set(rawName, symInfo);
    }

    if (opts.analysisMode) {
      this.symbolAnalyzer.ensureSymbolAnalysis(symInfo, opts.analysisMode);
    }

    return symInfo;
  }

  /**
   * Synchronously lookup the given source file, creating it if it does not
   * exist, and optionally initiating async analysis via `ensureFileAnalysis`.
   */
  lookupSourceFile(path, { analyze, considerHeaderFile, loadDom }) {
    let fi = this.filesByPath.get(path);
    if (!fi) {
      fi = new FileInfo({ path });
      this.filesByPath.set(path, fi);
    }

    if (analyze && !fi.analyzed && !fi.analyzing) {
      this.ensureFileAnalysis(fi, considerHeaderFile);
    }
    if (loadDom && !fi.domTree && !fi.domLoading) {
      this._loadFileDom(fi);
    }

    return fi;
  }

  /**
   * Trigger the async loading of a source page, resulting in
   * `fileInfo.domTree` being populated with a same-document DOM node
   * corresponding to the #content element in the file.  Its `fileAnalysisData`
   * and `fileSymInfo` will also be initialized with the iframe's
   * `ANALYSIS_DATA` and `SYM_INFO` globals, which are part of the payload
   * script tag (which will be removed from #content element).
   *
   * TODO: Probably a good idea to verify the file exists before doing this.
   */
  async _loadFileDom(fileInfo) {
    fileInfo.domLoading = true;

    const ifr = document.createElement('iframe');
    const loadPromise = new Promise((resolve) => {
      ifr.addEventListener('load', resolve, { once: true });
    });
    ifr.src = `/${this.treeName}/source/${fileInfo.path}`;
    this.iframeParentElem.appendChild(ifr);
    await loadPromise;

    const idoc = ifr.contentDocument;
    const iwin = ifr.contentWindow;

    fileInfo.fileAnalysisData = iwin.ANALYSIS_DATA;
    fileInfo.fileSymInfo = iwin.SYM_INFO;

    const icontent = idoc.getElementById('content');
    // Remove the script tag that gave us those cool globals.
    const byeScript = icontent.querySelector('script');
    // Noting that the script isn't present for directory listings...
    if (byeScript) {
      byeScript.parentNode.removeChild(byeScript);
    }

    fileInfo.domTree = document.adoptNode(icontent);
    this.iframeParentElem.removeChild(ifr);

    fileInfo.markDirty();
  }

  /**
   * Asynchronously analyze a file by grabbing the raw analysis data from the
   * server and finding all "source" "def" records.  (Noting that "def" is
   * expressed in the "syntax" list for "source" records, it's only exposed as
   * "kind" for "target" records.  But we pick "source" because it )
   */
  async ensureFileAnalysis(fi, considerHeaderFile) {
    // XXX So the new file-analysis logic works okay on its own, but it
    // exacerbates problems in ensureSymbolAnalysis being naive about what
    // edges to traverse.  I've hacked a "uses" failsafe into place, which may
    // help, but some more thought should be given to re-enabling.
    return fi;
/*
    if (fi.analyzed) {
      return fi;
    }
    if (fi.analyzing) {
      return fi.analyzing;
    }

    fi.analyzing = this._analyzeFile(fi);
    this.analyzingFiles.add(fi);

    if (considerHeaderFile && /\.cpp$/.test(fi.path)) {
      const headerPath = fi.path.replace(/\.cpp$/, '.h');
      if (this.treeInfo && this.treeInfo.repoFiles.has(headerPath)) {
        this.lookupSourceFile(headerPath, true, false);
      }
    }

    await fi.analyzing;

    //await fi.analyzing;
    fi.analyzing = false;
    fi.analyzed = true;
    this.analyzingFiles.delete(fi);
    fi.markDirty();

    return fi;
*/
  }

  /**
   * Asynchronously analyze a symbol by performing a search (at most once) and
   * processing its results.  Additionally, the analysis can recursively analyze
   * other discovered symbols to a maximum depth of `analyzeHops`.
   *
   * The recursive hops mechanism was originally essential because in order to
   * know the type of a linked symbol we needed to search it.  That information
   * is now direclty available as part of the search.  Using hops is still
   * potentially useful for graph-drawing logic.  (Although graph drawing logic
   * would usually also want some other means of loading symbols, such as
   * locating all the members of a class or all the symbols in a compilation
   * unit.)
   */
  ensureSymbolAnalysis(symInfo, { analysisMode }) {
    return this.symbolAnalyzer.ensureSymbolAnalysis(symInfo, analysisMode);
  }

  /**
   * Derive new SymbolInfo instances with their `canonVariant` set to `symInfo`
   * from the symInfo's `__crossrefData.variants` data, if present.  The new
   * SymbolInfo instances are not put in any global lookup, they are only
   * accessible via `symInfo.variants`.  There's somewhat of an invariant here
   * that this is appropriate because the variants by definition have the same
   * symbol name as the symbol they were merged with, so they don't need a
   * (colliding) lookup entry.
   */
  __processVariants(symInfo) {
    // Nothing to do if this is already a variant or if the symbol has no
    // variants.
    if (symInfo.canonVariant ||
        !symInfo.rawMeta ||
        !symInfo.rawMeta.variants ||
        !symInfo.rawMeta.variants.length) {
      return;
    }

    const variants = symInfo.variants = [];
    for (const variantMeta of symInfo.rawMeta.variants) {
      const varSymInfo = new SymbolInfo({
        rawName: symInfo.varName,
        prettyName: symInfo.fullName,
      });
      varSymInfo.canonVariant = symInfo;
      const variantData = {
        consumes: [],
        hits: {},
        meta: variantMeta
      };
      // We do need to propagate a limited amount of data into the meta; kind
      // and pretty get left out.
      variantMeta.pretty = symInfo.rawMeta.pretty;
      variantMeta.kind = symInfo.rawMeta.kind;
      this.symbolAnalyzer.injectCrossrefData(varSymInfo, variantData);
      variants.push(varSymInfo);
    }
  }

  /**
   * Given the raw semantic info returned from a sorch that matches a symbol,
   * process it into the given symbol.
   */
  _processSymbolRawSymInfo(symInfo, rawSymInfo) {
    symInfo.__crossrefData = rawSymInfo;

    // ## Consume "meta" data
    // XXX Currently, "use" links do not include an explicit "kind".  It may
    // make sense to explicitly include this when building the crossref
    // database.  Our interest in this JS logic is for building a call-graph,
    // however, and there's a cheap heuristic that's possible here.  Which is
    // that if this current symbol that we are is callable, then presumably any
    // use of our symbol is from something else that's also callable.  (Noting
    // that def/decl are inherently not a use.)
    //
    // It's not a huge deal to inline the information into crossref, so if it
    // seems like we're trying to make this logic more clever, we should
    // probably just augment the crossref generation.
    let usesSemanticKind;
    if (rawSymInfo.meta) {
      const meta = rawSymInfo.meta;
      symInfo.updatePrettyNameFrom(meta.pretty);
      symInfo.updateSemanticKindFrom(meta.kind);
      symInfo.rawMeta = meta;

      symInfo.platforms = meta.platforms || ONLY_PLATFORM;

      if (symInfo.isCallable()) {
        // XXX it might also make sense to call this 'inferred-function' and
        // have isCallable aware of that magic type.
        usesSemanticKind = 'function';
      }

      if (meta.parentsym) {
        symInfo.parentSym = this.lookupRawSymbol(meta.parentsym);
      }

      if (meta.srcsym) {
        const srcSym = symInfo.srcSym = this.lookupRawSymbol(meta.srcsym);
        symInfo.inEdges.add(srcSym);
        srcSym.outEdges.add(symInfo);
        srcSym.markDirty();
      }

      if (meta.targetsym) {
        const targetSym = symInfo.targetSym =
          this.lookupRawSymbol(meta.targetsym);
        symInfo.outEdges.add(targetSym);
        targetSym.inEdges.add(symInfo);
        targetSym.markDirty();
      }

      if (meta.idlsym) {
        symInfo.idlSym =
          this.lookupRawSymbol(meta.idlsym);
        // The IDL symbol doesn't have any graph relevance since it already
        // would have provided us with the srcsym and targetsym relations.
      }

      if (meta.supers) {
        symInfo.supers = meta.supers.map(raw => {
          const o = Object.assign({}, raw);
          o.symInfo = this.lookupRawSymbol(raw.sym);
          return o;
        });
      }

      if (meta.subclasses) {
        if (meta.subclasses.length >= EXCESSIVE_SUBCLASSES) {
          symInfo.subclasses = [];
          this.symbolAnalyzer.markExcessive(symInfo, 'SUBCLASSES');
        } else {
          symInfo.subclasses = meta.subclasses.map(rawSym => {
            const o = {};
            o.symInfo = this.lookupRawSymbol(rawSym);
            return o;
          });
        }
      }

      if (meta.methods) {
        symInfo.methods = meta.methods.map((raw) => {
          const o = Object.assign({}, raw);
          o.symInfo = this.lookupRawSymbol(raw.sym);
          return o;
        });
      }

      if (meta.fields) {
        symInfo.fields = meta.fields.map((raw) => {
          const o = Object.assign({}, raw);
          o.symInfo = this.lookupRawSymbol(raw.sym);
          o.typeSymInfo = raw.typesym ? this.lookupRawSymbol(raw.typesym) : null;
          return o;
        });
      }

      if (meta.overrides) {
        symInfo.overrides = meta.overrides.map((raw) => {
          const o = Object.assign({}, raw);
          o.symInfo = this.lookupRawSymbol(raw.sym);
          return o;
        });
      }

      if (meta.overriddenBy) {
        symInfo.overriddenBy = meta.overriddenBy.map(rawSym => {
          const o = {};
          o.symInfo = this.lookupRawSymbol(rawSym);
          return o;
        });
      }
    }

    // ## Consume "consumes"
    if (rawSymInfo.consumes) {
      for (let consumedInfo of rawSymInfo.consumes) {
        const consumedSym = this.lookupRawSymbol(
          consumedInfo.sym,
          {
            prettyName: consumedInfo.pretty,
          // XXX it might be nice for consumes to provide the def location/filetype.
            semanticKind: consumedInfo.kind,
          });

        symInfo.outEdges.add(consumedSym);
        consumedSym.inEdges.add(symInfo);
        consumedSym.markDirty();
      }
    }

    // ## Consume "hits" dicts
    // walk over normal/test/generated in the hits dict.
    if (rawSymInfo.hits) {
      for (const [pathKind, useGroups] of Object.entries(rawSymInfo.hits)) {
        // Each key is the use-type like "defs", "decls", etc. and the values
        // are PathLines objects of the form { path, lines }
        for (const [useType, pathLinesArray] of Object.entries(useGroups)) {
          //
          if (useType === 'defs') {
            if (pathLinesArray.length === 1 && !symInfo.sourceFileInfo) {
              const path = pathLinesArray[0].path;
              // Only analyze the file if we would analyze our related symbols.
              symInfo.sourceFileInfo =
                this.lookupSourceFile(
                  path,
                  {
                    considerHeader: true
                  });
              symInfo.sourceFileInfo.fileSymbolDefs.add(symInfo);
              symInfo.sourceFileInfo.markDirty();
            }

            if (pathLinesArray.length === 1 && pathLinesArray[0].lines.length === 1) {
              const line = pathLinesArray[0].lines[0];
              if (line.peekLines) {
                symInfo.defPeek = line.peekLines;
                symInfo.defLocation = { lno: line.lno, bounds: line.bounds };
              }
            }
          }
          else if (useType === 'decls') {
            // We now have a useType of 'forwards', so this should largely be
            // valid, at least for C++.
            if (pathLinesArray.length === 1 && !symInfo.declFileInfo) {
              const path = pathLinesArray[0].path;
              // Because of the potential for this to be a meaningless forward,
              // never analyze the file the decl comes from.  Instead we'll
              // depend on the explicit reciprocal file type logic.  (Try and
              // analyze the ".h" file for a given ".cpp" file if it exists.)
              // TODO: Once the analyzers know hot to generate "forward" types,
              // or we add a regexp heuristic to this logic block, reconsider
              // doing what we do for def's.
              symInfo.declFileInfo = this.lookupSourceFile(
                path, { analyze: false });
              symInfo.declFileInfo.fileSymbolDecls.add(symInfo);
              symInfo.declFileInfo.markDirty();
            }

            if (pathLinesArray.length === 1 && pathLinesArray[0].lines.length === 1) {
              const line = pathLinesArray[0].lines[0];
              if (line.peekLines) {
                symInfo.declPeek = line.peekLines;
              }
              symInfo.declLocation = { lno: line.lno, bounds: line.bounds };
            }
          }
          else if (useType === 'uses') {
            // NOTE!  This is a limit on the number of files with matches, not
            // on the number of matches!  See its docs!
            if (pathLinesArray.length >= MAX_USE_PATHLINES_LIMIT) {
              this.symbolAnalyzer.markExcessive(symInfo, 'USES');
              // If this symbol is eligible for call relationships, then this is
              // technically also an overflow of calls into it.
              if (symInfo.isCallable()) {
                this.symbolAnalyzer.markExcessive(symInfo, 'CALLS_IN');
              }
            } else {
              for (const pathLines of pathLinesArray) {
                for (const lineResult of pathLines.lines) {
                  if (lineResult.contextsym) {
                    const contextSym = this.lookupRawSymbol(
                      // XXX currently the uses will have commas
                      this.normalizeSymbol(lineResult.contextsym, true),
                      {
                        prettyName: lineResult.context,
                        // Provide a path for pretty name mangling normalization.
                        somePath: pathLines.path,
                        // See note above about the presumption here.
                        semanticKind: usesSemanticKind
                      });

                    symInfo.inEdges.add(contextSym);
                    contextSym.outEdges.add(symInfo);
                    contextSym.markDirty();
                  }
                }
              }
            }
          }
        }
      }
    }

    // Let's assume something in this method changes the symbol.
    symInfo.markDirty();
  }

  async _analyzeFile(fileInfo) {
    const data = await this.grokCtx.fetchFile({ path: fileInfo.path });
    // XXX The original intent was to specify an effective inclusive hop of 2 here so that we'd
    // analyze into other files, but not analyze those files.  But in an initial
    // load we ended up traversing our way throughout the codebase.  I've
    // improved some potentially incorrect logic, but I'm also setting this to 1
    // for now.
    this.fileAnalyzer.analyzeFile(fileInfo, data, 1);
  }

  /**
   * Create a starting diagram based on a symbol and a diagram type.
   */
  diagramSymbol(symInfo, diagramType) {
    const diagram = new ClassDiagram(this.grokCtx);

    switch (diagramType) {
      default:
      case 'empty': {
        break;
      }

      case 'method': {
        const doodler = new InternalDoodler();
        doodler.doodleMethodInternalEdges(symInfo, diagram);
        break;
      }

      case 'hierarchy': {
        const doodler = new HierarchyDoodler();
        doodler.doodleHierarchy(symInfo, diagram);
        break;
      }

      case 'calls-out': {
        const doodler = new TransitiveCallDoodler();
        doodler.doodleCalls(this.grokCtx, symInfo, diagram, true);
        break;
      }

      case 'calls-in': {
        const doodler = new TransitiveCallDoodler();
        doodler.doodleCalls(this.grokCtx, symInfo, diagram, false);
        break;
      }
    }

    diagram.name = diagramType;

    return diagram;
  }

  /**
   * Hacky attempt at a mechanism to cache the results of `diagramSymbol` in a
   * way that makes it easier to avoid worst-case diagram re-creation scenarios.
   */
  ensureDiagram(symInfo, diagramType) {
    // TODO: make the diagrams smart enough to invalidate themselves as symbols
    // of interest dirty themselves.
    return this.diagramSymbol(symInfo, diagramType);
    /*
    if (symInfo.__cachedDiagrams && symInfo.__cachedDiagrams[diagramType]) {
      return symInfo.__cachedDiagrams[diagramType];
    }
    if (!symInfo.__cachedDiagrams) {
      symInfo.__cachedDiagrams = {};
    }
    const diagram = symInfo.__cachedDiagrams[diagramType] =
      this.diagramSymbol(symInfo, diagramType);
    return diagram;
    */
  }

  /**
   * Asynchronously process the `symbols` and `identifiers` arrays in the graph
   * definition to return a single Set of SymbolInfo structures that have been
   * fully analyzed.
   */
  async _lookupSymbolsFromGraphDef(gdef) {
    const idPromises = [];
    const symPromises = [];
    const symbols = new Set();

    for (const id of (gdef.identifiers || [])) {
      idPromises.push(this.findSymbolsGivenId(id));
    }

    for (const symName of (gdef.symbols || [])) {
      const symInfo = this.lookupRawSymbol(symName);
      symPromises.push(
        this.ensureSymbolAnalysis(symInfo, { analysisMode: 'context' }));
    }

    const idResults = await Promise.all(idPromises);
    const symResults = await Promise.all(symPromises);

    for (const symSet of idResults) {
      for (const sym of symSet) {
        symbols.add(sym);
      }
    }
    for (const sym of symResults) {
      symbols.add(sym);
    }

    return symbols;
  }

  /**
   * Async method that gathers the data needed per the graph definition, then
   * renders it to an SVG.  This is intended for stuff like Markdown rendering
   * where the result is not editable or live-updating.  (Although such graphs
   * can always be upgraded into the interactive editing mode.)
   */
  async renderSVGDiagramFromGraphDef(gdef) {
    const diagram = new ClassDiagram(this.grokCtx);

    const symbols = await this._lookupSymbolsFromGraphDef(gdef);

    switch (gdef.mode) {
      case "blockly-v1":
        return gdef.svg;

      default:
      case "paths-between": {
        const doodler = new PathsBetweenDoodler();
        doodler.doodle(symbols, diagram);
        break;
      }
    }

    const { dot, fixupSVG } = diagram.lowerToGraphviz();
    //console.log("dot:", dot);
    const svgStr = fixupSVG(await this.grokCtx.vizJs.renderString(dot, {
      engine: "dot",
      format: "svg",
    }));
    //console.log("svg:", svgStr);

    return svgStr;
  }

  restoreDiagram(serialized) {
    const diagram = new ClassDiagram(this.grokCtx);
    diagram.loadFromSerialized(serialized);
    return diagram;
  }
}
