import React from 'react';

import Split from 'react-split';

import BlocklyDiagram from '../diagrams/blockly_diagram.jsx';

import BlocklyEditor from '../blockly/editor.jsx';

import { HierNodeGenerator } from '../../blockly/hiernode_generator.js';

import './blockly_diagram_editor.css';

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
    const model = this.props.model;

    const onChange = (workspace, xml) => {
      model.workspaceUpdated(workspace, xml);
    };

    return (
      <Split className="blocklyDiagramEditorSheet">
        <BlocklyEditor
          initialXml={ model.xml }
          onChange={ onChange }
          />
        <BlocklyDiagram
          sessionThing={ model.sessionThing }
          diagram={ model.diagram }
          model={ model }
          />
      </Split>
    );
  }
}

export class BlocklyDiagramEditorModel {
  constructor({ sessionThing, xml, diagram }) {
    this.sessionThing = sessionThing;
    this.diagram = diagram;
    this.xml = xml;

    this.generator = null;
  }

  async workspaceUpdated(workspace, xml) {
    this.sessionThing.updatePersistedState({
      xml,
      serialized: null
    });
    // We can just update the diagram directly, the widget binds directly to
    // the diagram.
    this.generator = new HierNodeGenerator({
      kb: this.sessionThing.grokCtx.kb,
    });
    await this.generator.generate({ workspace });
    this.diagram.markDirty();
  }

  destroy() {
  }

  onAddEdge({ from, to }) {
  }
}

export let BlocklyDiagramEditorBinding = {
  spawnable: 'Blockly Diagram',
  makeModel(sessionThing, persisted) {
    const diagram =
      sessionThing.grokCtx.kb.restoreDiagram(persisted.serialized || null);
    return new BlocklyDiagramEditorModel({
      sessionThing,
      diagram,
      xml: persisted.xml || null
    });
  },

  makeLabelForModel(sessionThing, model) {
    return 'Blockly ' + model.diagram.name;
  },

  makeWidgetForModel(sessionThing, model) {
    return (
      <BlocklyDiagramEditorSheet
        sessionThing={ model.sessionThing }
        model={ model }
        />
    );
  }
};
