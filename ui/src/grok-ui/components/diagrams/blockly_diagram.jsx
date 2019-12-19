import React from 'react';

import DirtyingComponent from '../dirtying_component.js';

/**
 * This is largely just a duplicate of the ClassDiagram widget, but this
 * will have some additional special-casing:
 * - We want to display an "edit" icon on the diagram when the diagram isn't
 *   already directly hooked up to a blockly editor.  In that case, we should
 *   trigger the opening of a blockly diagram tab with the current source XML
 *   of the diagram.
 */
export default class BlocklyDiagram extends DirtyingComponent {
  constructor(props) {
    super(props, 'diagram');

    this.diagramRef = React.createRef();
  }

  componentDidMount() {
    super.componentDidMount();
    // don't render if there's no DOM node to render into or the generator
    // hasn't yet produced a HierNode representation for us.
    // XXX we need a path for the pre-rendered diagram case.
    if (this.diagramRef.current && this.props.model.generator) {
      const { diagram, model } = this.props;
      const grokCtx = diagram.grokCtx;
      // We diverge from ClassDiagram here.
      const { dot, fixupSVG } = diagram.renderToSVG(model.generator);
      //console.log('rendering DOT:\n' + dot);
      grokCtx.vizJs.renderString(dot, {
        engine: "dot",
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
