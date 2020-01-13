import React from 'react';

import { Label, Menu, Input, Tab, Dropdown } from 'semantic-ui-react';

import DirtyingComponent from '../dirtying_component.js';

import './session_tabbed_container.css';

/**
 * A tabbed display for a session track.  That is, a display where each tab has
 * persistable complex state.  Part of an evolving descendant of the grokysis
 * session notebook concept.  Previously the react components processed slot
 * messages directly and therefore needed to be instantiated at all times, but
 * that model-view coupling (for simplicity) is no longer justifiable when
 * things aren't always visible and may be very expensive (graph updates!).
 *
 * Expected props:
 * - grokCtx
 * - trackName
 */
export default class SessionTabbedContainer extends DirtyingComponent {
  constructor(props) {
    // the notebook is characterized by the track.  The function is only invoked
    // after the constructor completes, so it's okay to access our convenience
    // variable initialized below.
    super(props, function () { return this.track; });

    this.passProps = {
      grokCtx: this.props.grokCtx
    };

    this.searchInputRef = React.createRef();

    this.sessionManager = this.props.grokCtx.sessionManager;
    this.track = this.sessionManager.tracks[this.props.trackName];
  }

  render() {
    const activeThing = this.track.computeTabbedThingToDisplay();
    const activeWidget = activeThing && activeThing.makeWidget();

    let inactiveWidget = null;
    const inactiveThing = this.track.computeTabbedOccludedThing();
    if (inactiveThing) {
      inactiveWidget = inactiveThing.makeWidget();
    }

    const tabMenuItems = this.track.things.map((thing) => {
      const selectThisThing = () => {
        this.track.selectThing(thing);
      };
      const menuItem = (
        <Menu.Item
          active={ thing === activeThing }
          onClick={ selectThisThing }
          >
          { thing.makeLabel() }
        </Menu.Item>
      );
      return menuItem;
    });

    const addDropdownItems = this.sessionManager.userSpawnables.map(
      ({ type, binding }) => {
        const spawnThisTab = () => {
          this.track.addThing(
            null, null,
            {
              position: 'start',
              type,
              persisted: {}
            });
        };
        return (
          <Dropdown.Item
            key={ type }
            text={ binding.spawnable }
            onClick={ spawnThisTab }
          />
        );
      });


    let maybeSearchWidget;
    const trackSettings = this.track.trackSettings;
    if (trackSettings && trackSettings.populateSearchAddThingArgs) {
      const handleSearchSubmit = () => {
        const str = this.searchInputRef.current.value;
        this.track.addThing(trackSettings.populateSearchAddThingArgs(str));
      };

      maybeSearchWidget = (
        <Menu.Item>
          <form onSubmit={ handleSearchSubmit }>
            <Input
              action={{ icon: 'search' }}
              ref={ this.searchInputRef }
              placeholder='Search...'
              />
          </form>
        </Menu.Item>
      );
    }

    return (
      <div className="sessionTabbedContainer sessionTabbedContaienr_horiz">
        <div className="sessionTabbedContainer_tabs">
          { activeWidget }
          { inactiveWidget }
        </div>
        <Menu vertical className="sessionTabbedContainer_menu">
          { maybeSearchWidget }

          <Menu.Item>
            Tabs
            <Menu.Menu>
            { tabMenuItems }
            </Menu.Menu>
          </Menu.Item>

          <Dropdown item text='Add tab...'>
            <Dropdown.Menu direction='left'>
              { addDropdownItems }
            </Dropdown.Menu>
          </Dropdown>
        </Menu>
      </div>
    );
  }
}
