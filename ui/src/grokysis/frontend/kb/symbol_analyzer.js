
/**
 * This is both the to-do list for analysis and the log of what was analyzed.
 *
 * Note that individual symbols
 */
export class AnalysisTask {
  constructor({ initialSym }) {
    this.initialSym = initialSym;
    /// Symbol Analysis Modes initiated on the `initialSym`.  This exists mainly
    /// for quick console inspection; the `initialSym`, like all symbols, has
    /// `activeTraversalBits` and `completedTraversalBits` on it which track
    /// what's actually already been done.
    this.modes = new Set();

    this.activeWorkers = 0;
    this.descheduled = false;
    this.complete = false;

    /// Total number of distinct [traversal name, symbol] tuples considered for
    /// processing before suppressing traversals that have already been
    /// performed.
    this.consideredCount = 0;
    this.traversedCount = 0;

    /// Records that have yet to be processed
    this.todo = [];
    /// Records that are currently being processed
    this.active = new Set();
    /// Records that have been fully processed
    this.log = [];

    /// Maps from `SymbolInfo` instances to a bitmask of traversals of that
    /// symbol that have already been planned for in the `todo` list.  As
    /// records are removed from the `todo` list, entries are removed from this
    /// Map.
    ///
    /// The goal is to avoid having the `todo` list contain redundant traversals
    /// and to avoid tracking that on the `SymbolInfo` as that precludes
    /// prioritizing tasks and (more importantly) makes permanent breakage
    /// likely if a task hangs, plus makes cancelling tasks more of a state
    /// hassle.
    this.plannedMap = new Map();

    /// Maps from `SymbolInfo` instances to a bitmask of traversals from that
    /// symbol that were ignored because there were too many edges.  We expect
    /// this in cases like finding the subclasses of nsISupports or the uses of
    /// RefPtr<T>.
    this.excessiveMap = new Map();

    this.donePromise = new Promise((resolve) => {
      this._doneResolve = resolve;
    });
  }

  toString() {
    return `{Task ${Array.from(this.modes).join(',')} of ${this.initialSym.rawName}}`;
  }

  /**
   * Plan to traverse the given symbol using the given traversal.
   */
  planAnalysis(symInfo, traversalInfo) {
    if (this.complete) {
      throw new Error(`attempted to plan ${traversalInfo.name} of ${symInfo.rawName} on an already completed task: ${this}`);
    }
    this.todo.push([symInfo, traversalInfo]);
  }

  /**
   * Request a record from the `todo` list, putting it in the `active` set.  The
   * record is returned, and the caller should invoke `completeAnalysis` with
   * the record when complete.
   */
  gimmeAnalysisTodo() {
    if (this.todo.length === 0) {
      return null;
    }

    const rec = this.todo.shift();
    this.active.add(rec);
    return rec;
  }

  completeAnalysis(rec) {
    if (!this.active.has(rec)) {
      console.warn('Tried to complete analysis that was not active:', rec);
    }
    this.active.delete(rec);
    this.log.push(rec);
  }

  noteExcessiveTraversal(symInfo, traversalBit) {
    let curState = this.excessiveMap.get(symInfo) || 0;
    curState |= traversalBit;
    this.excessiveMap.set(symInfo, curState);
    return curState;
  }
}

/**
 * We use the lowest bits for things that aren't actually traversals but instead
 * are a way for us to cram analysis meta-info into our bit-fields.  This isn't
 * so much of a memory optimization as just a normalization and simplification
 * for handling the analysis bookkeeping that isn't something we'd want to
 * expose in the UI.
 *
 * Current special bits are:
 * - SELF: Tracks whether we've fetched the semantic data from the server.
 * - USES: Exists so we can track when the number of "uses" is excessive.  This
 *   may end up a real traversal in the future.  Right now it
 */
const SPECIAL_BIT_COUNT = 2;

const EMPTY_SET = new Set();

