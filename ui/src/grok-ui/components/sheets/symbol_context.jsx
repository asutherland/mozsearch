import EE from 'eventemitter3';
import React from 'react';

import DirtyingComponent from '../dirtying_component.js';


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
    return (
      <div>
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
  }

  destroy() {
    this.sessionThing.stopHandlingBroadcastMessage('sourceView', 'hovered');
    this.sessionThing.stopHandlingBroadcastMessage('sourceView', 'clicked');
  }

  markDirty() {
    const newSymInfo = this.hoveredSymInfo || this.clickedSymInfo;
    if (newSymInfo === this.symInfo) {
      return;
    }
    this.symInfo = newSymInfo;

    this.serial++;
    this.emit('dirty');
  }

  onHoverSymbol({ symInfo }) {
    this.hoveredSymInfo = symInfo;
    this.markDirty();
  }

  onClickSymbol({ symInfo }) {
    this.clickedSymInfo = symInfo;
    this.markDirty();
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

  makeWidgetForModel(sessionThing, model) {
    return (
      <SymbolContextSheet
        sessionThing={ model.sessionThing }
        model={ model }
        />
    );
  }
};
