import Blockly from 'blockly/core';

import { HierNode, HierBuilder } from '../../grokysis/frontend/diagramming/core_diagram.js';

class InstanceGroupInfo {
  constructor(name) {
    this.groupName = name;
    this.fillColor = null;
    this.rank = null;

    this.symToNode = new Map();
  }

  computeClusterStyling(hierNode) {
    // If the node's parent shares the same instance group, there's no need to
    // also style us.
    if (hierNode.parent && hierNode.parent.instanceGroup === this) {
      return '';
    }

    if (this.fillColor) {
      return `style=filled\ncolor="${this.fillColor}"\n`;
    }

    return '';
  }

  computeNodeStyling(hierNode) {
    // If the node's parent shares the same instance group, there's no need to
    // also style us.
    if (hierNode.parent && hierNode.parent.instanceGroup === this) {
      return '';
    }

    if (this.fillColor) {
      return `, style=filled, fillcolor="${this.fillColor}"`;
    }

    return '';
  }

  computeTableStyling(hierNode) {
    // If the node's parent shares the same instance group, there's no need to
    // also style us.
    if (hierNode.parent && hierNode.parent.instanceGroup === this) {
      return '';
    }

    if (this.fillColor) {
      return `bgcolor="${this.fillColor}"`;
    }

    return '';
  }

  /**
   * Produce any top-level graph info for the group.
   */
  renderTopLevelDot() {
    if (this.rank && this.symToNode.size) {
      const nodeIds = [];
      for (const node of this.symToNode.values()) {
        if (node.rankId) {
          nodeIds.push(node.rankId);
        }
      }
      return `{ rank="${this.rank}"; ${nodeIds.join('; ')}; }\n`;
    }
    return '';
  }
}

function iterBlockAndSuccessors(initialBlock) {
  let curBlock = initialBlock;
  return {
    [Symbol.iterator]() {
      return this;
    },

    next() {
      if (!curBlock) {
        return { done: true };
      }

      const rval = { value: curBlock, done: false };
      curBlock = curBlock.getNextBlock();
      return rval;
    }
  };
}

/**
 * Consumes a workspace and produces a HierNode tree representation.
 *
 * Generation has the following broad steps:
 * - The list of variables is asynchronously resolved from identifiers into
 *   symbols.
 * - The workspace is synchronously traversed to generate the HierNode
 *   representation.
 */
export class HierNodeGenerator extends HierBuilder {
  constructor({ kb }) {
    super();

    this.kb = kb;


    // Maps identifier strings to searchfox SymbolInfo instances.
    this.idToSym = null;
    /**
     * Maps "global" non-instanced symbols to their HierNode instances.
     */
    this.symToNode = null;
    /**
     * This contains all of the entries from instance groups, except when
     * a collision would happen (more than one value for a given key), we
     * replace the value with `null` to convey that there is no ambiguous
     * resolution in this case.
     *
     * This is immediately motivated by the change to use instance groups to
     * support rank configuration purposes, but in general seems to be a useful
     * mechanism to not require thinking about groups too much until multiple
     * instances of a symbol exist in a graph.
     */
    this.fallbackSymToNode = null;

    this.instanceGroupsByName = null;

    // The workspace's variable map; this avoids passing it around.
    this.varMap = null;
  }

  /**
   * Helper for phase 1 identifier resolution.
   */
  _lookupIdentifier() {

  }

