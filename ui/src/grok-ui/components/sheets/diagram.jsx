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

export let DiagramSheetBinding = {
  icon: 'pencil',
  slotName: 'diagram',
  spawnable: 'Diagram',
  makeModel(sessionThing, persisted) {
    const diagram =
      sessionThing.grokCtx.kb.restoreDiagram(persisted.serialized || null);
    return new DiagramModel({ sessionThing, diagram });
  },

  makeLabelForModel(sessionThing, model) {
    return model.diagram.name;
  },

  makeRichLabelInfoForModel(sessionThing, model) {
    return {
      primary: model.diagram.name,
      secondary: "",
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
