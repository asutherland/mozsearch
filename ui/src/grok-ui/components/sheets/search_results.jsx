import React from 'react';

import DirtyingComponent from '../dirtying_component.js';

import RawResults from '../raw_details/raw_results.jsx';

/**
 * Displays the filterable results of a Searchfox search's FilteredResults
 * instance.  Except nothing is currently filterable.  Tricked ya!
 * TODO: Not trick ya.
 */
export default class SearchResultsSheet extends DirtyingComponent {
  constructor(props) {
    super(props, 'searchResults');
  }

  render() {
    const { sessionThing, grokCtx } = this.props;
    const rawResults = this.props.searchResults.rawResultsList[0];
    return (
      <RawResults
        sessionThing={ sessionThing }
        grokCtx={ grokCtx }
        rawResults={ rawResults }
        />
    );
  }
}

export class SearchResultsModel {
  constructor(sessionThing, { queryParams }, filteredResults) {
    this.searchText = queryParams.q;

    this.filteredResults =
      filteredResults || sessionThing.grokCtx.performSyncSearch(queryParams);
  }

  destroy() {
  }
}

export let SearchResultsBinding = {
  icon: 'search',
  spawnable: 'Search Results',
  /**
   * @param ingestArgs
   *   Provided by the searchfox-ui page bootstrapping logic where the search
   *   results are already included in the page.  Because the web server knows
   *   how to cache the page and these results, it still makes sense to support
   *   this path even though we could just fetch() the search (which the server
   *   could also cache).  It's probably worth revisiting this.
   */
  makeModel(sessionThing, persisted, ingestArgs) {
    let filteredResults;
    if (ingestArgs) {
      filteredResults =
        sessionThing.grokCtx.ingestExistingSearchResults(ingestArgs);
    }
    return new SearchResultsModel(sessionThing, persisted, filteredResults);
  },

  makeLabelForModel(sessionThing, model) {
    return `Results: ${ model.searchText }`;
  },

  makeWidgetForModel(sessionThing, model) {
    return (
      <SearchResultsSheet
        key={ sessionThing.id }
        sessionThing={ sessionThing }
        model={ model }
        />
    );
  }
};