/**
 * Defines the way that a symbol can be traversed.
 *
 * @param name
 *   The name of the traversal.
 * @param bit
 *   The bit(mask) for this traversal.
 *
 * @param traverse
 *   Function that takes a `SymbolInfo` instance and returns a Set of symbols
 *   to ensure have
 */
const SYMBOL_ANALYSIS_TRAVERSALS = [
  /// SELF is a placeholder for indicating that we've fetched the semantic
  /// crossref data for a symbol.  It can be used as a named traversal for the
  /// purposes of making sure we have the data, but it's special-cased in the
  /// analysis process and isn't a proper traversal.
  {
    name: 'SELF',
    bit: 1 << 0,
    prepare(/*symInfo*/) {
      return null;
    },
    traverse(/*symInfo*/) {
      return null;
    },
    traverseNext: [],
  },
  /// USES is currently a placeholder for "excessive" uses tracking.  This may
  /// change in the future.
  {
    name: 'USES',
    bit: 1 << 1,
    prepare(/*symInfo*/) {
      return null;
    },
    traverse(/*symInfo*/) {
      return null;
    },
    traverseNext: [],
  },
  {
    name: 'SUPERCLASSES',
    bit: 1 << (SPECIAL_BIT_COUNT + 0),
    prepare(/*symInfo*/) {
      return null;
    },
    traverse(symInfo) {
      if (!symInfo.supers) {
        return EMPTY_SET;
      }
      return new Set(symInfo.supers.map(x => x.symInfo));
    },
    traverseNext: ['SUPERCLASSES', 'VARIANTS'],
  },
  {
    name: 'SUBCLASSES',
    bit: 1 << (SPECIAL_BIT_COUNT + 1),
    prepare(/*symInfo*/) {
      return null;
    },
    traverse(symInfo) {
      if (!symInfo.subclasses) {
        return EMPTY_SET;
      }
      return new Set(symInfo.subclasses.map(x => x.symInfo));
    },
    traverseNext: ['SUBCLASSES'],
  },
  {
    name: 'PARENT',
    bit: 1 << (SPECIAL_BIT_COUNT + 2),
    prepare(/*symInfo*/) {
      return null;
    },
    traverse(symInfo) {
      let parentSet = new Set();
      if (symInfo.parentSym) {
        parentSet.add(symInfo.parentSym);
      }
      return parentSet;
    },
    traverseNext: ['FIELDS', 'METHODS'],
  },
  {
    name: 'CALLS_OUT',
    bit: 1 << (SPECIAL_BIT_COUNT + 3),
    prepare(symInfo) {
      // We need all of the out edges analyzed before ensureCallEdges has the
      // info it needs.
      return symInfo.outEdges;
    },
    traverse(symInfo) {
      symInfo.ensureCallEdges();
      return new Set(symInfo.callsOutTo);
    },
    // The thing we call may be a virtual method that gets overridden by other
    // methods, and we want to know those.
    traverseNext: ['OVERRIDDEN_BY'],
  },
  {
    name: 'CALLS_IN',
    bit: 1 << (SPECIAL_BIT_COUNT + 4),
    prepare(symInfo) {
      // We need all of the in edges analyzed before ensureCallEdges has the
      // info it needs.
      return symInfo.inEdges;
    },
    traverse(symInfo) {
      symInfo.ensureCallEdges();
      return new Set(symInfo.receivesCallsFrom);
    },
    traverseNext: [],
  },
  {
    name: 'OVERRIDES',
    bit: 1 << (SPECIAL_BIT_COUNT + 5),
    prepare(/*symInfo*/) {
      return null;
    },
    traverse(symInfo) {
      if (!symInfo.overrides) {
        return EMPTY_SET;
      }
      return new Set(symInfo.overrides.map(x => x.symInfo));
    },
    traverseNext: [],
  },
  {
    name: 'OVERRIDDEN_BY',
    bit: 1 << (SPECIAL_BIT_COUNT + 6),
    prepare(/*symInfo*/) {
      return null;
    },
    traverse(symInfo) {
      if (!symInfo.overriddenBy) {
        return EMPTY_SET;
      }
      return new Set(symInfo.overriddenBy.map(x => x.symInfo));
    },
    // The things we are overridden by could perhaps be overridden themselves?
    // XXX deal with this more.
    traverseNext: ['OVERRIDDEN_BY'],
  },
  // Looks up all the fields with no follow-on traversal.
  {
    name: 'FIELDS',
    bit: 1 << (SPECIAL_BIT_COUNT + 7),
    prepare(/*symInfo*/) {
      return EMPTY_SET;
    },
    traverse(symInfo) {
      if (!symInfo.fields) {
        return EMPTY_SET;
      }
      return new Set(symInfo.fields.map(x => x.symInfo));
    },
    traverseNext: [],
  },
  {
    name: 'METHODS',
    bit: 1 << (SPECIAL_BIT_COUNT + 8),
    prepare(/*symInfo*/) {
      return EMPTY_SET;
    },
    traverse(symInfo) {
      if (!symInfo.methods) {
        return EMPTY_SET;
      }
      return new Set(symInfo.methods.map(x => x.symInfo));
    },
    traverseNext: [],
  },
  // Note that neither FIELDS nor METHODS include further traversals.
  {
    name: 'VARIANTS',
    bit: 1 << (SPECIAL_BIT_COUNT + 9),
    prepare(/*symInfo*/) {
      return EMPTY_SET;
    },
    traverse(symInfo) {
      this.kb.__processVariants(symInfo);
      if (symInfo.variants) {
        return new Set(symInfo.variants);
      }
      return EMPTY_SET;
    },
    traverseNext: ['FIELDS', 'METHODS'],
  },
];

