import React from 'react';

import DirtyingComponent from '../dirtying_component.js';

export default class ClassDiagram extends DirtyingComponent {
  constructor(props) {
    super(props, 'diagram');

    this.diagramRef = React.createRef();
  }

  componentDidMount() {
    super.componentDidMount();
    if (this.diagramRef.current) {
      const diagram = this.props.diagram;
      const grokCtx = diagram.grokCtx;
      const { dot } = diagram.lowerToGraphviz();
      //console.log('rendering DOT:\n' + dot);
      grokCtx.vizJs.renderSVGElement(dot).then((elem) => {
        const container = this.diagramRef.current;
        // Graph rendering is an async process, it's possible the widget ends up
        // unmounted by the time the render occurs.
        if (!container) {
          return;
        }
        if (container.firstChild) {
          container.removeChild(container.firstChild);
        }
        container.appendChild(elem);
      });
    }
  }

  componentDidUpdate() {
    // we do the same thing on mount and update.
    this.componentDidMount();
  }

  render() {
    return <div ref={ this.diagramRef }></div>;
  }
}
