import React from 'react';

import KBSymbol from '../kb_details/kb_symbol.jsx';

/**
 * Pass-through wrapper around the KBSymbol widget.
 */
export default class KBSymbolViewSheet extends React.Component {
  constructor(props) {
    super(props);

    this.onNavigateIntoSym = this.onNavigateIntoSym.bind(this);
  }

  onNavigateIntoSym(sym) {
    const thing = this.props.sessionThing;

    thing.replaceWithPersistedState({
      rawSymbol: sym.rawName
    });
  }

  render() {
    return (
      <KBSymbol
        grokCtx={ this.props.grokCtx }
        sessionThing={ this.props.sessionThing }
        symInfo={ this.props.model.symInfo }
        doNavigateIntoSym={ this.onNavigateIntoSym }
        />
    );
  }
}

export class KBSymbolViewModel {
  constructor({ sessionThing, symInfo }) {
    this.sessionThing = sessionThing;
    this.symInfo = symInfo;

    // We need to dirty the sessionThing when the symbol finally gets its
    // fullName.  For simplicity right now we'll listen to all changes, but
    // only sensitize to markDirty when we know we didn't have it yet.
    this.waitingForFullName = !symInfo.fullName;
    this.symInfo.on('dirty', this.onDirty, this);
  }

  onDirty() {
    if (this.waitingForFullName && this.symInfo.fullName) {
      this.sessionThing.markDirty();
      this.waitingForFullName = false;
    }
  }

  destroy() {
    this.symInfo.removeListener('dirty', this.onDirty, this);
  }
}

export let KBSymbolViewBinding = {
  icon: 'box',

  makeModel(sessionThing, persisted, ingestArgs) {
    const grokCtx = sessionThing.grokCtx;
    let symInfo;
    if (ingestArgs) {
      symInfo = grokCtx.ingestExistingSearchSingleSymbolResults({
        rawSearchResults: ingestArgs.rawSearchResults,
        analysisMode: 'context',
      });
    } else {
      symInfo = grokCtx.kb.lookupRawSymbol(
        persisted.rawSymbol,
        {
          analysisMode: 'context',
        });
    }
    return new KBSymbolViewModel({ sessionThing, symInfo });
  },

  makeDocumentTitleForModel(sessionThing, model) {
    return model.symInfo.prettiestName;
  },

  makeLabelForModel(sessionThing, model) {
    return `Symbol View: ${ model.symInfo.prettiestName }`;
  },

  makeRichLabelInfoForModel(sessionThing, model) {
    return {
      primary: model.symInfo.simpleName,
      secondary: model.symInfo.namespace,
      actions: []
    };
  },

  makeWidgetForModel(sessionThing, model) {
    if (!model || !model.symInfo) {
      // TODO: Improve this flow and maybe this error.  In general, we should
      // always have a symInfo because we make them before we find out if they
      // actually exist or not.
      return <div>Search did not find the symbol, sorry.</div>;
    }
    return (
      <KBSymbolViewSheet
        key={ sessionThing.id }
        sessionThing={ sessionThing }
        model={ model }
        />
    );
  }
};