/**
 * When analysis is initiated on a symbol, one of these modes is provided, which
 * is then mapped to the various analysis traversals to perform.
 */
const SYMBOL_ANALYSIS_MODES = [
  {
    name: 'context',
    traversals: ['SELF', 'SUPERCLASSES', 'SUBCLASSES', 'PARENT', 'FIELDS', 'METHODS', 'VARIANTS'],
    traverseFile: true,
    /// `traversalInfos` will be clobbered into place and reference the objects
    /// found in SYMBOL_ANALYSIS_TRAVERSALS
    traversalInfos: null,
  },
  {
    name: 'from-file',
    traversals: ['SELF'],
    traverseFile: false,
    /// `traversalInfos` will be clobbered into place and reference the objects
    /// found in SYMBOL_ANALYSIS_TRAVERSALS
    traversalInfos: null,
  },
  {
    name: 'calls-out',
    traversals: ['CALLS_OUT'],
    traverseFile: false,
    /// `traversalInfos` will be clobbered into place and reference the objects
    /// found in SYMBOL_ANALYSIS_TRAVERSALS
    traversalInfos: null,
  },
  {
    name: 'calls-in',
    traversals: ['CALLS_IN'],
    traverseFile: false,
    /// `traversalInfos` will be clobbered into place and reference the objects
    /// found in SYMBOL_ANALYSIS_TRAVERSALS
    traversalInfos: null,
  },
];

/**
 * How many traversal records should be processed in parallel.
 */
const MAX_CONCURRENT_TRAVERSALS = 4;

