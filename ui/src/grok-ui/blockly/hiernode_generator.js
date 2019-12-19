import Blockly from 'blockly/core';

import { HierNode, HierBuilder } from '../../grokysis/frontend/diagramming/class_diagram.js';

/**
 * Consumes a workspace and produces a HierNode tree representation.
 *
 * Generation has the following phases:
 * - The list of variables is asynchronously resolved from identifiers into
 *   symbols.
 * - The workspace is synchronously traversed to generate the HierNode
 *   representation.
 */
export class HierNodeGenerator extends HierBuilder {
  constructor({ kb }) {
    super();

    this.kb = kb;

    this.idToSym = null;
    this.symToNode = null;
  }

  async generate({ workspace }) {
    const kb = this.kb;

    // -- Resolve variables to symbols
    // We only want variables that are actually used in the diagram.  It's
    // possible for there to be leftover cruft.
    const blVariables = Blockly.Variables.allUsedVarModels(workspace.getVariableMap());
    const idToSym = this.idToSym = new Map();
    const badIdentifiers = [];
    const idPromises = [];

    for (const blVar of blVariables) {
      idPromises.push(kb.findSymbolsGivenId(blVar.name)).then((symSet) => {
        const firstSym = Array.from(symSet)[0];
        // This could absolutely be undefined, but we want an entry.
        idToSym.set(blVar.name, firstSym);
        if (!firstSym) {
          badIdentifiers.push(blVar.name);
        }
      });
    }

    // Wait for all of the promises to resolve, which means all of their
    // side-effects to `varToSym` have happened already.
    await Promise.all(idPromises);

    // -- Traverse the diagram, rendering to HierNode
    const symToNode = this.symToNode = new Map();
    const rootNode = this.root;
    rootNode.action = 'flatten';
    rootNode.id = rootNode.edgeInId = rootNode.edgeOutId = '';

    // Request that the blocks be ordered so that the user has some control over
    // the graph.
    const blocks = workspace.getTopBlocks(true);
    const deferredBlocks = [];
    for (const block of blocks) {
      this._processBlock(rootNode, block, idToSym, symToNode, deferredBlocks);
    }

    for (const [block, parentNode] of deferredBlocks) {
      this._processDeferredBlock(rootNode, block, parentNode);
    }

    return {
      rootNode,
      badIdentifiers
    };
  }

  _makeNode(parentNode, name, action) {
    const node = parentNode.getOrCreateKid(name);
    let prefix;
    switch (action) {
      case 'cluster':
        prefix = 'cluster_c';
        break;
      default:
      case 'node':
        prefix = 'n';
        break;
    }
    node.id = prefix + (this.idCounter++);
    this.nodeIdToNode.set(node.id, node);
  }

  _processBlock(parentNode, block, deferredBlocks) {
    let node;
    switch (block.type) {
      case 'cluster_process':
      case 'cluster_thread': {
        node = this._makeNode(parentNode, block.getFieldValue('NAME'), 'cluster');
        break;
      }

      case 'node_class': {
        const className = block.getFieldValue('NAME');
        const classSym = this.idToSym.get(className);
        if (!classSym) {
          console.warn('failed to resolve id', className);
          return;
        }
        // We start out as a node and any methods added to us cause us to
        // become a table.
        // XXX actually, right now, we can only do node.  We need to refactor
        // HierBuilder to allow us to use its node action logic for table
        // purposes.  Right now there's a little bit too much Symbol
        // understanding built into Hierbuilder for us to use it.
        node = this._makeNode(parentNode, classSym.simpleName, 'node');
        if (this.symToNode.has(className)) {
          console.warn('clobbering already existing graph node for class', className);
        }
        this.symToNode.set(className, node);
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

      default: {
        throw new Error(`unsupported block type: ${block.type}`);
      }
    }

    for (const childBlock of block.getChildren(true)) {
      this._processBlock(node, childBlock, deferredBlocks);
    }
  }

  _processDeferredBlock(rootNode, block, parentNode) {
    switch (block.type) {
      case 'edge_call': {
        const callName = block.getFieldValue('CALLS_WHAT');
        const callSym = this.idToSym.get(callName);
        if (!callSym) {
          console.warn('failed to resulve call id', callName);
          return;
        }
        const otherNode = this.symToNode.get(callSym);
        const ancestorNode = HierNode.findCommonAncestor(parentNode, otherNode);
        ancestorNode.edges.push({ from: parentNode, to: otherNode });
        break;
      }

      default: {
        throw new Error(`unsupported block type: ${block.type}`);
      }
    }
  }
}