  async generate({ workspace }) {
    const kb = this.kb;

    // ## Phase 0: Learn about Instance Groups
    // Previously we also extracted identifiers here, but we now do that in
    // phase 1.
    const blVariables = Blockly.Variables.allUsedVarModels(workspace);
    this.varMap = workspace.getVariableMap();
    const idToSym = this.idToSym = new Map();
    const badIdentifiers = [];
    const idPromises = [];

    const instanceGroupsByName = this.instanceGroupsByName = new Map();

    for (const blVar of blVariables) {
      if (blVar.type === 'instance-group') {
        const igi = new InstanceGroupInfo(blVar.name);
        instanceGroupsByName.set(igi.groupName, igi);
        // This is the hook that lets the instance groups contribute top-level
        // dot output for rank=same/etc.
        this.topLevelExtra.push(igi);
      }
      // must be 'identifier'

      idPromises.push(kb.findSymbolsGivenId(blVar.name).then((symSet) => {
        const firstSym = symSet && Array.from(symSet)[0];
        idToSym.set(blVar.name, firstSym);
        if (!firstSym) {
          badIdentifiers.push(blVar.name);
        }
      }));
    }

    // Wait for all of the promises to resolve, which means all of their
    // side-effects to `varToSym` have happened already.
    await Promise.all(idPromises);

    // ## Phase 1 Traversal: Process Settings and Extract Identifiers.
    // The blockly diagram inherently has hierarchy that allows us to infer
    // qualified identifiers.  So rather than exclusively using the variable
    // names,
    const topBlocks = workspace.getTopBlocks(true);
    for (const topBlock of topBlocks) {
      for (const block of iterBlockAndSuccessors(topBlock)) {
        this._phase1_processBlock(block);
      }
    }

    // ## Phase 2 Traversal: Render to HierNode
    this.symToNode = new Map();
    this.fallbackSymToNode = new Map();
    const rootNode = this.root;
    rootNode.action = 'flatten';
    rootNode.id = rootNode.edgeInId = rootNode.edgeOutId = '';

    // Request that the blocks be ordered so that the user has some control over
    // the graph.
    const deferredBlocks = [];
    for (const topBlock of topBlocks) {
      for (const block of iterBlockAndSuccessors(topBlock)) {
        this._phase2_processBlock(rootNode, block, deferredBlocks);
      }
    }

    for (const [block, parentNode] of deferredBlocks) {
      this._processDeferredBlock(rootNode, block, parentNode);
    }

    this.determineNodeActions();

    return {
      rootNode,
      badIdentifiers
    };
  }

  _makeNode(srcBlock, parentNode, name, nodeKind, semanticKind,
            explicitInstanceGroup, identifier) {
    let sym;
    if (identifier) {
      sym = this.idToSym.get(identifier) || null;
      if (!sym) {
        srcBlock.setDisabled(true);
        console.warn('failed to resolve id', identifier);
      } else {
        srcBlock.setDisabled(false);
      }
    }
    // Make the name relative to the parent node so that when a method is
    // grouped under its parent class we don't display the class name when
    // displaying the method.
    if (sym && parentNode.sym) {
      name = sym.computeNameGivenParentSym(parentNode.sym);
    }

    let instanceGroup = explicitInstanceGroup;
    if (!instanceGroup && parentNode.instanceGroup) {
      instanceGroup = parentNode.instanceGroup;
    }

    // We need to parameterize the hierarchy name by the group, otherwise we'll
    // coalesce them visually.
    let hierarchyName = name;
    if (instanceGroup) {
      hierarchyName += '__' + instanceGroup.groupName;
    }

    const node = parentNode.getOrCreateKid(hierarchyName, name);
    node.nodeKind = nodeKind;
    node.semanticKind = semanticKind;
    if (sym) {
      node.updateSym(sym);
    }
    node.instanceGroup = instanceGroup;

    if (sym) {
      if (instanceGroup) {
        instanceGroup.symToNode.set(sym, node);
        // Add this node to the fallback map.  If there's already something in
        // the map and it's not already this node (which in the future could
        // belong to multiple groups), then collide union it to null.
        if (this.fallbackSymToNode.has(sym)) {
          if (this.fallbackSymToNode.get(sym) !== node) {
            this.fallbackSymToNode.set(sym, null);
          }
        } else {
          this.fallbackSymToNode.set(sym, node);
        }
      } else {
        this.symToNode.set(sym, node);
      }
    }

    return node;
  }

