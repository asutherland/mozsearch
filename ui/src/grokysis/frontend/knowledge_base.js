import SymbolInfo from './kb/symbol_info.js';
import FileInfo from './kb/file_info.js';
//import FileAnalyzer from './kb/file_analyzer.js';

import ClassDiagram from './diagramming/class_diagram.js';

import InternalDoodler from './diagramming/internal_doodler.js';

/**
 * Hacky attempt to deal with searchfox using comma-delimited symbols in places
 * where you might not expect it.
 */
function normalizeSymbol(symStr, commaExpected) {
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
  constructor({ name, grokCtx }) {
    this.name = name;
    this.grokCtx = grokCtx;

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
     * Set of SymbolInfo instances currently undergoing analysis.
     */
    this.analyzingSymbols = new Set();

    /**
     * FileInfo instances by their path relative to the root of the source dir.
     * Currently, it's really just C++ files that can be analyzed, so most other
     * file types will get stubs.
     */
    this.filesByPath = new Map();

    this.fileAnalyzer = null; // new FileAnalyzer(this);

    /**
     * The maximum number of edges something can have before we decide that
     * we're not going to traverse the edges.  The concern is that nothing good
     * can come of automatically fetching information on every symbol that uses
     * RefPtr.
     */
    this.EDGE_SANITY_LIMIT = 32;
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
      await this.grokCtx.performSearch(`id:${id}`);

    const raw = filteredResults.rawResultsList[0].raw;

    const resultSet = new Set();
    for (const [rawName, rawSymInfo] of Object.entries(raw.semantic || {})) {
      let symInfo = this.symbolsByRawName.get(rawName);
      if (symInfo) {
        resultSet.add(symInfo);

        if (!symInfo.analyzed && !symInfo.analyzing) {
          this._processSymbolRawSymInfo(symInfo, rawSymInfo);
          symInfo.analyzed = true;
        }
        continue;
      }

      symInfo = new SymbolInfo({ rawName });
      this.symbolsByRawName.set(rawName, symInfo);
      this._processSymbolRawSymInfo(symInfo, rawSymInfo);
      symInfo.analyzed = true;

      resultSet.add(symInfo);
    }

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
   * @param {String} [prettyName]
   */
  lookupRawSymbol(rawName, doAnalyze, prettyName, opts) {
    rawName = normalizeSymbol(rawName); // deal with comma-delimited symbols.

    let symInfo = this.symbolsByRawName.get(rawName);
    if (symInfo) {
      if (prettyName && !symInfo.prettyName) {
        symInfo.updatePrettyNameFrom(prettyName);
      }
      if (doAnalyze) {
        this.ensureSymbolAnalysis(symInfo);
      }
      return symInfo;
    }

    symInfo = new SymbolInfo({
      rawName, prettyName,
      // propagate hints for the source through.
      somePath: opts && opts.somePath,
      headerPath: opts && opts.headerPath,
      sourcePath: opts && opts.sourcePath,
      syntaxKind: opts && opts.syntaxKind,
    });
    this.symbolsByRawName.set(rawName, symInfo);

    if (doAnalyze) {
      let hops;
      if (doAnalyze === true) {
        // XXX this whole hops mechanism was to hack around the lack of knowing
        // the syntaxKind of the "consumes" edges but
        hops = 1;
      } else {
        hops = doAnalyze;
      }
      this.ensureSymbolAnalysis(symInfo, hops);
    }

    return symInfo;
  }

  /**
   * TODO: Modernize this mechanism to load all of the definitions from a file
   * in a single go.
   *
   * Given a path, asynchronously analyze and return the FileInfo that
   * corresponds to the file.  This was previously done to get the "consumes"
   * style edges via hacky parsing, but now we still potentially want to be able
   * to perform analyses on source files and their matching headers.
   */
  ensureFileAnalysis(path) {
    let fi = this.filesByPath.get(path);
    if (fi) {
      if (fi.analyzed) {
        return fi;
      }
      if (fi.analyzing) {
        return fi.analyzing;
      }
      // uh... how are we here, then?
      console.error('uhhh...');
    }

    fi = new FileInfo({ path });
    //const data = await this.grokCtx.fetchFile({ path });

    //fi.analyzing = this.fileAnalyzer.analyzeFile(fi, data);
    this.filesByPath.set(path, fi);

    //await fi.analyzing;
    fi.analyzing = false;
    fi.analyzed = true;
    fi.markDirty();
    //console.log('finished analyzing file', fi);
    return fi;
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
  async ensureSymbolAnalysis(symInfo, analyzeHops) {
    let clampedLevel = Math.min(2, analyzeHops);
    if (symInfo.analyzed) {
      if (symInfo.analyzed < clampedLevel) {
        symInfo.analyzed = clampedLevel;

        // we need to trigger analysis for all symbols in the graph.
        if (symInfo.outEdges.size < this.EDGE_SANITY_LIMIT) {
          for (let otherSym of symInfo.outEdges) {
            this.ensureSymbolAnalysis(otherSym, analyzeHops - 1);
          }
        }
        if (symInfo.inEdges.size < this.EDGE_SANITY_LIMIT) {
          for (let otherSym of symInfo.inEdges) {
            this.ensureSymbolAnalysis(otherSym, analyzeHops - 1);
          }
        }
      }
      return symInfo;
    }
    if (symInfo.analyzing) {
      return symInfo.analyzing;
    }

    symInfo.analyzing = this._analyzeSymbol(symInfo, analyzeHops);
    this.analyzingSymbols.add(symInfo);

    await symInfo.analyzing;
    symInfo.analyzing = false;
    symInfo.analyzed = clampedLevel;
    this.analyzingSymbols.delete(symInfo);
    symInfo.markDirty();
    return symInfo;
  }

  /**
   * Given the raw semantic info returned from a sorch that matches a symbol,
   * process it into the given symbol.
   */
  _processSymbolRawSymInfo(symInfo, rawSymInfo, analyzeHops=1) {
    // Let's assume something in this method changes the symbol.
    symInfo.markDirty();

    symInfo.updatePrettyNameFrom(rawSymInfo.pretty);

    // ## Consume "meta" data
    if (rawSymInfo.meta) {
      const meta = rawSymInfo.meta;
      symInfo.updateSyntaxKindFrom(meta.syntax);

      if (meta.srcsym) {
        const srcSym = symInfo.srcSym =
          this.lookupRawSymbol(meta.srcsym, analyzeHops - 1);
        symInfo.inEdges.add(srcSym);
        srcSym.outEdges.add(symInfo);
        srcSym.markDirty();
      }

      if (meta.targetsym) {
        const targetSym = symInfo.targetSym =
          this.lookupRawSymbol(meta.targetsym, analyzeHops - 1);
        symInfo.outEdges.add(targetSym);
        targetSym.inEdges.add(symInfo);
        targetSym.markDirty();
      }

      if (meta.idlsym) {
        const idlSym = syminfo.idlSym =
          this.lookupRawSymbol(meta.idlsym, analyzeHops - 1);
        // The IDL symbol doesn't have any graph relevance since it already
        // would have provided us with the srcsym and targetsym relations.
      }
    }


    // ## Consume "consumes"
    if (rawSymInfo.consumes) {
      for (let consumedInfo of rawSymInfo.consumes) {
        const consumedSym = this.lookupRawSymbol(
          normalizeSymbol(consumedInfo.sym), analyzeHops - 1,
          consumedInfo.pretty,
          // XXX it might be nice for consumes to provide the def location/filetype.
          { syntaxKind: consumedInfo.syntax });

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
              symInfo.sourceFileInfo = this.ensureFileAnalysis(path);
              symInfo.sourceFileInfo.fileSymbolDefs.add(symInfo);
              symInfo.sourceFileInfo.markDirty();
            }
          }
          else if (useType === 'decls') {
            // XXX this will largely get confused by forwards
            if (pathLinesArray.length === 1 && !symInfo.declFileInfo) {
              const path = pathLinesArray[0].path;
              symInfo.declFileInfo = this.ensureFileAnalysis(path);
              symInfo.declFileInfo.fileSymbolDecls.add(symInfo);
              symInfo.declFileInfo.markDirty();
            }
          }
          else if (useType === 'uses') {
            for (const pathLines of pathLinesArray) {
              for (const lineResult of pathLines.lines) {
                if (lineResult.contextsym) {
                  const contextSym = this.lookupRawSymbol(
                    // XXX currently the uses will have commas
                    normalizeSymbol(lineResult.contextsym, true), analyzeHops - 1,
                    lineResult.context,
                    // Provide a path for pretty name mangling normalization.
                    { somePath: pathLines.path,
                      // Assume the other thing is a function until we hear
                      // otherwise.  This is necessary for the current call
                      // graph filtering that wants to ensure things are
                      // callable.
                      syntaxKind: 'function' });

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

  /**
   * Dig up info on a symbol by:
   * - Running a searchfox search on the symbol.
   * - Processing def/decl results.
   * - Populate incoming edge information from the "uses" results.
   * - Populate outgoing edge information from the "consumes" results.
   */
  async _analyzeSymbol(symInfo, analyzeHops) {
    // Perform the raw Searchfox search.
    const filteredResults =
      await this.grokCtx.performSearch(`symbol:${symInfo.rawName}`);

    const raw = filteredResults.rawResultsList[0].raw;

    for (const [rawSym, rawSymInfo] of Object.entries(raw.semantic || {})) {
      if (rawSymInfo.symbol !== symInfo.rawName) {
        console.warn('ignoring search result for', rawSymInfo.symbol,
                     'received from lookup of', symInfo.rawName);
        continue;
      }

      this._processSymbolRawSymInfo(symInfo, rawSymInfo, analyzeHops);
    }
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
    }

    return diagram;
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
      symPromises.push(this.ensureSymbolAnalysis(symInfo, 1));
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
      case 'me'
    }
  }

  restoreDiagram(serialized) {
    const diagram = new ClassDiagram(this.grokCtx);
    diagram.loadFromSerialized(serialized);
    return diagram;
  }
}
