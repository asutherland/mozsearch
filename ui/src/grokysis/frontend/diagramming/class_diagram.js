import EE from 'eventemitter3';

import { HierNode, HierBuilder } from './core_diagram.js';

// https://graphics.stanford.edu/~seander/bithacks.html via
// https://stackoverflow.com/questions/43122082/efficiently-count-the-number-of-bits-in-an-integer-in-javascript
function bitCount (n) {
  n = n - ((n >> 1) & 0x55555555);
  n = (n & 0x33333333) + ((n >> 2) & 0x33333333);
  return ((n + (n >> 4) & 0xF0F0F0F) * 0x1010101) >> 24;
}

/**
 * Class-diagram specific-ish subclass of HierBuilder that assumes that all
 * nodes are SymbolInfo instances and uses the inherent hierarchy of the
 * language namespaces (via `SymbolInfo.fullyQualifiedParts`).  Compare with
 * the blockly-diagram `HierNodeGenerator` whose nesting is always manual in
 * nature.
 *
 * This will likely evolve in the future to delineate along module /
 * sub-module / component lines as well.  This may happen via kinda/sorta
 * dynamic auto-faceting.
 */
export class AutoSymHierBuilder extends HierBuilder {
  constructor(settingOverrides) {
    super(settingOverrides);

    this.symsToHierNodes = new Map();
  }

  /**
   * Create a HierNode wrapping the provided symbol, returning the provided
   * hierNode.
   */
  addSymNode(sym, styling=null) {
    const pathParts = sym.fullyQualifiedParts;

    let cur = this.root;
    if (pathParts) {
      for (const part of pathParts) {
        cur = cur.getOrCreateKid(part, part);
      }
    }

    cur.updateSym(sym);
    cur.styling = styling;

    this.symsToHierNodes.set(sym, cur);
  }

  /**
   * Create an edge between two symbols.
   */
  addSymEdge(fromSym, toSym) {
    const fromNode = this.symsToHierNodes.get(fromSym);
    const toNode = this.symsToHierNodes.get(toSym);

    const ancestorNode = HierNode.findCommonAncestor(fromNode, toNode);

    ancestorNode.edges.push({ from: fromNode, to: toNode });
    // Make sure the containing node and all its parents have accurate counts
    // of the total number of edges they contain.  This is used by the action
    // heuristics.
    for (let node = ancestorNode; node; node = node.parent) {
      node.descendantEdgeCount++;
    }
  }
}

/**
 * High level class diagram abstraction used to idempotently expose class
 * structure and edges between methods.
 *
 * Understands a hierarchy that goes roughly:
 * - namespace / file path: We frequently like to cluster by namespaces or
 *   implementation directories.
 * - class: Classes frequently want to be a record-style display where its
 *   methods are their own rows.
 * - (inner class): There may also be inner classes; I think in this case, we
 *   want to cluster with the parent class, as it's usually the case that the
 *   inner class is an important implementation detail but that trying to
 *   expose it on the class proper will be too much.
 * - method: Methods usually like to be rows on the class record.
 * - state-condition of method: Methods may want to be further sub-divided if
 *   they can easily be broken down into switch() blocks or other mutually
 *   exclusive control-flow paths.  (Example: on-main thread and
 *   off-main-thread.)
 *
 */
export default class ClassDiagram extends EE {
  constructor(grokCtx) {
    super();

    this.grokCtx = grokCtx;

    // In the future diagrams should be able to be named.
    this.name = 'Diagram';

    this.settingOverrides = null;

    this.serial = 0;
    this.batchDepth = 0;
    this._serialWhenBatchBegan = 0;

    this.nodes = new Set();
    // For now track the styling separately as it's expected to be used for
    // exceptional cases like marking overloads and from a debugging perspective
    // it's nice to have this directly available, but from an efficiency
    // perspective this is dumb.
    // TODO: optimize this once the use-case is better understood.  (Overloads
    // and such may also want some kind of explicit semantics that give rise to
    // the styling rather than baking in styling from the get-go.)
    this.nodeStylings = new Map();
    // Keys are source nodes, values are a Map whose keys are the target node
    // and whose value is metadata.
    this.forwardEdges = new Map();
    // Keys are target nodes, values are a Map whose keys are the source node
    // and whose value is metadata.
    this.reverseEdges = new Map();

    /**
     * Weak diagram that is brought into existence by floodWeakDiagForPaths.
     * Weak diagrams won't themselves have weak diagrams.
     */
    this.weakDiag = null;

    /**
     * An edge that should not be part of the graph and shouldn't be traversed
     * further.
     */
    this.BORING_EDGE = 1;
    /**
     * An edge that isn't interesting on its own, but could end up being
     * interesting as part of a longer path.  Weak edges are added to a shadow
     * graph that will be added to the graph if a STRONG_EDGE is added.  Weak
     * edges are traversed.
     */
    this.WEAK_EDGE = 2;
    this.STRONG_EDGE = 3;
    /**
     * An OK edge is one that shouldn't cause the weak edges to be upgraded to
     * actual edges.  This would be used for cases for things like methods that
     * provide some type of boring leaf-node functionality.  The fact that other
     * methods also call the boring helper is not useful from a high-level
     * control-flow view, but may be useful to convey only for our starting
     * node.
     */
    this.OK_EDGE = 4;
  }

