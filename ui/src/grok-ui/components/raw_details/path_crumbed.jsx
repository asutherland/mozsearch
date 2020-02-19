import React from 'react';

import { Breadcrumb } from 'semantic-ui-react';

import './path_hit.css';

/**
 * Represents a single { path, lines } object, displaying the path and then
 * nesting the LineHit instances beneath it.
 */
export default class PathCrumbed extends React.PureComponent {
  analyzeFile(evt, path) {
    evt.preventDefault();
    evt.stopPropagation();

    console.log('clicked on file', path);

    // for now, only analyze C++ files.
    if (!path.endsWith('.cpp') && !path.endsWith('.h')) {
      return;
    }

    // XXX this hookup needs A Context shunt or something, but a hack will do
    // for now.
    const track = window.grokCtx.sessionManager.tracksByIndex[1];
    track.addThing(null, null, {
      type: 'fileView',
      persisted: { path }
    });
  }

  render() {
    const { grokCtx, path, location } = this.props;

    // NB: It's assumed this will have been normalized to '/' even for Windows.
    const pieces = path.split('/');

    const commonClick = (evt) => {
      evt.preventDefault();
      evt.stopPropagation();

      grokCtx.historyHelper.navigateTo(evt.target.href);
    };

    // ## [0, last)
    const elems = [];
    const iLast = pieces.length - 1;
    for (let iPiece=0; iPiece < iLast; iPiece++) {
      const piece = pieces[iPiece];
      const url =
        grokCtx.historyHelper.buildSourceURL(pieces.slice(0, iPiece).join('/'));
      elems.push(
        <Breadcrumb.Section
          link
          key={ `s${iPiece}` }>
          <a href={url} onClick={ commonClick }>{ piece }</a>
        </Breadcrumb.Section>
      );
      elems.push(
        <Breadcrumb.Divider
          key={ `d${iPiece}` }
          />
      );
    }
    // ## last
    const fullUrl = grokCtx.historyHelper.buildSourceURL(path);
    const lastPiece = pieces[iLast];
    elems.push(
      <Breadcrumb.Section
        active
        key={ `s${iLast}` }
        >
        <a href={ fullUrl } onClick={ commonClick }>{ lastPiece }</a>
      </Breadcrumb.Section>
    );

    // ## maybe anchor link.
    if (location) {
      const locUrl = grokCtx.historyHelper.buildSourceURL(path, location.lno);
      elems.push(
        <Breadcrumb.Divider
          key="loc-divider"
          content=":"
          />
      );
      elems.push(
        <Breadcrumb.Section
          active
          key="loc-section"
          >
          <a href={ locUrl } onClick={ commonClick }>{ location.lno }</a>
        </Breadcrumb.Section>
      );
    }

    // ## Assemble
    return (
      <Breadcrumb size="small">
        { elems }
      </Breadcrumb>
    );
  }
}
