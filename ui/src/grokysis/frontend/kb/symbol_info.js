import EE from 'eventemitter3';

/**
 * Naive regexps to help with processing pretty names into component parts.
 * The gameplan would be for Searchfox to spoon-feed this information about
 * symbols to us.
 */
const RE_CPP_SYMBOL = /^([\w() ]+::)*(\w+)::([\w~]+)$/;
const RE_STARTSWITH_LOWER = /^[a-z]/;
const RE_STD_CLASS_PREFIX = /^ns|moz/;
const RE_JS_SYMBOL = /^(\w+#)*(\w+)#(\w+)$/;

/**
 * Live-updating KnowledgeBase info about a symbol.
 *
 * Our immediate motivation and use for this is to understand the in-edges and
 * out-edges for methods(/functions).
 *
 * Properties:
 * - typeLetter / type:
 *   - p: protocol
 *   - i: interface
 *   - c: class
 *   - m: method
 *   - f: field
 *   - o: object, for JS object things
 *   - ?: unknown
 * - defLocation { path, lineInfo }
 */
export default class SymbolInfo extends EE {
  constructor({ rawName, prettyName,
                somePath, headerPath, sourcePath, semanticKind }) {
    super();

    this.serial = 0;

    /**
     * The raw searchfox symbol name for this symbol.  For C++ this is the
     * mangled symbol name.  For things like JS or IDL this may be a synthetic
     * searchfox symbol.
     */
    this.rawName = rawName;

    /**
     * Fully qualified human-readable name for the symbol like a debugger would
     * tell you or want.
     */
    this.fullName = null;

    /**
     * For methods/fields this is the class-qualified name like "Class::method",
     * for classes it's just "Class", for namespaces it's the full namespace.
     */
    this.simpleName = null;
    /**
     * The namespace this symbol belongs to.  For an actual namespace "foo::bar"
     * this will be "foo".  For a method, this will be the namespace the class
     * belongs to.  When nested classes happen, everything but the most
     * immediate class is treated as part of the namespace.
     */
    this.namespace = null;
    /**
     * For things that can be contained by a class/interface/struct, this is the
     * name of that container.  For a class that's contained by a namespace
     * rather than another class, this will be the empty string.
     */
    this.className = null;
    /**
     * For methods/fields, this is the name of the method/field without the
     * class.  For classes, this is their class name.
     */
    this.localName = null;

    this.fullyQualifiedParts = [];

    this.typeLetter = '?';
    this.semanticKind = 'unknown';
    this.implKind = 'impl';

    this.analyzing = false;
    this.analyzed = false;

    /**
     * Direct superclasses of this symbol with symInfo clobbered into each meta
     * object.
     */
    this.supers = null;
    /**
     * Direct subclasses of this symbols.  Because the subclass xrefs right now
     * don't include any meta, this is just an object with a `symInfo` key.
     */
    this.subclasses = null;

    /**
     * Methods is a copy of the raw meta data for methods with symInfo clobbered
     * into each method meta object.
     */
    this.methods = null;
    /**
     * Fields is a copy of the raw meta data for fields with symInfo clobbered
     * into each field meta object.
     */
    this.fields = null;

    this.overrides = null;
    this.overriddenBy = null;

    this.parentSym = null;

    this.srcSym = null;
    this.targetSym = null;
    this.idlSym = null;

    /**
     * Indicates if we believe this symbol to be unimportant to understanding
     * the program at a higher level.  For example, string manipulation code is
     * boring from an application control-flow graph perspective.  The use of
     * strings is interesting within a method, but they are logically
     * deterministic leaf calls and there is little utility in knowing what
     * other methods call the same string function.
     *
     * So when a method is boring, we won't consider it as worth automatically
     * displaying in a call graph as a possible callsOutTo out-edge.  Similarly,
     * there's little point in displaying the potentially insanely huge set of
     * in-edges tracked in receivesCallsFrom.
     */
    this.isBoring = false;
    this.updateBoring();

    // unfiltered in/out edges.  callsOutTo/receivesCallsFrom are edges that are
    // filtered so that only when both sides are `isCallable`.
    this.outEdges = new Set();
    this.inEdges = new Set();

    this.callsOutTo = null;
    this.receivesCallsFrom = null;

    /**
     * Tracks the last `serial` for which `callsOutTo` and `receivesCallsFrom`
     * were derived from outEdges/inEdges.
     */
    this._callsLastFilteredSerial = -1;


    /**
     * The peek string for the declaration for this symbol, if there was only
     * one declaration.
     */
    this.declPeek = null;
    /**
     * The FileInfo where the sole declaration for this symbol was found.
     */
    this.declFileInfo = null;
    /** { lno, bounds } for the declaration. */
    this.declLocation = null;

    /**
     * The peek string for the definition for this symbol, if there was only one
     * definition.
     */
    this.defPeek = null;
    /**
     * The FileInfo where the definition for this symbol was found.
     */
    this.sourceFileInfo = null;
    /** { lno, bounds } for the declaration. */
    this.defLocation = null;

    // TODO: fix this an `KnowledgeBase.ensureDiagram` to actually know how to
    // evict stuff from the cache.
    this.__cachedDiagrams = null;

    if (prettyName) {
      this.updatePrettyNameFrom(
        prettyName, sourcePath || headerPath || somePath);
    }
    if (semanticKind) {
      this.updateSemanticKindFrom(semanticKind);
    }
    this.updateBoring();
  }

  markDirty() {
    this.serial++;
    this.emit('dirty');
  }

  ensureCallEdges() {
    if (this._callsLastFilteredSerial === this.serial) {
      return;
    }

    this._callsLastFilteredSerial = this.serial;

    if (!this.isCallable() && !this.callsOutTo) {
      this.callsOutTo = new Set();
      this.receivesCallsFrom = new Set();
      return;
    }

    this.callsOutTo =
      new Set([...this.outEdges].filter(x => x.isCallable() && !x.isBoring));
    this.receivesCallsFrom =
      new Set([...this.inEdges].filter(x => x.isCallable() && !x.isBoring));
  }

  get prettiestName() {
    return this.fullName || this.rawName;
  }

  isClass() {
    return this.typeLetter === 'c';
  }

  isMethod() {
    return this.typeLetter === 'm';
  }

  isCallable() {
    return this.semanticKind === 'function' ||
           this.semanticKind === 'method' ||
           // XXX constructor/destructor aren't semantic kinds yet; they were
           // previously possible syntax kinds.
           this.semanticKind === 'constructor' ||
           this.semanticKind === 'destructor';
  }

  isSameClassAs(otherSym) {
    return this.className && otherSym.className === this.className;
  }

  isSameSourceFileAs(otherSym) {
    // Don't return true if we don't know the file info!
    return this.sourceFileInfo && otherSym.sourceFileInfo === this.sourceFileInfo;
  }

  /**
   * Use directory as the unit of coupling.  This potentially might want
   * variations where we use the bugzilla component mapping.
   */
  isSameDirectoryAs(otherSym) {
    return this.sourceFileInfo && otherSym.sourceFileInfo &&
             this.sourceFileInfo.dirPath === otherSym.sourceFileInfo.dirPath;
  }

  /**
   * Helper for diagram hierarchical table display where it's possible we are
   * being displayed in the context of our parent and so we don't need to
   * re-display the className/etc.
   */
  computeNameGivenParentSym(parentSym) {
    if (this.fullName && this.fullName.startsWith(parentSym.fullName)) {
      return this.localName;
    }
    return this.prettiestName;
  }

  updatePrettyNameFrom(prettyName, path) {
    // Somewhat bogus mechanism for determining whether we're dealing with JS
    // or not borrowed from original diagramming experiments.
    let isJS;
    if (path) {
      isJS = /\.js$/.test(path);
    } else if (prettyName.indexOf('#') !== -1
               || prettyName.indexOf(':') === -1) {
      isJS = true;
    } else {
      isJS = false;
    }

    // Break up the symbol into namespace, className, and methodName components
    // on a best-effort basis.  Consider having the server give us more
    // information if this gets any uglier.
    let namespace, className, methodName, match, nsParts;
    if (isJS) {
      match = RE_JS_SYMBOL.exec(prettyName);
      if (match) {
        namespace = match[1] || null;
        nsParts = namespace.split('.');
        className = match[2];
        methodName = match[3];
      } else {
        namespace = null;
        nsParts = [];
        className = prettyName;
        methodName = null;
      }
    } else {
      match = RE_CPP_SYMBOL.exec(prettyName);
      if (match) {
        namespace = match[1] || null;
        // If the class name starts with lowercase then we may be getting faked
        // out by a namespace unless it's an expected prefix.
        if (RE_STARTSWITH_LOWER.test(match[2]) &&
            !RE_STD_CLASS_PREFIX.test(match[2])) {
          if (namespace) {
            namespace += match[2] + "::";
          } else {
            namespace = match[2];
          }
          className = match[3];
          methodName = null;
        } else {
          className = match[2];
          methodName = match[3];
        }
        nsParts = nsParts ? namespace.split('::') : [];
      } else {
        nsParts = [];
        namespace = null;
        className = prettyName;
        methodName = null;
      }
    }

    this.fullName = prettyName;
    this.namespace = namespace;
    this.simpleName = className + (methodName ? `::${methodName}` : '');
    this.className = className;
    this.localName = methodName;

    if (className) {
      nsParts.push(className);
    }
    if (methodName) {
      nsParts.push(methodName);
    }
    this.fullyQualifiedParts = nsParts;

    this.markDirty();
  }

  updateSemanticKindFrom(semanticKind) {
    this.semanticKind = semanticKind;
    this.typeLetter = semanticKind[0];
  }

  /**
   * Updates our `isBoring` state based on currently available information.
   */
  updateBoring() {
    const path = this.defLocation && this.defLocation.path;

    if (path) {
      // XXX these ideally would come from a database that's bootstrapped off a
      // TOML config and that can be round-tripped back to TOML.
      // TODO: implement toml boring classification thingy.
      if (/^xpcom\/string/.test(path) ||
          /^mfbt\/Ref/.test(path) ||
          /^mfbt\/.+Ptr/.test(path)) {
        this.isBoring = true;
      }
    }
    if (this.localName) {
      const ln = this.localName;
      if (ln.startsWith('Assert') ||
          ln.startsWith('Is') ||
          // Get and Set can both potentially be interesting, it would arguably
          // be better to have a complexity measure for methods and things that
          // look like straight lookups modulo some guards get marked boring.
          ln.startsWith('Get') ||
          ln.startsWith('Set') ||
          ln === 'AddRef' || ln === 'Release') {
        this.isBoring = true;
      }
    }
    if (this.fullName) {
      const fn = this.fullName;
      if (fn.startsWith('nsCOMPtr') || fn.startsWith('RefPtr') ||
          fn.startsWith('getter_AddRefs') ||
          fn.startsWith('mozilla::UniquePtr')) {
        this.isBoring = true;
      }
    }
  }
}