export default class SymbolAnalyzer {
  constructor(kb) {
    this.kb = kb;
    /// This is the count of traversals that we're not performing in parallel
    /// right now but we could be.
    this._taskTokens = MAX_CONCURRENT_TRAVERSALS;

    this.traversalsByName = new Map();
    for (const info of SYMBOL_ANALYSIS_TRAVERSALS) {
      this.traversalsByName.set(info.name, info);
    }
    for (const info of SYMBOL_ANALYSIS_TRAVERSALS) {
      info.traverseNextInfos = info.traverseNext.map((name) => {
        return this.traversalsByName.get(name);
      });
      // Make `this.kb` available to their traverse() methods.
      info.kb = kb;
    }
    this.selfTraversalInfo = this.traversalsByName.get('SELF');

    this.modesByName = new Map();
    for (const info of SYMBOL_ANALYSIS_MODES) {
      this.modesByName.set(info.name, info);
      info.traversalInfos = info.traversals.map((name) => {
        const traversalInfo = this.traversalsByName.get(name);
        if (!traversalInfo) {
          throw new Error(`bad traversal name: ${name}`);
        }
        return traversalInfo;
      });
    }

    this.activeTasksBySym = new Map();
    /// Tasks which still have additional things in their `todo` list, sorted by
    /// priority, where currently our priority is just FIFO.  A task may exist
    /// in `activeTasksBySym` but not be present in this list because there's
    /// nothing left to do.  A tasks is added to this list by
    /// `_planModeTraversal` and removed by `_maybeSpinUpWork` when there's
    /// nothing left to do.
    this._prioritizedTasks = [];

    /// Maps from SymbolInfo to the Promise that ensureSymbolData will hand out
    /// if duplicate requests come in.
    this._activeCrossrefLookups = new Map();
  }

  /**
   * Mark the given traversal as excessive on the symbol.  This also marks the
   * traversal as completed.
   */
  markExcessive(symInfo, traversalName) {
    const traversalInfo = this.traversalsByName.get(traversalName);
    symInfo.__excessiveBits |= traversalInfo.bit;
    symInfo.__completedTraversalBits |= traversalInfo.bit;
  }

  /**
   * Inject 'SELF' / `SymbolInfo.__crossrefData` if it's not already there,
   * setting the "SELF"/`selfTraversalInfo` bit.
   */
  injectCrossrefData(symInfo, crossrefData) {
    // If we already have the data or there's already an active request in
    // flight, then do nothing.  Arguably we could cram the data in in the
    // active case, but it seems slightly better invariant-wise to let the
    // active request be the one to do it.
    if ((symInfo.__completedTraversalBits & this.selfTraversalInfo.bit) ||
        (symInfo.__activeTraversalBits & this.selfTraversalInfo.bit)) {
      return;
    }

    symInfo.__activeTraversalBits &= ~this.selfTraversalInfo.bit;
    symInfo.__completedTraversalBits |= this.selfTraversalInfo.bit;
    this.kb._processSymbolRawSymInfo(symInfo, crossrefData);
  }

  /**
   * Perform the actual analysis for a symbol.  The caller is expected to have
   * already checked whether the analysis is necessary.
   */
  _analyzeSymbol(symInfo, mode) {
    if (this.activeTasksBySym.has(symInfo)) {
      const existing = this.activeTasksBySym.get(symInfo);
      this._planModeTraversal(existing, mode);
      return existing.donePromise;
    }

    const task = new AnalysisTask({
      initialSym: symInfo,
    });
    this.activeTasksBySym.set(symInfo, task);
    this._prioritizedTasks.push(task);

    this._planModeTraversal(task, mode);

    return task.donePromise;
  }

  /**
   * Dig up info on a symbol by:
   * - Running a searchfox search on the symbol.
   * - Processing def/decl results.
   * - Populate incoming edge information from the "uses" results.
   * - Populate outgoing edge information from the "consumes" results.
   */
  async _fetchSymbolCrossrefData(symInfo) {
    symInfo.__activeTraversalBits |= this.selfTraversalInfo.bit;

    // Perform the raw Searchfox search.
    const filteredResults =
      await this.kb.grokCtx.performAsyncSearch(`symbol:${symInfo.rawName}`);

    const raw = filteredResults.rawResultsList[0].raw;

    for (const rawSymInfo of Object.values(raw.semantic || {})) {
      if (rawSymInfo.symbol !== symInfo.rawName) {
        console.warn('ignoring search result for', rawSymInfo.symbol,
                     'received from lookup of', symInfo.rawName);
        continue;
      }

      symInfo.__activeTraversalBits &= ~this.selfTraversalInfo.bit;
      symInfo.__completedTraversalBits |= this.selfTraversalInfo.bit;
console.log('processing data for', symInfo.rawName);
      this.kb._processSymbolRawSymInfo(symInfo, rawSymInfo);
    }

    return symInfo;
  }

