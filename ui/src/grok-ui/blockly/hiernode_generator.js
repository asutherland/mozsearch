import Blockly from 'blockly/core';

import { HierNode, HierBuilder } from '../../grokysis/frontend/diagramming/core_diagram.js';

class InstanceGroupInfo {
  constructor(name) {
    this.groupName = name;
    this.fillColor = null;

    this.symToNode = new Map();
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

    this.instanceGroupsByName = null;

    // The workspace's variable map; this avoids passing it around.
    this.varMap = null;
  }

  async generate({ workspace }) {
    const kb = this.kb;

    // ## Phase 0: Resolve variables to symbols
    // We only want variables that are actually used in the diagram.  It's
    // possible for there to be leftover cruft.
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

    // ## Phase 1 Traversal: Process Settings
    const topBlocks = workspace.getTopBlocks(true);
    for (const topBlock of topBlocks) {
      for (const block of iterBlockAndSuccessors(topBlock)) {
        this._phase1_processBlock(block);
      }
    }

    // ## Phase 2 Traversal: Render to HierNode
    this.symToNode = new Map();
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

  _makeNode(parentNode, name, nodeKind, semanticKind, explicitInstanceGroup,
            identifier) {
    let sym;
    if (identifier) {
      sym = this.idToSym.get(identifier) || null;
      if (!sym) {
        console.warn('failed to resolve id', identifier);
      }
    }

    const node = parentNode.getOrCreateKid(name);
    node.nodeKind = nodeKind;
    node.semanticKind = semanticKind;
    if (sym) {
      node.updateSym(sym);
    }

    let instanceGroup = explicitInstanceGroup;
    if (!instanceGroup && parentNode.instanceGroup) {
      instanceGroup = parentNode.instanceGroup;
    }
    node.instanceGroup = instanceGroup;

    if (sym) {
      if (instanceGroup) {
        instanceGroup.symToNode.set(sym, node);
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
      case 'setting_instance_group':
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

  _phase2_processBlock(parentNode, block, deferredBlocks) {
    let node, iterKids;
    switch (block.type) {
      case 'setting_instance_group':
      case 'diagram_settings': {
        // We already processed settings in phase 1.
        return;
      }

      case 'cluster_process': {
        node = this._makeNode(
          parentNode, block.getFieldValue('NAME'), 'group', 'process');
        iterKids = iterBlockAndSuccessors(block.getInputTargetBlock('CHILDREN'));
        break;
      }
      case 'cluster_thread': {
        node = this._makeNode(
          parentNode, block.getFieldValue('NAME'), 'group', 'thread');
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
          parentNode, name, 'group', kindInitialCaps.toLowerCase());
        iterKids = iterBlockAndSuccessors(block.getInputTargetBlock('CHILDREN'));
        break;
      }

      case 'node_class': {
        const classVar = this.varMap.getVariableById(block.getFieldValue('NAME'));
        const className = classVar.name;

        // We start out as a node and any methods added to us cause us to
        // become a table.
        // XXX actually, right now, we can only do node.  We need to refactor
        // HierBuilder to allow us to use its node action logic for table
        // purposes.  Right now there's a little bit too much Symbol
        // understanding built into Hierbuilder for us to use it.
        node = this._makeNode(parentNode, className, 'node', 'class', null, className);
        iterKids = iterBlockAndSuccessors(block.getInputTargetBlock('METHODS'));
        break;
      }

      case 'node_instance': {
        const igVar = this.varMap.getVariableById(block.getFieldValue('INST_NAME'));
        const igi = this.instanceGroupsByName.get(igVar.name);

        const classVar = this.varMap.getVariableById(block.getFieldValue('NAME'));
        const className = classVar.name;

        node = this._makeNode(parentNode, className, 'node', 'instance', igi, className);
        iterKids = iterBlockAndSuccessors(block.getInputTargetBlock('METHODS'));
        break;
      }

      case 'node_method': {
        // XXX ignore these for now.
        break;
      }

      case 'edge_call': {
        deferredBlocks.push([block, parentNode]);
        break;
      }

      case 'edge_instance_call': {
        deferredBlocks.push([block, parentNode]);
        break;
      }

      default: {
        throw new Error(`unsupported block type: ${block.type}`);
      }
    }

    if (iterKids) {
      for (const childBlock of iterKids) {
        this._phase2_processBlock(node, childBlock, deferredBlocks);
      }
    }
  }

  _processDeferredBlock(rootNode, block, parentNode) {
    const edgeCommon = (explicitInstanceGroup) => {
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
      } else if (parentNode.instanceGroup) {
        otherNode = parentNode.instanceGroup.symToNode.get(callSym);
      }
      if (!explicitInstanceGroup && !otherNode) {
        otherNode = this.symToNode.get(callSym);
      }
      if (!otherNode) {
        console.warn('unable to find call target', callSym);
      }

      const ancestorNode = HierNode.findCommonAncestor(parentNode, otherNode);
      if (ancestorNode) {
        ancestorNode.edges.push({ from: parentNode, to: otherNode, kind: 'call' });
      } else {
        console.warn('skipping edge due to lack of ancestor', parentNode, otherNode);
      }
    };

    switch (block.type) {
      case 'edge_instance_call': {
        const igVar =
          this.varMap.getVariableById(block.getFieldValue('INST_NAME'));
        const igi = this.instanceGroupsByName.get(igVar.name);
        edgeCommon(igi);
        break;
      }

      case 'edge_call': {
        edgeCommon(null);
        break;
      }

      default: {
        throw new Error(`unsupported block type: ${block.type}`);
      }
    }
  }
}
