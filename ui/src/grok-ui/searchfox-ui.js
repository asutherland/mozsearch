/**
 * When loaded into a page context this code hooks up:
 * - Clicking on symbols and displaying popups.  This was previously handled by
 *   some jquery code.
 * - Automatic seeking based on the hash.
 *
 * Future work:
 * - History management.
 *
 * ## Important Context
 */

import React from 'react';
import ReactDOM from 'react-dom';

import SessionPopupContainer from
  './components/session_notebook/session_popup_container.jsx';

import KBSymbolViewSheet from './components/sheets/kb_symbol_view.jsx';

import KBSymbolInfoPopup from './components/popups/kb_symbol_info.jsx';

import GrokAnalysisFrontend from '../grokysis/frontend.js';

import 'semantic-ui-css/semantic.min.css';

function makeGrokContext() {
  const treeName = document.location.pathname.split('/')[1];

  const outerGrokCtx = window.GROK_CTX = new GrokAnalysisFrontend({
    session: {
      name: treeName,
      tracks: ['shelf'],
      defaults: {
        shelf: [
        ]
      },

      popupBindings: {
        symbolInfo: {
          factory: ({ symInfo, fromSymInfo }, grokCtx, sessionThing) => {
            // Trigger full analysis of the symbol.
            grokCtx.kb.ensureSymbolAnalysis(symInfo);
            return {
              popupProps: {},
              contents: (
                <KBSymbolInfoPopup
                  grokCtx={ grokCtx }
                  symInfo={ symInfo }
                  fromSymInfo={ fromSymInfo }
                  sessionThing={ sessionThing }
                  />
              )
            };
          }
        },
      },

      sheetBindings: {
        symbolView: {
          factory: (persisted, grokCtx) => {
            // Do asynchronously trigger full analysis of the symbol.
            const symInfo =
              grokCtx.kb.lookupRawSymbol(
                persisted.rawSymbol, true, persisted.pretty);

            return {
              labelWidget: `Symbol: ${ symInfo.prettiestName }`,
              contentPromise: null,
              contentFactory: (props) => {
                return (
                  <KBSymbolViewSheet {...props}
                    symInfo={ symInfo }
                    />
                );
              }
            };
          },
        },
      }
    }
  });
  return outerGrokCtx;
}

const gGrokCtx = makeGrokContext();

function symbolsFromString(symbols) {
  if (!symbols || symbols === "?") { // unclear what the "?" was for
    return [];
  }
  return symbols.split(",");
}

/**
 * Given a DOM node, find its jumps, searches, symbols, symInfo.  A
 * destructurable result is always returned, everything may just be null.
 */
function semanticInfoFromTarget(target) {
  let jumps = null, searches = null, symbolNames = null;
  let rawMetaInfo = null, symInfo = null, visibleTokenText = null;

  const win = target.ownerDocument.defaultView;

  const iElem = target.closest('[data-i]');
  if (iElem) {
    const index = parseInt(iElem.dataset.i, 10);
    [jumps, searches] = win.ANALYSIS_DATA[index];
  }

  const tokenElem = target.closest('[data-symbols]');
  if (tokenElem) {
    visibleTokenText = tokenElem.textContent;
    symbolNames = symbolsFromString(tokenElem.dataset.symbols);
    const firstSym = symbolNames[0];
    if (firstSym) {
      // right now this is just "syntax" (always, with fancy crossref), and
      // "type"/"typesym" (when the fancy branch indexer is used.)
      rawMetaInfo = win.SYM_INFO[firstSym] || null;
      // TODO: we could really be consolidating the jumps/searches into the
      // same info here.  The relevant utility of jumps/searches is that
      // redundant pointers to the current code location are automatically
      // suppressed.  At the very least, the prettyInfo could be available from
      // the rawSymInfo
      symInfo = gGrokCtx.kb.lookupRawSymbol(firstSym, true);
    }
  }

  return { jumps, searches, symbolNames, rawMetaInfo, symInfo, visibleTokenText };
}



class SymbolHighlighter {
  constructor() {
    this.highlightedGroupsByName = new Map();
  }