  markDirty() {
    this.serial++;
    if (!this.batchDepth) {
      this.emit('dirty');
    }
  }

  beginBatch() {
    if (!this.batchDepth) {
      this._serialWhenBatchBegan = this.serial;
    }
    this.batchDepth++;
  }

  endBatch() {
    this.batchDepth--;
    if (!this.batchDepth) {
      if (this.serial > this._serialWhenBatchBegan) {
        this.emit('dirty');
      }
    }
  }

  loadFromSerialized() {
    // TODO: implement serialization.
    // current idea is just to serialize all the edges as raw symbols and then
    // at load time look them all up, plus add ourselves as a listener for when
    // file analyses complete so we can get more correct as things get loaded
    // in.
  }

  // XXX experimental styling
  styleNode(node, style) {
    // ensure it's present.
    this.nodes.add(node);
    this.nodeStylings.set(node, style);
  }

  ensureEdge(from, to, meta) {
    this.nodes.add(from);
    this.nodes.add(to);

    let forwardMap = this.forwardEdges.get(from);
    if (!forwardMap) {
      forwardMap = new Map();
      this.forwardEdges.set(from, forwardMap);
    }
    forwardMap.set(to, meta);

    let reverseMap = this.reverseEdges.get(to);
    if (!reverseMap) {
      reverseMap = new Map();
      this.reverseEdges.set(to, reverseMap);
    }
    reverseMap.set(from, meta);
    this.markDirty();
  }

  /**
   * Symbol graph traversal helper.  Deals with:
   * - Ensuring each edge is considered at most once.
   * - Dealing with the weak edge shadow graph.
   *
   * Arguments:
   * - from
   * - to
   * - current strength / or value to propagate.
   */
  visitWithHelpers(startNodes, considerEdge) {
    const pendingNodes = startNodes.concat();
    // This is actually visited or will-visit.
    const visitedNodes = new Set(pendingNodes);

    // We use another ClassDiagram instance to store our weak wedges.
    const weakDiag = this.weakDiag = new ClassDiagram();

    const handleEdge = (from, to, other) => {
      // ignore erroneous edges.
      if (from === null || to === null) {
        return;
      }
      const [result, meta] = considerEdge(from, to);

      //console.log('considered edge', from, to, 'result', result);
      let addEdge = true;
      let traverseEdge = true;

      switch (result) {
        case this.BORING_EDGE: {
          //console.log("   boring");
          addEdge = false;
          traverseEdge = false;
          return;
        }
        case this.WEAK_EDGE: {
          //console.log("   weak");
          weakDiag.ensureEdge(from, to, meta);
          addEdge = false;
          break;
        }
        case this.STRONG_EDGE: {
          //console.log("   strong");
          // This means we potentially want to uplift portions of the
          break;
        }
        case this.OK_EDGE: {
          //console.log("   ok");
          traverseEdge = false;
          break;
        }
        default:
          throw new Error();
      }

      if (addEdge) {
        this.ensureEdge(from, to, meta);
      }

      if (traverseEdge && !visitedNodes.has(other)) {
        pendingNodes.push(other);
        visitedNodes.add(other);
      } else if (!traverseEdge) {
        // an ok edge should suppress traversal into the node.
        visitedNodes.add(other);
      }
    };

    try {
      this.beginBatch();
      while (pendingNodes.length) {
        const curNode = pendingNodes.pop();
        curNode.ensureCallEdges();

        for (const callsNode of curNode.callsOutTo) {
          callsNode.ensureCallEdges();
          handleEdge(curNode, callsNode, callsNode);
        }
        for (const callerNode of curNode.receivesCallsFrom) {
          callerNode.ensureCallEdges();
          handleEdge(callerNode, curNode, callerNode);
        }
      }
    } finally {
      this.endBatch();
    }
  }

