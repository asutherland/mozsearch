import React from 'react';

import { Icon, Menu } from 'semantic-ui-react';

import DirtyingComponent from '../dirtying_component.js';

/**
 * An attempt at the classic searchfox menu that attempts to provide a concise
 * set of "go to definition of X", "search for TYPE X", "search for text X",
 * and "sticky highlight".
 *
 * We are changing this to:
 * - Also include "go to decl of X" because I've wanted it.
 * - Show "search for TYPE X" for all the superclasses of X as well as X
 * - Show "search for TYPE X" for all the methods X overrides as well as X
 *
 * Note that the non-fancy Searchfox menu could end up with a LOT of rows
 * when a bunch of symbols would be consolidated into a single token.  This
 * most notably would happen for constructors that intialize member fields,
 * resulting in lines being present for the constructor, superclasses, and all
 * types for members fields.  For example,
 * nsGlobalWindowInner::nsGlobalWindowInner as of this writing has 12
 * definitiion rows and 23 search rows and the string and sticky highlight
 * options.  Obviously, that's not useful.  (This can also happen for macros
 * where all of the functions declared by the macro get collapsed onto the
 * invoking macro.  That's more useful, but still has scaling issues, so the
 * intent is to address that via some kind of specialized mechanism.)
 *
 * For now, this menu is provided with only a single symbol which is lossy, but
 * the plan is to ensure the jumps/searches use-cases still work.  For the
 * constructor, the structured info about the constructor and class should be
 * sufficient.  For the macro, it's likely appropriate to emit structured
 * info for a macro invocation, but it may also be appropriate to improve our
 * macro handling to show the generated source expanded inline in the source.
 * (Some baby steps were taken with that, but it ends up being non-trivial.)
 */
export default class ClassicSearchfoxMenu extends DirtyingComponent {
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
      >
        { items }
      </Menu>
    );
  }
}