  _phase1_processSettingsBlock(block) {
    let iterKids;
    switch (block.type) {
        case 'setting_instance_group': {
          const igVar =
            this.varMap.getVariableById(block.getFieldValue('INST_NAME'));
          const igi = this.instanceGroupsByName.get(igVar.name);
          igi.fillColor = block.getFieldValue('INST_COLOR');
          break;
        }

        case 'setting_group_rank': {
          const igVar =
            this.varMap.getVariableById(block.getFieldValue('INST_NAME'));
          const igi = this.instanceGroupsByName.get(igVar.name);
          igi.rank = block.getFieldValue('RANK');
          break;
        }

        case 'setting_algo': {
          this.settings.layoutDir = block.getFieldValue('LAYOUT_DIR');
          this.settings.engine = block.getFieldValue('ENGINE');
          break;
        }

        case 'diagram_settings': {
          iterKids =
            iterBlockAndSuccessors(block.getInputTargetBlock('SETTINGS'));
          break;
        }

        default: {
          throw new Error(`unknown setting block: ${block.type}`);
        }
    }

    if (iterKids) {
      for (const childBlock of iterKids) {
        this._phase1_processSettingsBlock(childBlock);
      }
    }
  }

  _phase1_processBlock(block) {
    switch (block.type) {
      case 'setting_algo':
      case 'setting_instance_group':
      case 'setting_group_rank':
      case 'diagram_settings': {
        // When we see a settings block, we transfer control flow to
        // _processSettingsBlock and it handles any recursion.  So we return
        // rather than break.
        this._phase1_processSettingsBlock(block);
        return;
      }

      default: {
        // keep walking.
        break;
      }
    }
  }

  _extractInstanceGroup(block) {
    if (!block) {
      return null;
    }

    const igVar = this.varMap.getVariableById(block.getFieldValue('INST_NAME'));
    const igi = this.instanceGroupsByName.get(igVar.name);

    return igi;
  }

  _phase2_processBlock(parentNode, block, deferredBlocks) {
    let node, iterKids;

    switch (block.type) {
      case 'diagram_settings': {
        // We already processed settings in phase 1.
        // We deal with all setting_* in the default.
        return;
      }

      case 'cluster_process': {
        node = this._makeNode(
          block, parentNode, block.getFieldValue('NAME'), 'group', 'process');
        iterKids = iterBlockAndSuccessors(block.getInputTargetBlock('CHILDREN'));
        break;
      }
      case 'cluster_thread': {
        node = this._makeNode(
          block, parentNode, block.getFieldValue('NAME'), 'group', 'thread');
        iterKids = iterBlockAndSuccessors(block.getInputTargetBlock('CHILDREN'));
        break;
      }
      case 'cluster_client': {
        const kindField = block.getField('CLIENT_KIND');
        const kindInitialCaps = kindField.getText(); // the presentation string.
        const clientName = block.getFieldValue('NAME');
        // For now we fold the client kind into the name
        const name = `${kindInitialCaps} ${clientName}`;
        node = this._makeNode(
          block, parentNode, name, 'group', kindInitialCaps.toLowerCase(),
          this._extractInstanceGroup(block.getInputTargetBlock('INSTANCE')),
          null);
        iterKids = iterBlockAndSuccessors(block.getInputTargetBlock('CHILDREN'));
        break;
      }

      case 'node_class': {
        const classVar = this.varMap.getVariableById(block.getFieldValue('NAME'));
        const className = classVar.name;

        node = this._makeNode(
          block, parentNode, className, 'node', 'class',
          this._extractInstanceGroup(block.getInputTargetBlock('INSTANCE')),
          className);
        iterKids = iterBlockAndSuccessors(block.getInputTargetBlock('METHODS'));
        break;
      }

      case 'node_method': {
        // this is largely the same as the class case above.
        const methodVar = this.varMap.getVariableById(block.getFieldValue('NAME'));
        const methodName = methodVar.name;

        node = this._makeNode(
          block, parentNode, methodName, 'node', 'method',
          this._extractInstanceGroup(block.getInputTargetBlock('INSTANCE')),
          methodName);
        iterKids = iterBlockAndSuccessors(block.getInputTargetBlock('METHODS'));
        break;
      }

      case 'node_field': {
        // this is largely the same as the method case above.
        const fieldVar = this.varMap.getVariableById(block.getFieldValue('NAME'));
        const fieldName = fieldVar.name;

        node = this._makeNode(
          block, parentNode, fieldName, 'node', 'field',
          this._extractInstanceGroup(block.getInputTargetBlock('INSTANCE')),
          fieldName);
        iterKids = iterBlockAndSuccessors(block.getInputTargetBlock('METHODS'));
        break;
      }

      case 'edge_use':
      case 'edge_call':
      case 'edge_ref': {
        deferredBlocks.push([block, parentNode]);
        break;
      }

      case 'instance_group_ref': {
        // Ignore these when they're not attached to something, which is the
        // case if we're seeing them here, because they must be top-level.
        break;
      }

      default: {
        // Avoid having to add all new setting blocks to the case.
        if (block.type.startsWith('setting_')) {
          break;
        }
        // I had this throw before, but that clearly ends up brittle for
        // modifier blocks like instance_group_refs where in testing one might
        // not think to let them be top-level.
        console.warn(`unsupported block type observed: ${block.type}`);
        break;
      }
    }

    if (iterKids) {
      for (const childBlock of iterKids) {
        this._phase2_processBlock(node, childBlock, deferredBlocks);
      }
    }
  }