  /**
   * May be called multiple times after a visitWithHelpers call to run flood
   * propagations to find all the paths between externally maintained "strong"
   * nodes.  (The external maintenance can likely be folded in.)
   *
   * This algorithm's flood traversal is directional.  We run via forward edges
   * once and via reverse edges once.  We don't do what visitWithHelpers does
   * where it processes each node in both directions every time.
   */
  floodWeakDiagForPaths(startNode, bitVal, terminusNodes) {
    try {
      // eh, we don't really need this...
      this.beginBatch();

      const weakDiag = this.weakDiag;

      // ## Forward pass.
      let visitedNodes = new Set(terminusNodes); // should include startNode
      let pendingNodes = [startNode];
      while (pendingNodes.length) {
        const curNode = pendingNodes.pop();

        const outMap = weakDiag.forwardEdges.get(curNode);
        if (outMap) {
          for (const [callsNode, meta] of outMap.entries()) {
            outMap.set(callsNode, meta | bitVal);
            // we also want to grab the mirror represenstation of this...
            const mirrorMap = weakDiag.reverseEdges.get(callsNode);
            const mirrorMeta = mirrorMap.get(curNode);
            mirrorMap.set(curNode, mirrorMeta | bitVal);

            if (!visitedNodes.has(callsNode)) {
              pendingNodes.push(callsNode);
              visitedNodes.add(callsNode);
            }
          }
        }
      }

      // ## Reverse pass
      visitedNodes = new Set(terminusNodes); // should include startNode
      pendingNodes = [startNode];
      while (pendingNodes.length) {
        const curNode = pendingNodes.pop();

        const inMap = weakDiag.reverseEdges.get(curNode);
        if (inMap) {
          for (const [callerNode, meta] of inMap.entries()) {
            inMap.set(callerNode, meta | bitVal);
            // we also want to grab the mirror represenstation of this...
            const mirrorMap = weakDiag.forwardEdges.get(callerNode);
            const mirrorMeta = mirrorMap.get(curNode);
            mirrorMap.set(curNode, mirrorMeta | bitVal);

            if (!visitedNodes.has(callerNode)) {
              pendingNodes.push(callerNode);
              visitedNodes.add(callerNode);
            }
          }
        }
      }
    } finally {
      this.endBatch();
    }
  }

  mergeTraversedWeakDiagIn() {
    try {
      this.beginBatch();

      const weakDiag = this.weakDiag;
      for (const [from, toMap] of weakDiag.forwardEdges.entries()) {
        for (const [to, meta] of toMap.entries()) {
          // NB: we could avoid the bit-counting by just noticing that we're
          // or-ing in a value above that's different from the existing value.  We
          // don't actually care about the tally proper or which bits, yet...
          // (There could be a neat color thing that could be done with a VERY
          // small number of colors.)
          if (bitCount(meta) >= 2) {
            this.ensureEdge(from, to, meta);
          }
        }
      }

      for (const [to, fromMap] of weakDiag.reverseEdges.entries()) {
        for (const [from, meta] of fromMap.entries()) {
          // NB: we could avoid the bit-counting by just noticing that we're
          // or-ing in a value above that's different from the existing value.  We
          // don't actually care about the tally proper or which bits, yet...
          // (There could be a neat color thing that could be done with a VERY
          // small number of colors.)
          if (bitCount(meta) >= 2) {
            this.ensureEdge(from, to, meta);
          }
        }
      }
    } finally {
      this.endBatch();
    }
  }

  dumpToConsole() {
    for (const [from, toMap] of this.forwardEdges.entries()) {
      for (const [to, meta] of toMap.entries()) {
        console.log(from, '->', to, 'meta:', meta);
      }
    }
  }

