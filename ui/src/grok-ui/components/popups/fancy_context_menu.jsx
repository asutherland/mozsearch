import React from 'react';

import { Icon, Menu } from 'semantic-ui-react';

import DirtyingComponent from '../dirtying_component.js';

/**
 * Popup home to all attempts at fancy auto-analysis and auto-diagramming of the
 * selected symbol.  Behaviorally, this is intended to operate similarly to the
 * ClassicSearchfoxMenu where hovering causes display of info in the context
 * card, but the specific menu options are all about diagrams and analysis.
 *
 * XXX for now this is just the classic searchfox menu but purple.  We'll
 * iterate on this after the search page starts showing similar diagrams as it's
 * easier to iterate on search results.
 */
export default class FancyContextMenu extends DirtyingComponent {
  constructor(props) {
    super(props, 'symInfo');
  }

  render() {
    const {
      grokCtx,
      symInfo,
      //fromSymInfo,
      fileInfo,
      lineNumber,
      visibleTokenText,
      highlightClickedThing,
    } = this.props;

    const items = [];

    if (symInfo) {
      // We're showing this popup for the symbol's own definition if the source
      // file being displayed and the line number clicked on match those of the
      // symbol's canonical definition.
      //
      // In non-fancy searchfox, this is pre-computed during output-file to filter
      // out the jump when the jump's target is the current location.  We're doing
      // this dynamically here because the check is quick and it will help us
      // shrink the file size since otherwise all the defs/jumps for a symbol
      // should be equivalent.
      const showingForDef = symInfo.sourceFileInfo &&
                            symInfo.sourceFileInfo === fileInfo &&
                            symInfo.defLocation &&
                            lineNumber !== null &&
                            symInfo.defLocation.lno === lineNumber;

      // Same for declaration
      const showingForDecl = symInfo.declFileInfo &&
                            symInfo.declFileInfo === fileInfo &&
                            symInfo.declLocation &&
                            lineNumber !== null &&
                            symInfo.declLocation.lno === lineNumber;

      if (!showingForDef && symInfo.defLocation) {
        items.push(
          <Menu.Item
            key="def"
            data-context-show="def"
            link
            href={ grokCtx.historyHelper.buildSourceURLForSymbolDef(symInfo) }
          >
            <Icon name="building" />
            Go to definition of <b>{symInfo.prettiestName}</b>
          </Menu.Item>
        );
      }

      if (!showingForDecl && symInfo.declLocation) {
        items.push(
          <Menu.Item
            key="decl"
            data-context-show="decl"
            link
            href={ grokCtx.historyHelper.buildSourceURLForSymbolDecl(symInfo) }
          >
            <Icon name="building outline" />
            Go to decl of <b>{symInfo.prettiestName}</b>
          </Menu.Item>
        );
      }

      // Always emit the "search for"
      items.push(
        <Menu.Item
          key="sym-search"
          data-context-show="search"
          link
          href={ grokCtx.historyHelper.buildSearchURLForSymbols(symInfo.rawName) }
        >
          <Icon name="searchengin" />
          Search for {symInfo.semanticKind} <b>{symInfo.prettiestName}</b>
        </Menu.Item>
      );

      if (symInfo.supers) {
        for (const superInfo of symInfo.supers) {
          const relSymInfo = superInfo.symInfo;
          items.push(
            <Menu.Item
              key={ `super-search-${relSymInfo.rawName}` }
              data-context-show="search"
              link
              href={ grokCtx.historyHelper.buildSearchURLForSymbols(relSymInfo.rawName) }
            >
              <Icon name="searchengin" />
              Search for super <b>{relSymInfo.prettiestName}</b>
            </Menu.Item>
          );
        }
      }

      if (symInfo.overrides) {
        for (const overrideInfo of symInfo.overrides) {
          const relSymInfo = overrideInfo.symInfo;
          items.push(
            <Menu.Item
              key={ `override-search-${relSymInfo.rawName}` }
              data-context-show="search"
              link
              href={ grokCtx.historyHelper.buildSearchURLForSymbols(relSymInfo.rawName) }
            >
              <Icon name="searchengin" />
              Search for overridden <b>{relSymInfo.prettiestName}</b>
            </Menu.Item>
          );
        }
      }
    }

    if (visibleTokenText) {
      items.push(
        <Menu.Item
          key="text-search"
          data-context-show="search"
          link
          href={ grokCtx.historyHelper.buildSearchURLForString(visibleTokenText) }
        >
          <Icon name="search" />
          Search for the substring <b>{visibleTokenText}</b>
        </Menu.Item>
      );
    }

    // Always add the sticky highlight item
    if (symInfo) {
      items.push(
        <Menu.Item
          key="sticky-highlight"
          data-context-show="sticky-highlight"
          onClick={ highlightClickedThing }
        >
          <Icon name="sticky note" />
          Sticky Highlight
        </Menu.Item>
      );
    }

    return (
      <Menu
        fluid
        vertical
        size="small"
        color="purple"
        inverted
      >
        { items }
      </Menu>
    );
  }
}