  /**
   * Happen to map from the (non-localized) value like STRONG to style.
   */
  _mapEdgeRefStrengthToEdgeStyle(strengthFieldValue) {
    switch (strengthFieldValue) {
      case 'STRONG':
        return 'solid';
      case 'WEAK':
        return 'dashed';
      case 'RAW':
      default:
        return 'dotted';
    }
  }

  _processDeferredBlock(rootNode, block, parentNode) {
    const edgeCommon = (explicitInstanceGroup, edgeKind, edgeStyle) => {
      const callVar = this.varMap.getVariableById(block.getFieldValue('CALLS_WHAT'));
      const callName = callVar.name;
      const callSym = this.idToSym.get(callName);
      if (!callSym) {
        console.warn('failed to resolve call id', callName);
        return;
      }

      let otherNode;
      if (explicitInstanceGroup) {
        otherNode = explicitInstanceGroup.symToNode.get(callSym);
      }
      if (!otherNode && parentNode.instanceGroup) {
        otherNode = parentNode.instanceGroup.symToNode.get(callSym);
      }
      if (!otherNode) {
        otherNode = this.symToNode.get(callSym);
      }
      if (!otherNode) {
        otherNode = this.fallbackSymToNode.get(callSym);
      }
      if (!otherNode) {
        console.warn('unable to find call target', callSym);
      }

      const ancestorNode = HierNode.findCommonAncestor(parentNode, otherNode);
      if (ancestorNode) {
        ancestorNode.edges.push({
          from: parentNode,
          to: otherNode,
          kind: edgeKind,
          style: edgeStyle,
        });
        //console.log('generating edge at ancestor', ancestorNode, parentNode, otherNode);
      } else {
        console.warn('skipping edge due to lack of ancestor', parentNode, otherNode);
      }
    };

    switch (block.type) {
      case 'edge_use': {
        edgeCommon(
          this._extractInstanceGroup(block.getInputTargetBlock('INSTANCE')),
          'use',
          'solid');
        break;
      }

      case 'edge_call': {
        edgeCommon(
          this._extractInstanceGroup(block.getInputTargetBlock('INSTANCE')),
          'call',
          'solid');
        break;
      }

      case 'edge_ref': {
        edgeCommon(
          this._extractInstanceGroup(block.getInputTargetBlock('INSTANCE')),
          'ref',
          this._mapEdgeRefStrengthToEdgeStyle(block.getFieldValue('STRENGTH')));
        break;
      }

      default: {
        throw new Error(`unsupported block type: ${block.type}`);
      }
    }
  }
}