  /**
   * Asynchronously ensures that the crossref data is available for the symbol.
   * If it's already available, a resolved Promise with the `symInfo` is
   * returned.  If a fetch is in process or needs to be initiated, a Promise is
   * returned that will be resolved with the `symInfo` after the data is
   * processed.
   */
  ensureSymbolData(symInfo) {
    if (symInfo.__completedTraversalBits & this.selfTraversalInfo.bit) {
      return Promise.resolve(symInfo);
    }
    if (symInfo.__activeTraversalBits & this.selfTraversalInfo.bit) {
      return this._activeCrossrefLookups.get(symInfo);
    }

    const crossrefPromise = this._fetchSymbolCrossrefData(symInfo);
    const exposePromise = crossrefPromise.then(() => {
      this._activeCrossrefLookups.delete(symInfo);
    });
    this._activeCrossrefLookups.set(symInfo, exposePromise);
    return exposePromise;
  }

  /**
   * Given a symbol and an analysis mode, return a Promise that resolves when
   * the given analysis has completed.  This method avoids doing redundant work,
   * but still returns a Promise either way.
   */
  ensureSymbolAnalysis(symInfo, mode) {
    if (!this.modesByName.has(mode)) {
      throw new Error(`not a real mode: ${mode}`);
    }

    // We need to perform analysis if we find a traversal bit that's not
    // completed.  (If it's active, we still want to join on the currently
    // active analysis.)
    let needsAnalysis = false;
    const modeInfo = this.modesByName.get(mode);
    for (const traversalInfo of modeInfo.traversalInfos) {
      if (symInfo.__completedTraversalBits & traversalInfo.bit) {
        continue;
      }
      needsAnalysis = true;
      break;
    }

    if (!needsAnalysis) {
      return Promise.resolve(symInfo);
    }

    return this._analyzeSymbol(symInfo, mode);
  }

  /**
   * Given a mode, check which traversals haven't already been initiated on the
   * root symbol and plan them.
   */
  _planModeTraversal(task, mode) {
    // There is nothing to do if the mode has already been planned.
    if (task.modes.has(mode)) {
console.log('AN: redundant traversal mode', mode, 'ignored');
      return;
    }

console.log('AN: planning mode', mode, 'traversals of', task.initialSym.rawName);
    const modeInfo = this.modesByName.get(mode);
    for (const traversalInfo of modeInfo.traversalInfos) {
      this._planSymbolTraversal(task, task.initialSym, traversalInfo);
    }
    if (modeInfo.traverseFile) {

    }
    task.modes.add(mode);
    this._maybeSpinUpWork();
  }

  _planSymbolTraversal(task, symInfo, traversalInfo) {
    // There is nothing to plan if the traversal is actively happening or
    // already completed.
    if ((symInfo.__completedTraversalBits & traversalInfo.bit) ||
        (symInfo.__activeTraversalBits & traversalInfo.bit)) {
console.log('AN:     NOT planning future traversal', traversalInfo.name, 'of', symInfo.rawName,
          `as part of task ${task} becase`, 'completed?', (symInfo.__completedTraversalBits & traversalInfo.bit),
          'active?', (symInfo.__activeTraversalBits & traversalInfo.bit));
      return;
    }
console.log('AN:     planning future traversal', traversalInfo.name, 'of', symInfo.rawName,
`as part of task ${task}`);
    task.planAnalysis(symInfo, traversalInfo);
  }

  _maybeCompleteTask(task) {
    if (task.activeWorkers === 0) {
      task.complete = true;
      this.activeTasksBySym.delete(task.initialSym);
      console.log(`AN: COMPLETING task ${task}`);
      task._doneResolve();
      task._doneResolve = null;
      return true;
    }
    return false;
  }

