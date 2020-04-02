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
      sessionThing,
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

      items.push(
        <Menu.Item
          key="symbolView"
          data-context-show="symbolView"
          link
          href={ grokCtx.historyHelper.buildSymbolViewURLForSymbol(symInfo) }
        >
          <Icon name="building" />
          Symbol View of <b>{symInfo.prettiestName}</b>
        </Menu.Item>
      );

      const diagramMakerFactory = (diagramType) => {
        return () => {
          const thing = sessionThing.addThingInOtherTrack({
            type: 'diagram',
            persisted: {
              diagramType,
              rawSymbol: symInfo.rawName,
            },
          });
          thing.track.selectThing(thing, 'creation');
        };
      };

      symInfo.ensureCallEdges();
      if (symInfo.callsOutTo.size) {
        items.push(
          <Menu.Item
            key="symbolView"
            data-context-show="symbolView"
            link
            onClick={ diagramMakerFactory('calls-out') }
          >
            <Icon name="building" />
            Diagram calls out of <b>{symInfo.prettiestName}</b>
          </Menu.Item>
        );
      }

      if (symInfo.receivesCallsFrom.size) {
        items.push(
          <Menu.Item
            key="symbolView"
            data-context-show="symbolView"
            link
            onClick={ diagramMakerFactory('calls-in') }
          >
            <Icon name="building" />
            Diagram calls into <b>{symInfo.prettiestName}</b>
          </Menu.Item>
        );
      }
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