  /**
   * Create a graphviz dot representation of this diagram.
   *
   * The main value-add of this method over the simplest naive graphviz
   * translation is clustering nodes into graphviz clusters and HTML table
   * "records".
   *
   * Our general theory on these choices:
   * - The point of any type of clustering/grouping is to aid understanding by
   *   reducing visual complexity, making it easier for us to understand
   *   like/related things as as alike/related.
   * - An HTML record style works well for classes when we're not dealing with
   *   a high degree of (visualized) internal connectivity.  Self-edges don't
   *   work great, it's better to cluster as independent nodes in that case.
   * - Clusters work well for namespaces and directory structures.
   *
   * ### Implementation ###
   *
   * The current strategy is roughly:
   * - Run through all nodes building a tree hierarchy based on
   *   [namespace, class, method].
   * - Walk all edges, binning the edges into the first level of hierarchy that
   *   contains both nodes as descendants.  Tallies are maintained at each level
   *   of hierarchy so that the internal edge count (edges between children) and
   *   external edge count (edges between a child and a non-child) are always
   *   known when considering what to do for a tree branch.
   * - Walk the tree, deciding for each level which of the following to do.
   *   Note that explicit annotations may eventually be provided on levels of
   *   hierarchy by external actors (users, clever doodlers).
   *   - collapse: For a hierarchy level with only one child, it probably makes
   *     sense to combine the hierarchy level with its child rather than
   *     introduce a gratuitous cluster.
   *   - MAYBE flatten: Like collapse, but multiple children are combined into
   *     their parent without clustering.
   *   - cluster: Create a graphviz cluster.
   *   - make a record table: If the number of internal edges is low compared to
   *     the number of external edges, a record may be appropriate.
   *
   * Much of this logic is farmed out to the HierBuilder.  The documentation
   * above probably wants to move.
   */
  lowerToGraphviz() {
    const builder = new AutoSymHierBuilder(this.settingOverrides);

    // ## Add all nodes
    for (const sym of this.nodes) {
      builder.addSymNode(sym, this.nodeStylings.get(sym));
    }

    // ## Add the edges.
    for (const [from, toMap] of this.forwardEdges.entries()) {
      for (const [to, meta] of toMap.entries()) {
        builder.addSymEdge(from, to);
      }
    }

    // ## Determine what to do at each level of the hierarchy.
    builder.determineNodeActions();

    return this.renderToSVG(builder);
  }