  /**
   * Spins up additional parallel traversals until `_taskTokens` is 0.
   */
  _maybeSpinUpWork(fromTask) {
    if (fromTask) {
      if (fromTask.todo.length > 0) {
        // we mi
        if (fromTask.descheduled) {
          this._prioritizedTasks.unshift(fromTask);
          fromTask.descheduled = false;
        }
      } else {
        this._maybeCompleteTask(fromTask);
      }
    }

    // If we run out of active tasks, _prioritizedTasks will be empty.  However,
    // we may also find that there's nothing left to to in the loop, in which
    // case we'll explicitly break out.
    while (this._prioritizedTasks.length && this._taskTokens > 0) {
      const task = this._prioritizedTasks[0];
      const rec = task.gimmeAnalysisTodo();
      // Currently it's possible that there isn't actually anything to do.
      if (rec) {
        this._performOneTraversal(task, rec);
      }

      // If there's nothing more to schedule, we need to remove the tasks from
      // the list of active prioritized tasks.  However, this doesn't mean that
      // it's completed.
      if (task.todo.length === 0) {
        this._prioritizedTasks.shift();
        task.descheduled = true;
        this._maybeCompleteTask(task);
      }
    }
  }

  /**
   * Perform the single traversal specified by the `rec`.
   *
   * Each plan record consists of a symbol and a traversal to perform on the
   * symbol.  Our steps:
   * - Ensure that we have the SELF data for the symbol.
   * - Run the traversal's traverse() method to get the set of related symbols.
   * - Ensure we have the SELF data for each of those symbols.  The goal is to
   *   make sure we have the meta-info for the symbol in question.
   * - If the traversal has `traverseNextInfos` to perform on the traversed
   *   symbols, plan the traversal as future work.
   */
  async _performOneTraversal(task, rec) {
    if (this._taskTokens <= 0) {
      throw new Error("TaskTokens invariant badly broken!");
    }

    // Take a token! (Must be done before going async!)
    this._taskTokens--;
    task.activeWorkers++;
    try {
      // Use a loop so we can `break` out.  We always break at the bottom of the
      // loop.
      for(;;) {
        const [symInfo, traversalInfo] = rec;
console.log('AN:  processing', traversalInfo.name, 'traversal for', symInfo.rawName);
        await this.ensureSymbolData(symInfo);

        // The traversal could already have been performed by something else,
        // so check and bail if it's already done.  Note that this is somewhat
        // intentionally chosen to take place after we go async in
        // `ensureSymbolData`, but it's arbitrary.
        if ((symInfo.__completedTraversalBits & traversalInfo.bit) ||
            (symInfo.__activeTraversalBits & traversalInfo.bit)) {
console.log('AN: breaking out of', traversalInfo.name, 'because: completed?', (symInfo.__completedTraversalBits & traversalInfo.bit),
'active?', (symInfo.__activeTraversalBits & traversalInfo.bit));
          break;
        }

        // Set the active traversal bit which ensures that no other traversal
        // should do what we're doing here.
        symInfo.__activeTraversalBits |= traversalInfo.bit;

        const prepareSyms = traversalInfo.prepare(symInfo);
        if (prepareSyms) {
          for (const otherSym of prepareSyms) {
            await this.ensureSymbolData(otherSym);
          }
        }

        const nextSyms = traversalInfo.traverse(symInfo);
        if (nextSyms) {
          for (const otherSym of nextSyms) {
console.log('AN:   processing traverse-emitted', otherSym.rawName);
            await this.ensureSymbolData(otherSym);
            for (const nextTraversal of traversalInfo.traverseNextInfos) {
              this._planSymbolTraversal(task, otherSym, nextTraversal);
            }
          }
        }

console.log('AN:  completing', traversalInfo.name, 'for', symInfo.rawName);
        // Clear the active bit and set the completed bit.
        symInfo.__activeTraversalBits &= ~traversalInfo.bit;
        symInfo.__completedTraversalBits |= traversalInfo.bit;

        break;
      }
    } finally {
      // Mark the record as completed.
      task.completeAnalysis(rec);
      // Give the token back!
      this._taskTokens++;
      task.activeWorkers--;
    }

    this._maybeSpinUpWork(task);
  }
}
