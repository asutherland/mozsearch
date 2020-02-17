import React from 'react';

/**
 */
export default class StaticSourceViewSheet extends React.Component {
  constructor(props) {
    super(props);

    this.model = props.model;

    this.codeRef = React.createRef();
    this.htmlRendered = false;
  }

  attachHTML() {
    if (this.htmlRendered) {
      return;
    }
    if (this.codeRef.current && this.model.fileInfo.domTree) {
      this.codeRef.current.appendChild(this.model.fileInfo.domTree);
    }
  }

  componentDidMount() {
    this.attachHTML();
  }

  componentDidUpdate() {
    this.attachHTML();
  }

  render() {
    return (
      <div ref={ this.codeRef }>
      </div>
    );
  }
}

export class StaticSourceViewModel {
  constructor(sessionThing, { path }) {
    this.path = path;
    this.fileInfo = sessionThing.grokCtx.kb.lookupSourceFile(
      path,
      {
        loadDom: true,
      }
    );
  }

  destroy() {
  }
}

export let StaticSourceViewBinding = {
  icon: 'file code',

  makeModel(sessionThing, persisted) {
    return new StaticSourceViewModel(sessionThing, persisted);
  },

  makeLabelForModel(sessionThing, model) {
    return `Results: ${ model.searchText }`;
  },

  makeWidgetForModel(sessionThing, model) {
    return (
      <StaticSourceViewSheet
        key={ sessionThing.id }
        sessionThing={ sessionThing }
        model={ model }
        />
    );
  }
};