  /**
   * Render the diagram to SVG, performing fixups so that the <title> tags that
   * are just our auto-generated node identifiers are replaced with semantic
   * attributes that allow us to map nodes in the graph to underlying searchfox
   * symbols.
   */
  renderToSVG(builder) {
    // ## And now the actual dot source!
    return {
      settings: builder.settings,
      dot: builder.renderToDot(),
      fixupSVG: (svgStr) => {
        return svgStr.replace(/>\n<title>([^<]+)<\/title>/g, (match, nodeId) => {
          // We explicitly ignore things with a 't' prefix because they are
          // tables and their first row should be where we expose their
          // data-symbols, which will happen in the xlink node transform regexp.
          if (nodeId.startsWith('t')) {
            return '>';
          }
          const node = builder.nodeIdToNode.get(nodeId);
          if (!node || !node.sym) {
            // Just eat the title if we can't find the node.
            return '>';
          }

          return ` data-symbols=${node.sym.rawName}>`;
        }).replace(/<a xlink:href="([^"]+)" xlink:title="[^"]+">/g, (match, nodeId) => {
          const node = builder.nodeIdToNode.get(nodeId);
          if (!node || !node.sym) {
            return '<g>';
          }
          return `<g data-symbols=${node.sym.rawName}>`;
        }).replace(/<\/a>/g, "</g>");
      }
    };
  }

  /**
   * Create a hierarchy of ul/li tags that attempts to express what the diagram
   * conveys.  This is intended to be presented to screen readers instead of the
   * graphviz graph.
   *
   * It is likely we'll also want to be able to parse this representation and/or
   * its Markdown equivalent as an alternate authorship interface because the
   * accessible blockly effort/experiment has been archived at
   * https://github.com/google/blockly-experimental.  The blockly UI is very
   * mouse-centric and, consistent with the archival of that project, it's not
   * clear that the UI is superior to a more directly presented tree structure.
   *
   * We could provide a bare text parsing implementation as well as a
   * tree-editing UI that might resemble a mail program's filter editing UI.
   * It would consist of a tree widget where each row is a combination of
   * multiple-choice combo-boxes, plus text fields for symbol names.  This is
   * basically what would happen if you flattened the blockly toolbox into the
   * blocks so that the first input of every block was a choice of what block it
   * was and forced all blocks to be in the hierarchy of the root block.  (Which
   * is a thing that can be done in blockly, but limits the benefit of using the
   * UI over using what I'm proposing here.)
   */
  renderToNestedList(builder, doc) {
    // ## Derive Global Info
    // Keys are the from/to edge, values are Arrays of the full
    // { from, to, kind } that we found in the list of edges.
    //
    // The edges are currently stashed at the first common ancestor of the nodes
    // in question (which may get kicked upward when table graphviz labels are
    // in use) for the benefit of the action-determining heuristics.
    const allEdgesFrom = new Map(), allEdgesTo = new Map();
    // Helper to walk all nodes in order to compute global info that we want
    // ahead of our output traversal.
    function traverseForGlobalInfo(node) {
      if (node.edges) {
        for (const edge of node.edges) {
          let fromEdges = allEdgesFrom.get(edge.from);
          if (!fromEdges) {
            fromEdges = [];
            allEdgesFrom.set(edge.from, fromEdges);
          }
          fromEdges.push(edge);

          let toEdges = allEdgesTo.get(edge.to);
          if (!toEdges) {
            toEdges = [];
            allEdgesTo.set(edge.to, toEdges);
          }
          toEdges.push(edge);
        }
      }

      for (const kid of node.kids.values()) {
        traverseForGlobalInfo(kid);
      }
    }
    traverseForGlobalInfo(builder.root);

    // ## Build list hierarchy
    function e(tag, attrs, children) {
      const elem = doc.createElement(tag);

      if (attrs) {
        for (const [name, value] of Object.entries(attrs)) {
          elem.setAttribute(name, value);
        }
      }

      if (children) {
        if (!Array.isArray(children)) {
          children = [children];
        }

        for (const kid of children) {
          // Skip falsey children.
          if (!kid) {
            continue;
          }
          if (typeof(kid) === 'string') {
            elem.appendChild(doc.createTextNode(kid));
          }
          else {
            elem.appendChild(kid);
          }
        }
      }

      return elem;
    }

    function nodeSpan(node) {
      let nodeProps = null;
      if (node.sym) {
        nodeProps = { 'data-symbols': node.sym.rawName };
      }

      const eNode = e(
        'span',
        nodeProps,
        node.computeLabel());

      // If there's a kind associated with the node include that separate from
      // the node's explicit name/label.
      if (node.nodeKind) {
        return e(
          'span',
          null,
          // XXX for now just pass the kind through directly, but we should
          // likely be smarter here, including having the kind for symbol nodes
          // end up using the actual language term (class/union/etc.) rather
          // than requiring the source of the graph to tell us what they are.
          [`${node.nodeKind} `, eNode]);
      }
      return eNode;
    }

    // String mappings per edge direction for each kind on how to label things
    // in the tree.
    const EDGE_KIND_FROM = {
      call: 'Calls',
    };
    const EDGE_KIND_TO = {
      call: 'Called by'
    };

    function renderNodeInto(node, eParent) {
      const eSym = nodeSpan(node);
      const eNode = e(
        'li',
        null,
        [eSym]);

      if (node.kids.size || allEdgesFrom.has(node) || allEdgesTo.has(node)) {
        const eSub = e('ul', null);
        if (node.kids) {
          for (const kid of node.kids.values()) {
            renderNodeInto(kid, eSub);
          }
        }

        let edgesFrom = allEdgesFrom.get(node);
        if (edgesFrom) {
          for (const edge of edgesFrom) {
            const eEdge = e(
              'li',
              null,
              [`${EDGE_KIND_FROM[edge.kind]} `, nodeSpan(edge.to)]);
            eSub.appendChild(eEdge);
          }
        }

        let edgesTo = allEdgesTo.get(node);
        if (edgesTo) {
          for (const edge of edgesTo) {
            const eEdge = e(
              'li',
              null,
              [`${EDGE_KIND_TO[edge.kind]} `, nodeSpan(edge.from)]);
            eSub.appendChild(eEdge);
          }
        }

        eNode.appendChild(eSub);
      }

      eParent.appendChild(eNode);
    }

    const eRoot = e('ul');
    renderNodeInto(builder.root, eRoot);
    return eRoot;
  }
}
