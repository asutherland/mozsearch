import React from 'react';

import ClassDiagram from '../diagrams/class_diagram.jsx';

export class DiagramSheet extends React.Component {
  constructor(props) {
    super(props);
  }

  render() {
    return (
      <ClassDiagram {...this.props} />
    );
  }
}

export class DiagramModel {
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

/**
 * Evolving.  Currently supports:
 * - deserializing a serialized diagram, but I don't think they ever get
 *   serialized yet?
 *   - TODO: support serializing
 * - creating an auto-diagram from a given diagram type.
 */
export let DiagramSheetBinding = {
  icon: 'pencil',
  slotName: 'diagram',
  spawnable: 'Diagram',
  makeModel(sessionThing, persisted) {
    const { grokCtx } = sessionThing;
    let diagram;
    if (persisted.serialized) {
      diagram = grokCtx.kb.restoreDiagram(persisted.serialized);
    } else if (persisted.diagramType) {
      const symInfo = grokCtx.kb.lookupRawSymbol(persisted.rawSymbol);
      diagram = grokCtx.kb.diagramSymbol(symInfo, persisted.diagramType);
    } else {
      diagram = grokCtx.kb.restoreDiagram(null);
    }
    return new DiagramModel({ sessionThing, diagram });
  },

  makeLabelForModel(sessionThing, model) {
    return `Diagram: ${model.diagram.name}`;
  },

  makeRichLabelInfoForModel(sessionThing, model) {
    return {
      primary: model.diagram.name,
      secondary: "Diagram",
      actions: [],
    };
  },

  makeWidgetForModel(sessionThing, model) {
    return (
      <DiagramSheet
        sessionThing={ model.sessionThing }
        diagram={ model.diagram }
        />
    );
  }
};
