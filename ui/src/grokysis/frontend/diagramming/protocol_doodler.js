const MAX_CALLER_COUNT_FOR_TRAVERSAL_IN = 4;

/**
 * XXX this is still just internal_doodler. finish updating.

 * Given a SymbolInfo corresponding to a
 */
export default class ProtocolDoodler {
  doodleMethodInternalEdges(protocolSyms, diagram) {
    const strongRoots = new Set();

    for (const protoSym of protocolSyms) {
      diagram.nodes.add(protoSym);
      diagram.visitWithHelpers(
        protoSym,
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
            if (from === protoSym) {
              if (!tooBusy) {
                strongRoots.add(to);
              }
              return [tooBusy ? diagram.OK_EDGE : diagram.STRONG_EDGE, 0];
            } else if (to === protoSym) {
              if (!tooBusy) {
                strongRoots.add(from);
              }
              return [tooBusy ? diagram.OK_EDGE : diagram.STRONG_EDGE, 0];
            }
            return [tooBusy ? diagram.BORING_EDGE : diagram.WEAK_EDGE, 0];
          }
          return [diagram.BORING_EDGE, null];
        }
      );
    }

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
