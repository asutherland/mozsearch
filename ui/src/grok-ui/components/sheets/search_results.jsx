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
  constructor(sessionThing, { searchText }) {
    this.searchText = searchText;

    this.filteredResults = sessionThing.grokCtx.performSyncSearch(searchText);
  }

  destroy() {
  }
}

export let SearchResultsBinding = {
  spawnable: 'Search Results',
  makeModel(sessionThing, persisted) {
    return new SearchResultsModel(persisted);
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
