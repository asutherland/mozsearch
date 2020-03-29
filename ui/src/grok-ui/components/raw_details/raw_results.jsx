import React from 'react';

import HitDict from './hit_dict.jsx';
import SymbolHit from './symbol_hit.jsx';
import PathCrumbed from './path_crumbed.jsx';

import './raw_results.css';

/**
 * Renders a single symbol and its dictionary of defs/decls/uses/etc.  Consumes
 * props:
 * - symbolName
 * - hitDict
 */
export default class RawResults extends React.PureComponent {
  render() {
    const { sessionThing, grokCtx } = this.props;
    const rawSearchResults = this.props.rawResults;
    // Copy over the contents of raw, filtering out the '*'-wrapped metadata
    // fields that searchfox returns.
    const rawResults = {};
    for (const [key, val] of Object.entries(rawSearchResults.raw)) {
      if (key.startsWith('*')) {
        continue;
      }

      rawResults[key] = val;
    }

    const contentFactory = (typedResults, key) => {
      if (key === 'semantic') {
        const symbolHits = typedResults;
        const renderedSymbolHits = [];
        for (const [rawSym, rawSymInfo] of Object.entries(symbolHits)) {
          renderedSymbolHits.push(
            <SymbolHit
              key={ rawSym }
              grokCtx={ grokCtx }
              sessionThing={ sessionThing }
              rawSymInfo={ rawSymInfo }
              />
          );
        }
        return (
          <div>
            { renderedSymbolHits }
          </div>
        );
      } else if (key === 'files') {
        const fileHits = [];
        for (const info of typedResults) {
          fileHits.push(
            <div>
              <PathCrumbed
                key={ info.path }
                grokCtx={ grokCtx }
                path={ info.path }
                />
            </div>
          );
        }
        return (
          <div>
            { fileHits }
          </div>
        )
      } else {
        return (
          <div>
          </div>
        );
      }
    };

    return (
      <div>
        <div className="rawResults__hitDict">
          <HitDict
            grokCtx={ grokCtx }
            sessionThing={ sessionThing }
            hitDict={ rawResults }
            contentFactory={ contentFactory }
            />
        </div>
      </div>
    );
  }
}
