import React from 'react';

import DirtyingComponent from '../dirtying_component.js';

/**
 */
export default class StaticSourceViewSheet extends DirtyingComponent {
  constructor(props) {
    super(props, () => (this.props.model && this.props.model.fileInfo));

    this.model = props.model;

    this.codeRef = React.createRef();
    this.htmlRendered = false;

    this.listenersAttachedTo = null;

    this._bound_linkClickHandler = this.onLinkClick.bind(this);
  }

  attachHTML() {
    if (this.htmlRendered) {
      return;
    }
    if (this.codeRef.current && this.model.fileInfo.domTree) {
      this.codeRef.current.appendChild(this.model.fileInfo.domTree);
      this.htmlRendered = true;

      // Previously we filtered to .breadcrumbs, but for file listings we want
      // the links to work.
      this.listenersAttachedTo =
        this.model.fileInfo.domTree;
      this.listenersAttachedTo.addEventListener(
        'click', this._bound_linkClickHandler);

      // XXX If we just bound the HTML into reality, we'll need to manually
      // trigger the hash scrolling.  Note that HistoryHelper.onPopState also
      // tries to do the exact same thing, so in the event of a doc change
      const grokCtx = this.model.sessionThing.grokCtx;
      const { pathInfo, hash } =
        grokCtx.historyHelper.getCurrentLocationState();
      if (pathInfo.rest === this.model.path && hash) {
        window.scrollIntoView(hash.slice(1));
      }
    }
  }

  componentDidMount() {
    super.componentDidMount();
    this.attachHTML();
  }

  componentDidUpdate() {
    this.attachHTML();
  }

  componentWillUnmount() {
    super.componentWillUnmount();
    this.htmlRendered = false;
    if (this.listenersAttachedTo) {
      this.listenersAttachedTo.removeEventListener(
        'click', this._bound_linkClickHandler);
    }
    this.listenersAttachedTo = null;
  }

  onLinkClick(evt) {
    if (evt.target.tagName !== 'A' || !evt.target.href) {
      return;
    }

    const grokCtx = this.model.sessionThing.grokCtx;
    if (grokCtx.historyHelper.navigateTo(evt.target.href)) {
      evt.preventDefault();
      evt.stopPropagation();
    }
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
    this.sessionThing = sessionThing;
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
    if (!model) {
      return "Unhappy Source View";
    }
    return `Source File: ${ model.path }`;
  },

  makeWidgetForModel(sessionThing, model) {
    if (!model) {
      return <div></div>;
    }
    return (
      <StaticSourceViewSheet
        key={ sessionThing.id }
        sessionThing={ sessionThing }
        model={ model }
        />
    );
  }
};
