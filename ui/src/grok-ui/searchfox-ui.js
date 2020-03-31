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

import { KBSymbolViewBinding } from './components/sheets/kb_symbol_view.jsx';
import { DiagramSheetBinding } from './components/sheets/diagram.jsx';
import { BlocklyDiagramEditorBinding } from './components/sheets/blockly_diagram_editor.jsx';
import { SearchFieldBinding } from './components/sheets/search_field.jsx';
import { SearchResultsBinding } from './components/sheets/search_results.jsx';
import { SymbolContextSheetBinding } from './components/sheets/symbol_context.jsx';
import { StaticSourceViewBinding } from './components/sheets/static_source_view.jsx';

import ClassicSearchfoxMenu from './components/popups/classic_searchfox_menu.jsx';
import FancyContextMenu from './components/popups/fancy_context_menu.jsx';

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
          // Remove the searchField from being a default until it's fixed.
          /*
          {
            type: 'searchField',
            persisted: {
              initialValue: ''
            },
          },
          */
          {
            type: 'symbolContext',
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
          },
          spawn: [
            'blocklyDiagram',
            'diagram',
            'searchField',
            'symbolContext'
          ],
        },
        content: {
          // The content track is substantially characterized by the URL so
          // there's no need to persist any of it.  We can move to persisting
          // things in the history API's state, but that's future work.
          persist: false,
          // The HistoryHelper will clobber its own listener into place here.
          onSelectionChange: null,
          spawn: [
            'blocklyDiagram',
            'diagram'
          ]
        }
      },

      popupBindings: {
        classicSearchfoxMenu: {
          factory: (props, grokCtx, sessionThing) => {
            // Trigger full analysis of the symbol.
            if (props.symInfo) {
              grokCtx.kb.ensureSymbolAnalysis(props.symInfo, { analysisMode: 'context' });
            }
            return {
              popupProps: {},
              contents: (
                <ClassicSearchfoxMenu
                  {...props}
                  grokCtx={ grokCtx }
                  sessionThing={ sessionThing }
                  />
              )
            };
          }
        },

        fancyContextMenu: {
          factory: (props, grokCtx, sessionThing) => {
            // Trigger full analysis of the symbol.
            if (props.symInfo) {
              grokCtx.kb.ensureSymbolAnalysis(props.symInfo, { analysisMode: 'context' });
            }
            return {
              popupProps: {},
              contents: (
                <FancyContextMenu
                  {...props}
                  grokCtx={ grokCtx }
                  sessionThing={ sessionThing }
                  />
              )
            };
          }
        },
      },

      sheetBindings: {
        blocklyDiagram: BlocklyDiagramEditorBinding,
        diagram: DiagramSheetBinding,
        searchField: SearchFieldBinding,
        searchResults: SearchResultsBinding,
        sourceView: StaticSourceViewBinding,
        symbolContext: SymbolContextSheetBinding,
        symbolView: KBSymbolViewBinding,
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
function semanticInfoFromTarget(target, ancestorCheck) {
  let jumps = null, searches = null, symbolNames = null;
  let rawMetaInfo = null, symInfo = null, visibleTokenText = null;
  let nestingSymInfo = null;
  let lineNumber = null;

  let inAncestor = ancestorCheck && target.closest(ancestorCheck) && true;

  const fileInfo = gContentTrack.selectedThing &&
                   gContentTrack.selectedThing.model &&
                   gContentTrack.selectedThing.fileInfo;

  const win = target.ownerDocument.defaultView;

  const lineElem = target.closest('.source-line');
  if (lineElem) {
    const lineMatch = (/^line-(\d+)$/).exec(lineElem.id);
    if (lineMatch) {
      lineNumber = parseInt(lineMatch[1], 10);
    }
  }

  const iElem = target.closest('[data-i]');
  if (iElem && fileInfo) {
    const index = parseInt(iElem.dataset.i, 10);
    [jumps, searches] = fileInfo.fileAnalysisData[index];
  }

  const tokenElem = target.closest('[data-symbols]');
  if (tokenElem) {
    visibleTokenText = tokenElem.textContent;
    symbolNames = symbolsFromString(tokenElem.dataset.symbols);
    const firstSym = symbolNames[0];
    if (firstSym) {
      // right now this is just "syntax" (always, with fancy crossref), and
      // "type"/"typesym" (when the fancy branch indexer is used.)
      rawMetaInfo = fileInfo && fileInfo.fileSymInfo[firstSym] || null;
      // TODO: we could really be consolidating the jumps/searches into the
      // same info here.  The relevant utility of jumps/searches is that
      // redundant pointers to the current code location are automatically
      // suppressed.  At the very least, the prettyInfo could be available from
      // the rawSymInfo
      symInfo =
        gGrokCtx.kb.lookupRawSymbol(firstSym, { analysisMode: 'context' });
    }

    const nestingElem = target.closest('[data-nesting-sym]');
    if (nestingElem) {
      nestingSymInfo =
        gGrokCtx.kb.lookupRawSymbol(
          nestingElem.dataset.nestingSym,
          {
            analysisMode: 'context',
          });
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
           nestingSymInfo, inAncestor, fileInfo, lineNumber };
}


class SymbolHighlighter {
  constructor() {
    this.highlightedGroupsByName = new Map();
  }

  highlightSymbolsWithToken(groupName, symbolNames, visibleTokenText, toggle=false) {
    const existingGroupInfo = this.highlightedGroupsByName.get(groupName);
    // We might be better off having this method take the pre-symbolsFromString
    // string value so we don't need to re-stringify, but the cost of this is
    // low relative to not doing this fast-path out.
    if (existingGroupInfo &&
        existingGroupInfo.visibleTokenText === visibleTokenText &&
        existingGroupInfo.symbolNames.toString() === symbolNames.toString()) {
      // Nothing to do if we already highlighted the things in question unless
      // we're in toggle mode.
      if (toggle) {
        this.stopHighlightingGroup(groupName);
      }
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
  // Ignore mouse moves when we're displaying a popup.
  if (gGrokCtx.sessionManager.popupManager.popupInfo) {
    return;
  }

  // We only want the "symbols" for hover highlighting, but we do desire the
  // side-effect of the `symInfo` lookup occurring.
  const { symbolNames, symInfo, visibleTokenText, inAncestor } =
    semanticInfoFromTarget(evt.target, "#content");

  // Are we hovering anything?
  if (symbolNames) {
    gHighlighter.highlightSymbolsWithToken(
      "hovered", symbolNames, visibleTokenText);
  } else {
    gHighlighter.stopHighlightingGroup("hovered");
  }

  // Only generate the hovered event if the ancestor check for "#content".
  // This avoids insanity if the user is hovering over the context area.  (But
  // we do intentionally do the highlighting above because the brushing effect
  // is still useful in that case.)
  if (inAncestor && gContentTrack && gContentTrack.selectedThing) {
    gContentTrack.selectedThing.broadcastMessage(
      'sourceView', 'hovered', { symInfo });
  }
}

/**
 * Handle a click inside a source listing and display a menu.
 */
function onSourceClick(evt) {
  const { symInfo, nestingSymInfo, inAncestor, fileInfo, lineNumber,
          symbolNames, visibleTokenText } =
    semanticInfoFromTarget(evt.target, "#content");

  if (!symInfo) {
    return;
  }

  evt.stopPropagation();

  // If the click was inside the content track (inAncestor), then broadcast a
  // click so the symbol context can latch the clicked thing.
  //
  // We don't emit this message when we weren't in the content track because we
  // presume we're in the topbar in the symbol context display or a diagram, and
  // in that case we don't want to mess with what the user's cursor is over.

  if (inAncestor) {
    gContentTrack.selectedThing.broadcastMessage(
      'sourceView', 'clicked', { symInfo });
  }

  gGrokCtx.sessionManager.popupManager.showPopup(
    gContentTrack.selectedThing,
    "classicSearchfoxMenu",
    {
      symInfo,
      fromSymInfo: nestingSymInfo,
      fileInfo,
      lineNumber,
      visibleTokenText,
      highlightClickedThing: () => {
        gHighlighter.highlightSymbolsWithToken(
          "sticky-highlight", symbolNames, visibleTokenText, 'toggle');
      }
    },
    evt);
}

function onSourceContextMenuClick(evt) {
  const {
    symInfo,
    nestingSymInfo,
    fileInfo,
    lineNumber,
    symbolNames,
    visibleTokenText
  } = semanticInfoFromTarget(evt.target, "#content");

  if (!symInfo) {
    return;
  }

  evt.stopPropagation();
  evt.preventDefault();

  gGrokCtx.sessionManager.popupManager.showPopup(
    gContentTrack.selectedThing,
    "fancyContextMenu",
    {
      symInfo,
      fromSymInfo: nestingSymInfo,
      fileInfo,
      lineNumber,
      visibleTokenText,
      highlightClickedThing: () => {
        gHighlighter.highlightSymbolsWithToken(
          "sticky-highlight",
          symbolNames,
          visibleTokenText,
          "toggle"
        );
      }
    },
    evt
  );
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
  rootClickElem.addEventListener('contextmenu', onSourceContextMenuClick);

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
        className="searchfox-popup-root stop-the-padding"
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

    this._scrollingElem = document.getElementById('scrolling');

    this._bound_onPopState = this.onPopState.bind(this, 'window');
    window.addEventListener('popstate', this._bound_onPopState);

    this._bound_onHashChange = this.onHashChange.bind(this);
    window.addEventListener('hashchange', this._bound_onHashChange);

    this._bound_onTrackSelectionChange = this.onTrackSelectionChange.bind(this);
    this.contentTrack.trackSettings.onSelectionChange =
      this._bound_onTrackSelectionChange;
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
    const curUrl = new URL(window.location);
    const queryParams =
      Object.fromEntries(curUrl.searchParams.entries());

    return { pathInfo, queryParams, hash: curUrl.hash, href: curUrl.href };
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

  buildSourceURLForSymbolDecl(symInfo) {
    // For now, this is just a direct line link, but in the future could have
    // a more fancy hash encoding.
    const path = symInfo.declFileInfo.path;
    const line = symInfo.declLocation && symInfo.declLocation.lno;
    return this.buildSourceURL(path, line);
  }

  buildSymbolViewURLForSymbol(symInfo) {
    return `/${this.treeName}/symbol?q=${encodeURIComponent(symInfo.rawName)}`;
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

  stashState() {
    if (this.contentTrack.selectedThing) {
      const { spec } = this.getCurrentLocationState();
      this.contentTrack.selectedThing.sessionMeta.url = spec;

      this.contentTrack.selectedThing.sessionMeta.scrollTop =
        this._scrollingElem.scrollTop;
    }
  }

  /**
   * Attempt to single-page navigate to the given link, returning true if the
   * URL was eligible and false if not.  (It's possible for us to encounter
   * links that aren't part of the same tree, in which case we want a normal
   * navigation to occur.)
   */
  navigateTo(url) {
    const candidateUrl = new URL(url, window.location);
    if (candidateUrl.origin !== window.location.origin ||
        !candidateUrl.pathname.startsWith(`/${this.treeName}/`)) {
      return false;
    }

    // It's essential we provide a value for state that is not equal to the
    // previous value or we won't actually see a 'popstate' event.  A fresh
    // object is sufficient for this purpose.
    history.pushState({}, '', url);
    return this.onPopState('internal');
  }

  /**
   * When the window dispatches a 'hashchange' we make sure to update the
   * current sessionThing's sessionMeta.url which is what we'll restore the URL
   * to if the user ever switches back to this sessionThing via tabbed UI.
   */
  onHashChange() {
    this.stashState();
  }

  /**
   * Called in response to both the user's use of the back/forward buttons as
   * well as if our `navigateTo` helper is used.
   */
  onPopState(source) {
    const { pathInfo, queryParams, hash, href } =
      this.getCurrentLocationState();

    let thing, existed;
    switch (pathInfo.route) {
      case 'source': {
        ({ thing, existed } = this.contentTrack.ensureThing({
          type: 'sourceView',
          persisted: {
            path: pathInfo.rest,
          },
        }));
        break;
      }

      case 'search':
      case 'sorch': {
        ({ thing, existed } = this.contentTrack.ensureThing({
          type: 'searchResults',
          persisted: {
            queryParams
          },
        }));
        break;
      }

      // Operates similarly to the 'define' search alias thing.
      case 'symbol': {
        ({ thing, existed } = this.contentTrack.ensureThing({
          type: 'symbolView',
          persisted: {
            rawSymbol: queryParams.q
          },
        }));
        break;
      }

      default: {
        break;
      }
    }

    thing.sessionMeta.url = href;
    this._updateDocumentTitle(thing);

    const alreadyVisible = this.contentTrack.selectedThing === thing;
    console.log('onPopState handler:', source, existed, alreadyVisible, hash);
    this.contentTrack.selectThing(thing, 'popstate');
    // If the source view already existed and was already displayed, then it's
    // likely the DOM has already been attached.  If the DOM is already attached
    // then `StaticSourceViewSheet` won't attempt to call createSyntheticAnchor,
    // which means we need to do it here.
    if (existed && alreadyVisible && hash) {
      // This is from dxr.js and handles making an element with the numeric id
      // in question which lets the browser do its own scrolling thing in cases
      // where we aren't doing history API stuff.
      this.createSyntheticAnchor(hash.slice(1));
      // Do not prevent the link traversal.
      return false;
    }

    return true;
  }

  _updateDocumentTitle(thing) {
    let useTitle = 'mozsearch';
    let thingTitle = thing.makeDocumentTitle();
    if (thingTitle) {
      useTitle = thingTitle + ' - ' + useTitle;
    }
    document.title = useTitle;
  }

  /**
   * Notification from the session tabbed UI that the user is switching the
   * selected sessionThing and therefore that we should update the URL (and
   * potentially restore scroll positions).
   *
   * @param {SessionThing} oldThing
   * @param {SessionThing} newThing
   * @param {'popstate'|'click'} source
   */
  onTrackSelectionChange(oldThing, newThing, source) {
    // If we're about to switch because of a click, be sure to save off the hash
    // and (more importantly) the scrollTop.
    if (oldThing && source === 'click') {
      this.stashState();
    }
    if (newThing && newThing.sessionMeta.url && source === 'click') {
      history.pushState({}, '', newThing.sessionMeta.url);
    }
    if (newThing && source === 'click') {
      this._updateDocumentTitle(newThing);
    }
  }

  /**
   * Invoked by the StaticSourceViewSheet when its HTML content has been
   * attached into the DOM and we should perform any scrolling.
   *
   * @param {*} sessionThing
   * @param {*} rootNode
   */
  onContentHTMLAttached(sessionThing, thingPath/*, rootNode */) {
    const { pathInfo, hash } = this.getCurrentLocationState();
    if (pathInfo.rest === thingPath && hash) {
      this.createSyntheticAnchor(hash.slice(1), true);
    }
    if (sessionThing.sessionMeta.scrollTop !== undefined) {
      this._scrollingElem.scrollTop = sessionThing.sessionMeta.scrollTop;
    }
  }

  /**
   * Creates a synthetic anchor for all hash configurations, even ones that
   * highlight more than one line and therefore can't be understood by the
   * browser's native anchor-seeking like "#200-205" and "#200,205".
   *
   * Even if it seemed like a good idea to attempt to manually trigger this
   * scrolling on load and the "hashchange" event, Firefox notably will manually
   * seek to an anchor if you press the enter key in the location bar and have not
   * changed the hash.  This is a UX flow used by many developers, so it's
   * essential the synthetic anchor is in place.  For this reason, any
   * manipulation of history state via replaceState must call this method.
   *
   * This synthetic anchor also doubles as a means of creating sufficient padding
   * so that "position:sticky" stuck lines don't obscure the line we're seeking
   * to.  (That's what the "goto" class accomplishes.)  Please see mosearch.css
   * for some additional details and context here.
   */
  createSyntheticAnchor(id, scrollToIt) {
    let gotoElt = document.getElementById(id);
    if (!gotoElt) {
      var firstLineno = id.split(/[,-]/)[0];
      var elt = document.getElementById("l" + firstLineno);

      gotoElt = document.createElement("div");
      gotoElt.id = id;
      gotoElt.className = "goto";
      elt.appendChild(gotoElt);
    }

    if (scrollToIt) {
      gotoElt.scrollIntoView();
    }
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
  gHistoryHelper = gGrokCtx.historyHelper = new HistoryHelper({
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
        spawn={true}
        closeLabel="Close Current Content Tab"
        />
    </div>
  );

  ReactDOM.render(toolbarTags, toolboxElem);

  // ## Pivot the existing source content into its FileInfo
  const { pathInfo, queryParams } = gHistoryHelper.getCurrentLocationState();

  let thing;
  if (pathInfo.route === 'source') {
    const fileInfo = gGrokCtx.kb.lookupSourceFile(pathInfo.rest, {});
    fileInfo.domTree = document.getElementById('content');
    fileInfo.fileAnalysisData = window.ANALYSIS_DATA;
    fileInfo.fileSymInfo = window.SYM_INFO;
    // Remove the script tag that got us the above globals, we've saved them off
    // and don't need them again.
    const byeScript = fileInfo.domTree.querySelector('script');
    // File listings don't have a script tag.
    if (byeScript) {
      byeScript.parentNode.removeChild(byeScript);
    }

    thing = contentTrack.addThing(null, null, {
      type: 'sourceView',
      persisted: {
        path: fileInfo.path,
      }
    });
  } else if (pathInfo.route === 'sorch') {
    // The script tag and everything inside it will fall away when the content
    // elem is removed for this case.  We don't bother saving off the content
    // since all it contained of use was this global.
    const rawSearchResults = window.SEARCH_RESULTS;
    thing = contentTrack.addThing(null, null, {
      type: 'searchResults',
      persisted: {
        queryParams,
      },
      ingestArgs: {
        rawSearchResults
      },
    });
  } else if (pathInfo.route === 'symbol') {
    const rawSearchResults = window.SEARCH_RESULTS;
    thing = contentTrack.addThing(null, null, {
      type: 'symbolView',
      persisted: {
        rawSymbol: queryParams.q,
      },
      ingestArgs: {
        rawSearchResults
      },
    });
  }

  thing.sessionMeta.url = window.location.toString();

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
