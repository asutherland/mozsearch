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
import { SessionTabbedToolbar, SessionTabbedContainer } from
  './components/session_notebook/session_tabbed_container.jsx';

import KBSymbolViewSheet from './components/sheets/kb_symbol_view.jsx';
import { DiagramSheetBinding } from './components/sheets/diagram.jsx';
import { BlocklyDiagramEditorBinding } from './components/sheets/blockly_diagram_editor.jsx';
import { SearchFieldBinding } from './components/sheets/search_field.jsx';
import { SearchResultsBinding } from './components/sheets/search_results.jsx';
import { SymbolContextSheetBinding } from './components/sheets/symbol_context.jsx';
import { StaticSourceViewBinding } from './components/sheets/static_source_view.jsx';

import KBSymbolInfoPopup from './components/popups/kb_symbol_info.jsx';

import GrokAnalysisFrontend from '../grokysis/frontend.js';

import { markdownRenderFromDOM } from './markdown-render.js';

import 'semantic-ui-css/semantic.min.css';

let gIframeParentElem = null;

function makeGrokContext() {
  const treeName = document.location.pathname.split('/')[1];

  const iframeParentElem = document.createElement('div');
  iframeParentElem.id = 'searchfox-iframe-loader';
  document.body.appendChild(iframeParentElem);

  const outerGrokCtx = window.GROK_CTX = new GrokAnalysisFrontend({
    session: {
      treeName,
      iframeParentElem,
      tracks: ['top', 'content'],
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
        content: []
      },

      perTrackSettings: {
        top: {
          // The current per-tree persistence granularity is quite unpleasant
          // as it relates to diagrams, but for now it's better to persist than
          // not persist.
          // TODO: Clean up the UX around persistence and sessions.  Being aware
          // of other open tabs and that things are displayed in them is
          // probably ideal.
          persist: true,
          populateSearchAddThingArgs: (searchText) => {
            return {
              type: 'searchResult',
              position: 'after',
              persisted: {
                searchText
              },
            };
          }
        },
        content: {
          // The content track is substantially characterized by the URL so
          // there's no need to persist any of it.  We can move to persisting
          // things in the history API's state, but that's future work.
          persist: false
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
        symbolContext: SymbolContextSheetBinding,
        sourceView: StaticSourceViewBinding,
      }
    }
  });

  return outerGrokCtx;
}


