const MAX_CALL_BRANCHING = 12;

/**
 * Async doodler that attempts to transitively follow either all call edges out
 * of or into a method.
 */
export default class TransitiveCallDoodler {
  async doodleCalls(grokCtx, rootSym, diagram, callsOut=true, limitToModule=true) {
    const analysisMode = callsOut ? 'calls-out' : 'calls-in';
    const callsPropName = callsOut ? 'callsOutTo' : 'receivesCallsFrom';

    const considered = new Set();
    const toTraverse = [rootSym];
    const overloadBailed = new Set();

    // Ensure the root symbol has been fully analyzed for context before moving
    // forward.
    await grokCtx.kb.ensureSymbolAnalysis(
      rootSym, { analysisMode: 'context' });

    while (toTraverse.length) {
      const curSym = toTraverse.shift();
      console.log('Transitive traversing', curSym);

      await grokCtx.kb.ensureSymbolAnalysis(
        curSym, { analysisMode });

      curSym.ensureCallEdges();

      // Only keep in-module calls
      let calls = Array.from(curSym[callsPropName]);
      let leafCalls = [];
      if (limitToModule) {
        calls = calls.filter((otherSym) => {
          if (rootSym.isSameDirectoryAs(otherSym)) {
            return true;
          }
          // XXX sorta hack here to let us pass a single layer of IPC calls
          // through.  We really just want to be able to identify IPC methods
          // that are explicitly part of the module
          if (otherSym.isHackGeneratedIPC()) {
            leafCalls.push(otherSym);
          }
          return false;
        });
      }
      if (calls.length > MAX_CALL_BRANCHING) {
        overloadBailed.add(curSym);
        diagram.styleNode(curSym, 'color="red"');
        continue;
      }

      for (const nextSym of calls) {
        if (callsOut) {
          diagram.ensureEdge(curSym, nextSym);
        } else {
          diagram.ensureEdge(nextSym, curSym);
        }
        // Add it to our traverse list if we haven't already put it in the
        // traverse list previously.  (This avoids infinite loops.)
        if (!considered.has(nextSym)) {
          toTraverse.push(nextSym);
          considered.add(nextSym);
        }
      }
      for (const nextSym of leafCalls) {
        if (callsOut) {
          diagram.ensureEdge(curSym, nextSym);
        } else {
          diagram.ensureEdge(nextSym, curSym);
        }
      }
    }

    console.log('Diagram doodling completed.');
  }
}
