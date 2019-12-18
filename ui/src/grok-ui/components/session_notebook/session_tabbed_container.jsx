import React from 'react';

import { Label, Menu, Tab, Dropdown } from 'semantic-ui-react';

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

    this.sessionManager = this.props.grokCtx.sessionManager;
    this.track = this.sessionManager.tracks[this.props.trackName];
  }

  render() {
    const panes = this.track.things.map((thing) => {
      const closeThisThing = () => {
        thing.removeSelf();
      };
      const menuItem = (
        <Menu.Item>
          { thing.makeLabel() }
          <Label
            onClick={ closeThisThing }
            >x</Label>
        </Menu.Item>
      );
      return {
        menuItem,
        render: () => {
          return thing.makeWidget();
        }
      };
    });

    const addDropdownItems = this.sessionManager.userSpawnables.map(
      ({ type, binding }) => {
        return {
          key: binding.spawnable,
          text: binding.spawnable,
          value: type
        };
      });

    const spawnClicked = (evt, data) => {
      this.track.addThing(
        null, null,
        {
          position: 'start',
          type: data.value,
          persisted: {}
        });
    };

    return (
      <React.Fragment>
        <div className="sessionTabbedContainer">
          <Tab
            panes={panes}
            menu={{ attached: true, vertical: true, tabular: true }}
            menuPosition="right"
            grid={{ paneWidth: 14, tabWidth: 2 }}
            flud={true}
            />
        </div>
        <div className="sessionTabbedContainer_spawnButton">
        <Dropdown className="icon"
          button
          floating
          labeled
          icon='plus'
          text='Add Tab'
          onChange={ spawnClicked }
          options={ addDropdownItems }
          />
        </div>
      </React.Fragment>
    );
  }
}
