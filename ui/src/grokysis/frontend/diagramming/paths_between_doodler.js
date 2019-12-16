const MAX_CALLER_COUNT_FOR_TRAVERSAL_IN = 4;

/**
 * This is an expansion of the `InternalDoodler` that instead of taking a single
 * symbol and finding locally relevant control flow instead takes a set of
 * interesting symbols and attempts to find direct control flow paths between
 * those symbols.  (By direct control flow, we mean that )
 */
export default class PathsBetweenDoodler {
  doodle(startSyms, diagram) {
    const strongRoots = new Set();

    for (const sym of startSyms) {
      diagram.nodes.add(sym);
    }
    diagram.visitWithHelpers(
      Array.from(startSyms),
      (from, to) => {
        // Treat calls into methods with a high number of callers as bad.
        const tooBusy =
          (to.receivesCallsFrom.size > MAX_CALLER_COUNT_FOR_TRAVERSAL_IN);

        //console.log(from.prettiestName, to.prettiestName, tooBusy);

        // previously, used isSameClassAs, then is isSameSourceFileAs, now
        // we use both!
        if (from.isSameSourceFileAs(to) || from.isSameClassAs(to)) {
          // Okay, it's some type of edge, but it's only strong if it's touching
          // something already in the graph.
          if (startSyms.has(from)) {
            if (!tooBusy) {
              strongRoots.add(to);
            }
            return [tooBusy ? diagram.OK_EDGE : diagram.STRONG_EDGE, 0];
          } else if (startSyms.has(to)) {
            if (!tooBusy) {
              strongRoots.add(from);
            }
            return [tooBusy ? diagram.OK_EDGE : diagram.STRONG_EDGE, 0];
          }
          return [tooBusy ? diagram.BORING_EDGE : diagram.WEAK_EDGE, 0];
        }
        return [diagram.BORING_EDGE, null];
      });

    // Now diagram.weakDiag is the weak graph, and we want to run flood
    // propagations from each strong root.
    let iBit = 0;
    for (const strongRoot of strongRoots) {
      //console.log('flooding', strongRoot);
      const bitVal = 1 << (iBit++);
      diagram.floodWeakDiagForPaths(strongRoot, bitVal, strongRoots);
    }

    if (window.DEBUG_DIAGRAM) {
      console.log('rendered diagram', diagram);
    }

    diagram.mergeTraversedWeakDiagIn();
  }
}
