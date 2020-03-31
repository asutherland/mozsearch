import EE from 'eventemitter3';

import SessionThing from './session_thing.js';

/**
 * Holds persisted SessionThings.  In turn held by a SessionManager which holds
 * multiple SessionTracks.  SessionNotebookContainer widgets bind to the track
 * and listen for changes in the list of things (additions/removals), but not
 * mutations of those session things.  Each SessionThing is expected to be
 * bound to by an independently stateful widget.
 */
export default class SessionTrack extends EE {
  constructor(manager, name, trackSettings) {
    super();

    this.manager = manager;
    this.name = name;
    this.trackSettings = trackSettings || {};

    this.things = [];

    /**
     * Some tracks may be presented as a tabbed UI.  If that's the case, this is
     * the explicitly-selected-by-the-user current tab.  This may also be used
     * in multi-displays like the notebook to convey what the most recently
     * active thing/sheet was.
     */
    this.selectedThing = null;
    /**
     * In the tabbed case, we may repurpose the tabbed display to temporarily
     * switch to another tab for the purposes of displaying information on
     * something the user has hovered over.  In that case, th
     */
    this.temporarilySelectedThing = null;

    this.userSpawnables = null;
    if (this.trackSettings.spawn) {
      this.userSpawnables = [];
      for (const type of this.trackSettings.spawn) {
        this.userSpawnables.push({ type, binding: manager.bindings[type] });
      }
    }

    this.serial = 0;
  }

  /**
   * Updates all session things' disk representations whenever any of them
   * change.  Currently, their `index` is literally their index in the array.
   * We really only need to update the things after the injected thing, but this
   * way is safer if the index rep is changed in SessionManager.
   */
  _updatePersistedThingsBecauseOfOrderingChange(newThingToIgnore) {
    for (const thing of this.things) {
      // We can skip the thing we just wrote.
      if (thing !== newThingToIgnore) {
        this.updatePersistedState(thing, thing.persisted, thing.sessionMeta);
      }
    }
  }

  /**
   * Consider `selectedThing` and `temporarilySelectedThing` to figure out what
   * to display when operating in a tabbed mode.
   */
  computeTabbedThingToDisplay() {
    let thing = this.temporarilySelectedThing || this.selectedThing;
    if (!thing && this.things.length) {
      this.selectedThing = this.things[0];
    }
    return thing;
  }

  /**
   * If there's a temporarilySelectedThing and a selectedThing, there's a
   * near certainty that we'll want to re-render the selectedThing in the near
   * future, so expose it here so the container can keep it around.
   */
  computeTabbedOccludedThing() {
    if (this.temporarilySelectedThing && this.selectedThing) {
      return this.selectedThing;
    }
    return null;
  }

  /**
   * Explicitly select the given thing in this track to be the `selectedThing`,
   * dirtying the track to cause a re-render, plus persisting the state change.
   */
  selectThing(thing, source) {
    if (this.selectedThing === thing) {
      return;
    }
    if (this.trackSettings.onSelectionChange) {
      this.trackSettings.onSelectionChange(this.selectedThing, thing, source);
    }
    if (this.selectedThing) {
      const oldThing = this.selectedThing;
      oldThing.sessionMeta.selected = false;
      oldThing.storeUpdatedSessionMeta();
    }
    this.selectedThing = thing;
    thing.sessionMeta.selected = true;
    thing.storeUpdatedSessionMeta();

    this.serial++;
    this.emit('dirty', this);
  }

  /**
   * Set/un-set a temporarily selected thing that will supersede the explicitly
   * selected thing until this method is invoked again with null.  Used for
   * hover-brushing contextual info.
   */
  temporarilySelectThing(thing) {
    this.temporarilySelectedThing = thing;

    this.serial++;
    this.emit('dirty', this);
  }

  _recursiveMatch(matchParams, obj) {
    for (const [key, value] of Object.entries(matchParams)) {
      if (typeof(value) === 'object') {
        if (!this._recursiveMatch(value, obj[key])) {
          return false;
        }
      } else if (obj[key] !== value) {
        return false;
      }
    }
    return true;
  }