const gGrokCtx = makeGrokContext();
const gContentTrack = gGrokCtx.sessionManager.tracks['content'];

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
  const { symbolNames, symInfo, visibleTokenText } =
    semanticInfoFromTarget(evt.target);

  // Are we hovering anything?
  if (symbolNames) {
    gHighlighter.highlightSymbolsWithToken(
      "hovered", symbolNames, visibleTokenText);
  } else {
    gHighlighter.stopHighlightingGroup("hovered");
  }

  if (gContentTrack && gContentTrack.selectedThing) {
    gContentTrack.selectedThing.broadcastMessage(
      'sourceView', 'hovered', { symInfo });
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

  if (gContentTrack && gContentTrack.selectedThing) {
    gContentTrack.selectedThing.broadcastMessage(
      'sourceView', 'clicked', { symInfo });
  }

  gGrokCtx.sessionManager.popupManager.showPopup(
    gContentTrack.selectedThing,
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

class HistoryHelper {
  constructor({ treeName, contentTrack }) {
    this.treeName = treeName;
    this.contentTrack = contentTrack;

    this._bound_onPopState = this.onPopState.bind(this, 'window');
    window.addEventListener('popstate', this._bound_onPopState);
  }

  parseSearchfoxPath(pathname) {
    const pieces = pathname.split('/');
    // 0 is the empty string because the pathname starts with '/'
    const treeName = pieces[1];
    const route = pieces[2];
    const rest = pieces.slice(3).join('/');
    return { treeName, route, rest };
  }

  getCurrentLocationState() {
    const pathInfo = this.parseSearchfoxPath(window.location.pathname);
    const queryParams =
      Object.fromEntries(new URL(window.location).searchParams.entries());

    return { pathInfo, queryParams };
  }

  buildSourceURL(path, line) {
    return `/${this.treeName}/source/${path}${line ? ('#' + line) : ''}`;
  }

  buildSourceURLForSymbolDef(symInfo) {
    // For now, this is just a direct line link, but in the future could have
    // a more fancy hash encoding.
    const path = symInfo.sourceFileInfo.path;
    const line = symInfo.defLocation && symInfo.defLocation.lno;
    return this.buildSourceURL(path, line);
  }

  buildSearchURLForString(str) {
    return `/${this.treeName}/sorch?q=${encodeURIComponent(str)}`;
  }

  buildSearchURLForIdentifier(identifier) {
    return `/${this.treeName}/sorch?q=id:${encodeURIComponent(identifier)}`;
  }

  buildSearchURLForSymbols(symbols) {
    if (Array.isArray(symbols)) {
      symbols = symbols.join(',');
    }
    return `/${this.treeName}/sorch?q=symbol:${encodeURIComponent(symbols)}`;
  }

  navigateTo(url) {
    history.pushState({}, '', url);
    this.onPopState('internal');
  }

  /**
   * Called in response to both the user's use of the back/forward buttons as
   * well as if our `navigateTo` helper is used.
   */
  onPopState(/* source */) {
    const { pathInfo, queryParams } = this.getCurrentLocationState();

    let thing;
    switch (pathInfo.route) {
      case 'source': {
        thing = this.contentTrack.ensureThing({
          type: 'sourceView',
          persisted: {
            path: pathInfo.rest,
          },
        });
        break;
      }

      case 'search':
      case 'sorch': {
        thing = this.contentTrack.ensureThing({
          type: 'searchResults',
          persisted: {
            queryParams
          },
        });
        break;
      }

      default: {
        break;
      }
    }

    this.contentTrack.selectThing(thing);
  }
}

let gHistoryHelper;
let gSplit;
/**
 * This converts the static page and its layout into a dynamic UI.  In general,
 * all we care about on each page is the "#scrolling" element which is where the
 * rendered source lives.
 *
 * The current static file hierarchy looks like this:
 * - body `display: flex; flex-direction: column;`
 *   - div id="fixed-header"
 *   - div id="scrolling"
 *     - div id="content"
 *
 * With the new vertical toolbar on the left, we still want this general
 * structure, but we want it nested under a row-based flexbox that puts the
 * toolbar on the left.
 *
 */
function replaceUIWithOverwhelmingComplexity() {
  const headerElem = document.getElementById('fixed-header');
  const scrollingElem = document.getElementById('scrolling');

  const bodyElem = document.body;
  const toolboxElem = document.createElement('div');
  toolboxElem.id = 'toolbox';

  const topLevelBoxElem = document.createElement('div');
  topLevelBoxElem.id = 'toplevel';

  bodyElem.classList.add('toolbox-inserted');
  bodyElem.insertBefore(toolboxElem, bodyElem.firstChild);
  bodyElem.insertBefore(topLevelBoxElem, toolboxElem.nextSibling);

  topLevelBoxElem.appendChild(headerElem);
  topLevelBoxElem.appendChild(scrollingElem);

  // So long, old timey search UI!
  headerElem.textContent = '';

  const contentTrack = gGrokCtx.sessionManager.tracks['content'];
  gHistoryHelper = new HistoryHelper({
    treeName: gGrokCtx.treeName,
    contentTrack,
  });

  const headerTags = (
    <SessionTabbedContainer
      grokCtx={ gGrokCtx }
      trackName="top"
      selfClip={ true }
      />
  );

  ReactDOM.render(headerTags, headerElem);

  const toolbarTags = (
    <div>
      <SessionTabbedToolbar
        grokCtx={ gGrokCtx }
        trackName="top"
        spawn={true}
        closeLabel="Close Current Top Box Tab"
        />
      &nbsp;
      <hr />
      &nbsp;
      <SessionTabbedToolbar
        grokCtx={ gGrokCtx }
        trackName="content"
        spawn={false}
        closeLabel="Close Current Content Tab"
        />
    </div>
  );

  ReactDOM.render(toolbarTags, toolboxElem);

  // ## Pivot the existing source content into its FileInfo
  const { pathInfo, queryParams } = gHistoryHelper.getCurrentLocationState();

  if (pathInfo.route === 'source') {
    const fileInfo = gGrokCtx.kb.lookupSourceFile(pathInfo.rest, {});
    fileInfo.domTree = document.getElementById('content');
    fileInfo.fileAnalysisData = window.ANALYSIS_DATA;
    fileInfo.fileSymInfo = window.SYM_INFO;
    // Remove the script tag that got us the above globals, we've saved them off
    // and don't need them again.
    const byeScript = fileInfo.domTree.querySelector('script');
    byeScript.parentNode.removeChild(byeScript);

    contentTrack.addThing(null, null, {
      type: 'sourceView',
      persisted: {
        path: fileInfo.path,
      }
    });
  } else if (pathInfo.route === 'sorch') {
    // The script tag and everything inside it will fall away when the content
    // elem is removed for this case.  We don't bother saving off the content
    // since all it contained of use was this global.
    const rawResults = window.SEARCH_RESULTS;
    contentTrack.addThing(null, null, {
      type: 'searchResults',
      persisted: {
        queryParams,
      },
      ingestArgs: {
        rawResults
      },
    });
  }

  const oldContentElem = document.getElementById('content');
  const newContentContainer = document.createElement('div');
  oldContentElem.parentNode.replaceChild(newContentContainer, oldContentElem);

  const contentTags = (
    <SessionTabbedContainer
      grokCtx={ gGrokCtx }
      trackName="content"
      selfClip={ false }
      />
  );
  ReactDOM.render(contentTags, newContentContainer);

  // ## Setup the split.
  gSplit = Split(
    [headerElem, scrollingElem],
    {
      direction: 'vertical',
      minSize: [180, 200],
      sizes: [30, 70],
      onDragEnd: () => {
        gContentTrack.selectedThing.broadcastMessage('window', 'resize', {});
      }
    });
}
replaceUIWithOverwhelmingComplexity();

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
