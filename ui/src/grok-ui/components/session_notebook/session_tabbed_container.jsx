import React from 'react';

import { Button, Dropdown, Popup } from 'semantic-ui-react';

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
export class SessionTabbedToolbar extends DirtyingComponent {
  constructor(props) {
    // the notebook is characterized by the track.  The function is only invoked
    // after the constructor completes, so it's okay to access our convenience
    // variable initialized below.
    super(props, function () { return this.track; });

    this.sessionManager = this.props.grokCtx.sessionManager;
    this.track = this.sessionManager.tracks[this.props.trackName];
  }

  render() {
    const activeThing = this.track.computeTabbedThingToDisplay();

    const tabButtons = this.track.things.map((thing) => {
      const selectThisThing = () => {
        this.track.selectThing(thing);
      };
      return (
        <Popup
          key={ thing.id }
          content={ thing.makeLabel() }
          mouseEnterDelay={250}
          position='right center'
          on='hover'
          size='large'
          trigger={
            <Button
              icon={ thing.binding.icon }
              active={ thing === activeThing }
              onClick={ selectThisThing }
              />
          }
          />
      );
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

    return (
      <div className="sessionTabbedToolbar">
        <Button.Group vertical>
          { tabButtons }
        </Button.Group>
        &nbsp;
        <Dropdown
          trigger={<Button style={{ 'margin-right': 0 }} icon='plus' />}
          icon={ null }
          >
          <Dropdown.Menu>
            { addDropdownItems }
          </Dropdown.Menu>
        </Dropdown>
      </div>
    );
  }
}

export class SessionTabbedContainer extends DirtyingComponent {
  constructor(props) {
    // the notebook is characterized by the track.  The function is only invoked
    // after the constructor completes, so it's okay to access our convenience
    // variable initialized below.
    super(props, function () { return this.track; });

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

    return (
      <div className="sessionTabbedContainer_tabs">
          { activeWidget }
          { inactiveWidget }
      </div>
    );
  }
}
