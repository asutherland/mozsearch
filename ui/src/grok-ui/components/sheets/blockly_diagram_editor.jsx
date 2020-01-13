import Blockly from 'blockly/core';
import React from 'react';
import Split from 'react-split';

import BlocklyDiagram from '../diagrams/blockly_diagram.jsx';

import BlocklyEditor from '../blockly/editor.jsx';

import { HierNodeGenerator } from '../../blockly/hiernode_generator.js';

import './blockly_diagram_editor.css';

const Block = (p) => {
  const { children, ...props } = p;
  props.is = "blockly";
  return React.createElement("block", props, children);
};

const Category = (p) => {
  const { children, ...props } = p;
  props.is = "blockly";
  return React.createElement("category", props, children);
};

const Button = (p) => {
  const { children, ...props } = p;
  props.is = "blockly";
  return React.createElement("button", props, children);
};

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

    this.editorRef = React.createRef();
  }

  componentDidMount() {
    // The header splitter generates this event when it gets resized.
    this.props.sessionThing.handleBroadcastMessage('window', 'resize', () => {
      this.updateBlocklySize();
    });
  }

  componentWillUnmount() {
    this.props.sessionThing.stopHandlingBroadcastMessage('window', 'resize');
  }

  updateBlocklySize() {
    if (this.editorRef.current) {
      this.editorRef.current.updateSize();
    }
  }

  render() {
    const model = this.props.model;

    const onChange = (workspace, xml) => {
      model.workspaceUpdated(workspace, xml);
    };

    const buttonCallbacks = {
      'new_instance_group': (button) => {
        const workspace = button.getTargetWorkspace();
        Blockly.Variables.createVariable(workspace, null, 'instance-group');
      },
      'new_class_variable': (button) => {
        const workspace = button.getTargetWorkspace();
        Blockly.Variables.createVariable(workspace, null, 'identifier');
      }
    };

    return (
      <Split className="blocklyDiagramEditorSheet"
        onDragEnd={ () => { this.updateBlocklySize(); } }
        >
        <BlocklyEditor
          ref={ this.editorRef }
          initialXml={ model.xml }
          onChange={ onChange }
          buttonCallbacks={ buttonCallbacks }
          >
          <Category name="Grouping">
            <Block type="cluster_process" />
            <Block type="cluster_thread" />
            <Block type="cluster_client" />
            <Button
              text="New Group"
              callbackKey="new_instance_group"
              />
            <Block type="instance_group_ref" />
          </Category>
          <Category name="Classes">
            <Button
              text="New Class / Method Reference"
              callbackKey="new_class_variable"
              />
            <Block type="node_class" />
            <Block type="node_method" />
            <Block type="edge_call" />
          </Category>
          <Category name="Settings">
            <Block type="diagram_settings" />
            <Block type="setting_instance_group" />
            <Block type="setting_group_rank" />
            <Block type="setting_algo" />
          </Category>
        </BlocklyEditor>
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
    this.svg = null;

    this.generator = null;
  }

  async workspaceUpdated(workspace, xml) {
    this.xml = xml;
    this.sessionThing.updatePersistedState({
      xml,
      serialized: null
    });
    // We can just update the diagram directly, the widget binds directly to
    // the diagram.
    const generator = new HierNodeGenerator({
      kb: this.sessionThing.grokCtx.kb,
    });
    await generator.generate({ workspace });
    if (window.DEBUG_DIAGRAM) {
      console.log('just generated', generator);
    }

    this.generator = generator;
    this.diagram.markDirty();
  }

  exportMarkdownBlock() {
    // We currently just serialize the source definition (XML) and the SVG
    // byproduct.  There isn't really a benefit to saving off the HierNode rep
    // at this time.
    const data = {
      mode: "blockly-v1",
      xml: this.xml,
      svg: this.svg
    };
    return "```searchfox-graph-v1\n" + JSON.stringify(data, null, 2) +
             "\n```\n";
  }

  destroy() {
  }

  onAddEdge({ from, to }) {
  }
}

export let BlocklyDiagramEditorBinding = {
  icon: 'paint brush',
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
        key={ sessionThing.id }
        sessionThing={ model.sessionThing }
        model={ model }
        />
    );
  }
};
