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

import Split from 'split.js';

import React from 'react';
import ReactDOM from 'react-dom';

import SessionPopupContainer from
  './components/session_notebook/session_popup_container.jsx';
import SessionTabbedContainer from
  './components/session_notebook/session_tabbed_container.jsx';

import KBSymbolViewSheet from './components/sheets/kb_symbol_view.jsx';
import { DiagramSheetBinding } from './components/sheets/diagram.jsx';
import { BlocklyDiagramEditorBinding } from './components/sheets/blockly_diagram_editor.jsx';
import { SearchFieldBinding } from './components/sheets/search_field.jsx';
import { SearchResultsBinding } from './components/sheets/search_results.jsx';

import KBSymbolInfoPopup from './components/popups/kb_symbol_info.jsx';

import GrokAnalysisFrontend from '../grokysis/frontend.js';

import { markdownRenderFromDOM } from './markdown-render.js';

import 'semantic-ui-css/semantic.min.css';

function makeGrokContext() {
  const treeName = document.location.pathname.split('/')[1];

  const outerGrokCtx = window.GROK_CTX = new GrokAnalysisFrontend({
    session: {
      name: treeName,
      tracks: ['top', 'source'],
      defaults: {
        top: [
          {
            type: 'searchField',
            persisted: {
              initialValue: ''
            }
          },
          {
            type: 'diagram',
            persisted: {}
          }
        ],
        source: []
      },

      perTrackSettings: {
        top: {
          populateSearchAddThingArgs: (searchText) => {
            return {
              type: 'searchResult',
              position: 'after',
              persisted: {
                searchText
              },
            };
          }
        }
      },

      popupBindings: {
        symbolInfo: {
          factory: ({ symInfo, fromSymInfo }, grokCtx, sessionThing) => {
            // Trigger full analysis of the symbol.
            grokCtx.kb.ensureSymbolAnalysis(symInfo, 1);
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
        searchField: SearchFieldBinding,
        diagram: DiagramSheetBinding,
        blocklyDiagram: BlocklyDiagramEditorBinding,

        // sentinel sourceView thing.
        sourceView: {
          makeModel() {
            return null;
          }
        }
      }
    }
  });

  gSourceSessionThing =
    outerGrokCtx.sessionManager.tracks.source.ensureThing(
      { type: 'sourceView', persisted: {} }
    );

  return outerGrokCtx;
}

let gSourceSessionThing = null;
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
  let nestingSymInfo = null;

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
      symInfo = gGrokCtx.kb.lookupRawSymbol(firstSym, 2);
    }

    const nestingElem = target.closest('[data-nesting-sym]');
    if (nestingElem) {
      nestingSymInfo =
        gGrokCtx.kb.lookupRawSymbol(nestingElem.dataset.nestingSym, 2);
      // The nesting heuristic is a little naive in that the nesting block also
      // includes the sticky line.  We don't want to create self-cycles in this
      // case.  (Although there are legit cycles we're suppressing this way.)
      //
      // If we create proper highlight regions for the blocks, we can leverage
      // that instead.
      if (nestingSymInfo === symInfo) {
        nestingSymInfo = null;
      }
    }
  }

  return { jumps, searches, symbolNames, rawMetaInfo, symInfo, visibleTokenText,
           nestingSymInfo };
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
    if (existingGroupInfo &&
        existingGroupInfo.visibleTokenText === visibleTokenText &&
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
    return [...document.querySelectorAll("[data-symbols]")].filter(span => {
      // I'm eliminating the textContent constraint for now because it's cool
      // to have SVG diagram nodes get highlighted, but it may be necessary
      // to just special-case for that.
      //span.textContent === visibleTokenText &&
      return symbolsFromString(span.getAttribute("data-symbols"))
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
  const { symbolNames, visibleTokenText } = semanticInfoFromTarget(evt.target);

  // Are we hovering anything?
  if (symbolNames) {
    gHighlighter.highlightSymbolsWithToken(
      "hovered", symbolNames, visibleTokenText);
  } else {
    gHighlighter.stopHighlightingGroup("hovered");
  }
}

/**
 * Handle a click inside a source listing and display a menu.
 */
function onSourceClick(evt) {
  const { symInfo, nestingSymInfo, /*symbols, visibleTokenText*/ } =
    semanticInfoFromTarget(evt.target);

  if (!symInfo) {
    return;
  }

  evt.stopPropagation();

  gGrokCtx.sessionManager.popupManager.showPopup(
    gSourceSessionThing,
    "symbolInfo",
    {
      symInfo,
      fromSymInfo: nestingSymInfo
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
  // Originally this was meant to just be the file object, but I also like these
  // clicks in the header.
  const rootClickElem = doc.body; //doc.getElementById('file');

  rootClickElem.addEventListener('mousemove', onSourceMouseMove);
  rootClickElem.addEventListener('click', onSourceClick);

  //window.addEventListener('mousedown', onMouseDown);
}
bindSourceClickHandling(document);

function createPopupWidget() {
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
createPopupWidget();

let gSplit;
/**
 * This converts the
 */
function replaceSearchboxWithOverwhelmingComplexity() {
  const headerElem = document.getElementById('fixed-header');
  const scrollingElem = document.getElementById('scrolling');

  // So long, old timey search UI!
  headerElem.textContent = '';

  const headerTags = (
    <SessionTabbedContainer
      grokCtx={ gGrokCtx }
      trackName="top" />
  );

  ReactDOM.render(headerTags, headerElem);

  // Setup the split.
  gSplit = Split(
    [headerElem, scrollingElem],
    {
      direction: 'vertical',
      minSize: [180, 200],
      sizes: [30, 70],
      onDragEnd: () => {
        gSourceSessionThing.broadcastMessage('window', 'resize', {});
      }
    });
}
replaceSearchboxWithOverwhelmingComplexity();

async function onLoad() {
  const filename = document.location.pathname.split('/').slice(-1)[0];
  const extension = filename.split('.').slice(-1)[0].toLowerCase();

  if (extension === 'md') {
    // Use our helper to extract the string from the DOM and produce a new
    // DOM that we can use to replace this one.
    const fileNode = document.getElementById('file');
    const newDOM = await markdownRenderFromDOM(fileNode, gGrokCtx);

    fileNode.id = 'raw-file';
    fileNode.style = 'display: none;';

    const newFileNode = document.createElement('div');
    newFileNode.id = 'file';
    newFileNode.classList.add('file');

    const paddingWrapperNode = document.createElement('div');
    paddingWrapperNode.classList.add('rendered-markdown');
    paddingWrapperNode.appendChild(newDOM);

    newFileNode.appendChild(paddingWrapperNode);

    fileNode.parentNode.appendChild(newFileNode);

    // Re-bind the click handling since the listener was added on the node
    // directly.
    bindSourceClickHandling(document);
  }
}
window.addEventListener('load', onLoad, { once: true });