  highlightSymbolsWithToken(groupName, symbolNames, visibleTokenText) {
    const existingGroupInfo = this.highlightedGroupsByName.get(groupName);
    // We might be better off having this method take the pre-symbolsFromString
    // string value so we don't need to re-stringify, but the cost of this is
    // low relative to not doing this fast-path out.
    if (existingGroupInfo.visibleTokenText === visibleTokenText &&
        existingGroupInfo.symbolNames.toString() === symbolNames.toString()) {
      // Nothing to do if we already highlighted the things in question.
      return;
    }

    this.stopHighlightingGroup(groupName);

    const nodes = this._findReferences(symbolNames, visibleTokenText);

    const groupInfo = {
      symbolNames,
      visibleTokenText,
      nodes
    };

    for (const node of nodes) {
      node.classList.add(groupName);
    }

    this.highlightedGroupsByName.set(groupName, groupInfo);
  }

  stopHighlightingGroup(groupName) {
    const groupInfo = this.highlightedGroupsByName.get(groupName);
    if (!groupInfo) {
      return;
    }

    this.highlightedGroupsByName.delete(groupName);
    for (const node of groupInfo.nodes) {
      node.classList.remove(groupName);
    }
  }

  _findReferences(symbolNames, visibleTokenText) {
    if (!symbolNames.length) {
      return [];
    }

    const symbolSet = new Set(symbolNames);
    // XXX iframe doc awareness
    return [...document.querySelectorAll("span[data-symbols]")].filter(span => {
      return span.textContent === visibleTokenText &&
        symbolsFromString(span.getAttribute("data-symbols"))
        .some(symbol => symbolSet.has(symbol));
    });
  }
}

const gHighlighter = new SymbolHighlighter();

/**
 * Auto-highlighting of hovered symbols and preloading of data that a click
 * would lookup.
 *
 * Searchfox originally used elementFromPoint, but it's not clear why.
 */
function onSourceMouseMove(evt) {
  // We only want the "symbols" for hover highlighting, but we do desire the
  // side-effect of the `symInfo` lookup occurring.
  const { symbols, visibleTokenText } = semanticInfoFromTarget(evt.target);

  // Are we hovering anything?
  if (symbols) {
    gHighlighter.highlightSymbolsWithToken(
      "hovered", symbols, visibleTokenText);
  } else {
    gHighlighter.stopHighlightingGroup("hovered");
  }
}

/**
 * Handle a click inside a source listing and display a menu.
 */
function onSourceClick(evt) {
  const { symInfo, /*symbols, visibleTokenText*/ } =
    semanticInfoFromTarget(evt.target);

  if (!symInfo) {
    return;
  }

  evt.stopPropagation();

  gGrokCtx.sessionManager.popupManager.showPopup(
    null,
    "symbolInfo",
    {
      symInfo,
      // TODO: provide a means of reliably identifying the containing symbol
      // of specific uses in the source.  We have this in the analysis data
      // and this could be part of the contextual data-i style information.
      // (That is, data-i could provide the additional information about a
      // specific instance/use that deviates from the referenced symbol.)
      fromSymInfo: null
    },
    evt.target);
}

/**
 * Listen for clicks on source lines in the given document.  The doc is provided
 * explicitly in order to support migration to iframe stuff.
 *
 * This method is intended to start out equivalent to the pre-existing jquery
 * handling (with megamenu changes).
 */
function bindSourceClickHandling(doc) {
  const fileElem = doc.getElementById('file');

  fileElem.addEventListener('mousemove', onSourceMouseMove);
  fileElem.addEventListener('click', onSourceClick);

  //window.addEventListener('mousedown', onMouseDown);

  const contentNode = document.createElement('div');
  contentNode.className = 'searchfox-popup-container';
  // The popup currently likes to put itself at the top of the DOM.  It's not
  // immediately clear how to get it to parent itself differently.  There is a
  // `pinned` attribute, but it may be assuming everything is react-based, which
  // is not true.
  document.body.appendChild(contentNode);

  const popupTags = (
    <div>
      <SessionPopupContainer
        className="searchfox-popup-root"
        grokCtx={ gGrokCtx }
        />
    </div>
  );
  ReactDOM.render(popupTags, contentNode);
}

bindSourceClickHandling(document);
