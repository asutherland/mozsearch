import React from 'react';

import Split from 'react-split';

import BlocklyDiagram from '../diagrams/class_diagram.jsx';

import ReactBlocklyComponent from 'react-blockly';

/**
 * The blockly digram editor is currently analogous to the HierNode tree in the
 * class diagram pipeline of nodes/edges => hierbuilder => HierNode tree =>
 * graphviz dot syntax.
 *
 * The Class Diagram attempts to take the nodes/edges one cares about and
 * build an appropriate graph from that.  For the blockly editor, the idea is
 * the graph author knows exactly what they want and our representation just
 * layers a bit of semantics and presentation styling.  Also, it lets us avoid
 * needing to parse dot files or roundtrip through them.
 **/

export class BlocklyDiagramEditorSheet extends React.Component {
  constructor(props) {
    super(props);
  }

  render() {
    return (
      <Split>
        <ReactBlocklyComponent />
        <BlocklyDiagram {...this.props} />
      </Split>
    );
  }
}

export class BlocklyDiagramEditorModel {
  constructor({ sessionThing, diagram }) {
    this.sessionThing = sessionThing;
    this.diagram = diagram;

    this.sessionThing.handleSlotMessage(
      'addEdge', this.onAddEdge.bind(this));
  }

  destroy() {
    this.sessionThing.stopHandlingSlotMessage('addEdge');
  }

  onAddEdge({ from, to }) {
    this.diagram.ensureEdge(from, to);
  }
}

export let BlocklyDiagramEditorBinding = {
  slotName: 'blockly-diagram',
  spawnable: 'Blockly Diagram',
  makeModel(sessionThing, persisted) {
    const diagram =
      sessionThing.grokCtx.kb.restoreDiagram(persisted.serialized || null);
    return new BlocklyDiagramEditorModel({ sessionThing, diagram });
  },

  makeLabelForModel(sessionThing, model) {
    return model.diagram.name;
  },

  makeWidgetForModel(sessionThing, model) {
    return (
      <BlocklyDiagramEditorSheet
        sessionThing={ model.sessionThing }
        diagram={ model.diagram }
        />
    );
  }
};
