import React from 'react';

import { Tab } from 'semantic-ui-react';

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
      return {
        menuItem: thing.makeLabel(),
        render: () => {
          return thing.makeWidget();
        }
      };
    });

    return (
      <div className="sessionTabbedContainer">
        <Tab
          panes={panes}
          menu={{ attached: true, vertical: true, tabular: 'right' }}
          grid={{ paneWidth: 14, tabWidth: 2 }}
          flud={true}
          />
      </div>
    );
  }
}
