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
      const { dot, settings, fixupSVG } = diagram.lowerToGraphviz();
      if (window.DEBUG_DIAGRAM) {
        console.log('rendering DOT:\n' + dot);
      }
      grokCtx.vizJs.renderString(dot, {
        engine: settings.engine,
        format: "svg",
      }).then((rawSvg) => {
        const svgStr = fixupSVG(rawSvg);

        const container = this.diagramRef.current;
        // Graph rendering is an async process, it's possible the widget ends up
        // unmounted by the time the render occurs.
        if (!container) {
          return;
        }
        container.innerHTML = svgStr;
        if (this.props.shrinkToFit) {
          const svgElem = container.firstElementChild;
          svgElem.removeAttribute('width');
          svgElem.removeAttribute('height');
          svgElem.setAttribute(
            "preserveAspectRatio", "xMinYMin meet");
          svgElem.setAttribute(
            "style", "width: 100%; height: 100%;");
        }
      });
    }
  }

  componentDidUpdate() {
    // we do the same thing on mount and update.
    this.componentDidMount();
  }

  render() {
    let cssProps;
    if (this.props.shrinkToFit) {
      cssProps = {
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        flexGrow: 0,
        flexShrink: 1,
      };
    }
    return <div style={ cssProps } ref={ this.diagramRef }></div>;
  }
}
