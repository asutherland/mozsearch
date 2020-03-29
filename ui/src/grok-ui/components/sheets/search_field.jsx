import React from 'react';


/**
 * Provides a search field that produces SearchResults sheets when enter is hit.
 */
export class SearchFieldSheet extends React.Component {
  constructor(props) {
    super(props);

    this.handleSubmit = this.handleSubmit.bind(this);
  }

  handleSubmit(event) {
    event.preventDefault();

    const searchText = this.input.value;

    this.props.sessionThing.addThing({
      type: 'searchResult',
      position: 'after',
      persisted: { searchText }
    });

    // Update our own persisted state now that the user committed to what they
    // typed.
    // TODO: perhaps also maintain some level of history and fancy up the text
    // field widget.
    this.props.sessionThing.updatePersistedState({
      initialValue: searchText
    });
  }

  render() {
    return (
      <form onSubmit={ this.handleSubmit }>
        <label>
          Search for:&nbsp;
          <input
             defaultValue={ this.props.initialValue }
             type="text"
             ref={ (input) => { this.input = input; } } />
        </label>&nbsp;
        <input type="submit" value="Search" />
      </form>
    );
  }
}

export class SearchFieldModel {
  constructor() {

  }
}

export let SearchFieldBinding = {
  icon: 'search',
  spawnable: 'Search',
  makeModel(/*sessionThing, persisted */) {
    // The model needs to exist and have a destroy method right now.  But it's
    // not clear we gain anything by actually having a model.  If this idiom
    // ends up common, it may be worth supporting a special value of undefined,
    // but it's probably more understandable to just have simple dummy objects
    // like this.
    return { destroy: () => {} };
  },

  makeLabelForModel(/*sessionThing, model */) {
    return 'Search';
  },

  makeRichLabelInfoForModel(/* sessionThing, model */) {
    return {
      primary: "Search",
      secondary: "",
      actions: [],
    };
  },

  makeWidgetForModel(sessionThing/*, model */) {
    return (
      <SearchFieldSheet
        key={ sessionThing.id }
        sessionThing={ sessionThing }
        initialValue={ sessionThing.persisted.initialValue }
        />
    );
  }
};