  /**
   * Ensure that there's a thing in this track that matches `matchParams`,
   * returning it if so.  If nothing matches, add a thing using the provided
   * `spawnParams`.
   *
   * The following fields are honored by `matchParams`:
   * - type: Actually required.
   * - persisted: Recursive
   */
  ensureThing(matchParams, spawnParams) {
    if (!spawnParams) {
      spawnParams = matchParams;
    }
    if (this.things.length) {
      for (const thing of this.things) {
        if (thing.type !== matchParams.type) {
          continue;
        }
        if (matchParams.persisted) {
          if (!this._recursiveMatch(matchParams.persisted, thing.persisted)) {
            continue;
          }
        }
        return { existed: true, thing };
      }
    }
    return { existed: false, thing: this.addThing(null, null, spawnParams) };
  }

  addThing(relThing, useId,
           { position, type, persisted, sessionMeta, restored, ingestArgs }) {
    if (!useId) {
      // (an id of 0 is never used, so we won't ambiguously end up in here)
      useId = this.manager.allocId();
    }
    if (!sessionMeta) {
      sessionMeta = this.manager.makeDefaultSessionMeta();
    }

    let targetIdx;
    if (position === 'end') {
      targetIdx = this.things.length;
    } else if (position === 'start') {
      targetIdx = 0;
    } else if (relThing === null) {
      targetIdx = this.things.length;
    } else {
      targetIdx = this.things.indexOf(relThing);
      if (targetIdx === -1) {
        targetIdx = this.things.length;
      } else if (position && position === 'after') {
        // otherwise we're placing it before by using the existing sheet's
        // index.
        targetIdx++;
      }
    }

    const orderingChange = targetIdx < this.things.length;

    const binding = this.manager.bindings[type];
    if (typeof(binding) !== 'object') {
      console.warn("binding not a dictionary for type:", type);
      throw new Error("binding wasn't an object");
    }
    if (typeof(binding.makeModel) !== 'function') {
      console.warn("makeModel not a function:", binding.makeModel,
                   "for type", type);
      throw new Error("binding makeModel wasn't a function");
    }

    const thing =
      new SessionThing(this, useId, type, binding, persisted, sessionMeta,
                       ingestArgs);
    this.things.splice(targetIdx, 0, thing);
    // Write-through to the database if this didn't come from the database.
    if (!restored) {
      this.updatePersistedState(thing, persisted, sessionMeta);
    }

    if (orderingChange) {
      this._updatePersistedThingsBecauseOfOrderingChange();
    }

    // Select thig is the meta says it should be selected, or if this is the
    // first thing added to the track (which can then be clobbered by
    // sessionMeta.)
    if (thing.sessionMeta.selected || this.things.length === 1) {
      this.selectedThing = thing;
    }

    this.manager.sessionThingAdded(thing);

    this.serial++;
    this.emit('dirty', this);

    return thing;
  }

  /**
   * Remove the given SessionThing from the track if it's still present.
   */
  removeThing(thing) {
    const idx = this.things.indexOf(thing);
    if (idx === -1) {
      return;
    }

    this.things.splice(idx, 1);
    this.manager.sessionThingRemoved(thing);

    if (thing === this.temporarilySelectedThing) {
      this.temporarilySelectedThing = null;
    }
    if (thing === this.selectedThing) {
      let nextIdx = Math.max(0, Math.min(this.things.length - 1, idx - 1));
      this.selectThing(this.things[nextIdx], 'click');
    }

    this.markDirty();
  }

  updatePersistedState(thing, newState, sessionMeta) {
    if (!this.trackSettings.persist) {
      return;
    }

    this.manager.updatePersistedState(this, thing, newState, sessionMeta);
  }

  /**
   * When a SessionThing replaces itself:
   * - TODO: We really need/want some history state hookup here.  This implies
   *   the caller having made sure to use the history API or other to snapshot
   *   the state off before replacing it.
   * - Emit dirty so the notebook container can rebuild itself and update the
   *   SessionThing serials so that the NotebookSheet can end up knowing it
   *   needs to re-run itself to restore from the new persisted state.
   */
  sessionThingReplaced() {
    this.markDirty();
  }

  markDirty() {
    this.serial++;
    this.emit('dirty');
  }
}
