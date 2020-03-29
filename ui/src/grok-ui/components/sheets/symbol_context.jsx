import EE from 'eventemitter3';
import React from 'react';

import { Header } from 'semantic-ui-react';

import DirtyingComponent from '../dirtying_component.js';

import ClassDiagram from '../diagrams/class_diagram.jsx';
import PathCrumbed from '../raw_details/path_crumbed.jsx';

import './symbol_context.css';

/**
 * The SymbolContextSheet is intended to be a Heads Up Display for information
 * on the currently hovered/clicked/selected symbol in a source view.  This is
 * the evolution of the mega-menu effort.
 *
 * ## UI Paradigm
 *
 * This sheet is intended to be displayed in a consistent location in the page
 * that does not interfere with the source listing.  On wide displays, this
 * might be on the right side of the window; on tall displays, this might be at
 * the top or the bottom.
 *
 * The original DXR/searchfox compact menu continues to be presented when the
 * user clicks on a symbol.  As each menu option is hovered, the context sheet
 * switches among its (dynamic) tabs.  When the menu isn't presented, we may
 * also expose some type of hotkey mechanism to switch between the tabs for
 * hovering purposes.
 **/

export class SymbolContextSheet extends DirtyingComponent {
  constructor(props) {
    super(props, 'model');
  }

  render() {
    const symInfo = this.props.model.symInfo;

    if (!symInfo) {
      return <div></div>;
    }

    const grokCtx = this.props.model.sessionThing.grokCtx;

    let nodes = [];

    const emitInfo = (label, id, card) => {
      nodes.push(
        <div
          key={ `${id}-divider` }
          className="symbolContextDivider">
          <div className="symbolContextDivider__label">{ label }</div>
        </div>
      );
      nodes.push(card);
    };

    // # Summary Card
    if (symInfo.fullName) {
      emitInfo('Summary', 'summary',
        <div
          key='summary-card'
          className="symbolContextCard"
          >
            <Header size="large">{ symInfo.simpleName }</Header>
            <Header size="small">{ symInfo.fullName }</Header>
        </div>
      );
    }

    // # Declaration Card
    if (symInfo.declPeek) {
      let maybePath;
      if (symInfo.declFileInfo) {
        maybePath = (
          <PathCrumbed
            grokCtx={ grokCtx }
            path={ symInfo.declFileInfo.path }
            location={ symInfo.declLocation }
            />
        );
      }

      emitInfo('Declaration', 'decl',
        <div
          key="decl-card"
          className="symbolContextCard"
          >
          { maybePath }
          <code className="source-block">{ symInfo.declPeek }</code>
        </div>
      );
    }

    // # Definition Card
    if (symInfo.defPeek) {
      let maybePath;
      if (symInfo.sourceFileInfo) {
        maybePath = (
          <PathCrumbed
            grokCtx={ grokCtx }
            path={ symInfo.sourceFileInfo.path }
            location={ symInfo.defLocation }
            />
        );
      }

      emitInfo('Definition', 'def',
        <div
          key="def-card"
          className="symbolContextCard"
          >
          { maybePath }
          <code className="source-block">{ symInfo.defPeek }</code>
        </div>
      );
    }

    if (symInfo.supers || symInfo.subclasses) {
      const diagram = grokCtx.kb.ensureDiagram(symInfo, 'hierarchy');
      emitInfo('Hierarchy', 'hierarchy',
        <ClassDiagram
          key='hierarchy-card'
          diagram={ diagram }
          shrinkToFit={ true }
          />
      );
    }

    if (symInfo.outEdges.size || symInfo.inEdges.size) {
      symInfo.ensureCallEdges();
      if (symInfo.callsOutTo.size || symInfo.receivesCallsFrom.size) {
        const diagram = grokCtx.kb.ensureDiagram(symInfo, 'method');
        emitInfo('Local Calls', 'method',
          <ClassDiagram
            key='method-card'
            diagram={ diagram }
            shrinkToFit={ true }
            />
        );
      }
    }

    return (
      <div
        className="symbolContextSheet"
        key={ symInfo.rawName }
        >
        { nodes }
      </div>
    );
  }
}

export class SymbolContextModel extends EE {
  constructor({ sessionThing }) {
    super();

    this.serial = 0;

    this.sessionThing = sessionThing;
    this.hoveredSymInfo = null;
    this.clickedSymInfo = null;
    this.symInfo = null;

    this.sessionThing.handleBroadcastMessage(
      'sourceView', 'hovered', this.onHoverSymbol.bind(this));
    this.sessionThing.handleBroadcastMessage(
      'sourceView', 'clicked', this.onClickSymbol.bind(this));

    this._bound_symbolDirty = this.onSymbolDirty.bind(this);
  }

  destroy() {
    this.sessionThing.stopHandlingBroadcastMessage('sourceView', 'hovered');
    this.sessionThing.stopHandlingBroadcastMessage('sourceView', 'clicked');
  }

  /**
   * Called when the clicked or hovered symbol changes.  We re-derive symbolInfo
   * with the hovered symbol taking precedence.  We also ensure that we are
   * subscribed to 'dirty' notifications from the current symInfo (and no
   * longer subscribed to any old symInfo 'dirty' notifications).  This lets
   * a `DirtyingComponent` subscribed to our model be able to update when the
   * symbol being inspected changes, or if that symbol itself gets updated.
   */
  _symbolMaybeChanged() {
    const newSymInfo = this.hoveredSymInfo || this.clickedSymInfo;
    if (newSymInfo === this.symInfo) {
      return;
    }
    if (this.symInfo) {
      this.symInfo.off('dirty', this._bound_symbolDirty);
    }
    this.symInfo = newSymInfo;
    if (this.symInfo) {
      this.symInfo.on('dirty', this._bound_symbolDirty);
    }

    this.serial++;
    this.emit('dirty');
  }

  onSymbolDirty() {
    this.serial++;
    this.emit('dirty');
  }

  onHoverSymbol({ symInfo }) {
    this.hoveredSymInfo = symInfo;
    this._symbolMaybeChanged();
  }

  onClickSymbol({ symInfo }) {
    // TODO: eventually remove this, but this is going to be handy for
    // enhancements for quite a while.
    if (symInfo) {
      console.log('clicked on symbol:', symInfo);
    }
    this.clickedSymInfo = symInfo;
    this._symbolMaybeChanged();
  }
}

export let SymbolContextSheetBinding = {
  icon: 'id card outline',
  spawnable: 'Symbol Context',
  makeModel(sessionThing/*, persisted*/) {
    return new SymbolContextModel({ sessionThing });
  },

  makeLabelForModel(sessionThing, model) {
    if (model.symInfo) {
      return model.symInfo.prettiestName;
    }
    return 'Symbol Context: No Symbol';
  },

  makeRichLabelInfoForModel(sessionThing, model) {
    return {
      primary: "Symbol Context",
      secondary: "",
      actions: [],
    };
  },

  makeWidgetForModel(sessionThing, model) {
    return (
      <SymbolContextSheet
        sessionThing={ model.sessionThing }
        model={ model }
        />
    );
  }
};
