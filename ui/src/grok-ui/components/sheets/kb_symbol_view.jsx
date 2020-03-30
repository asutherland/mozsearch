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
  }

  destroy() {
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
    if (!model.symInfo) {
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